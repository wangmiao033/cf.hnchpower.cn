"""Register an existing input VAT invoice received from an R&D partner.

One official incoming tax invoice can be associated with 1-30 R&D bills.
This operation never issues a tax invoice, edits a source bill or changes payments.
R&D prepayment deductions affect cash payable, not invoice coverage: the
canonical invoice base remains the original settlement_amount.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.channel_invoice_merge import (
    IssuedChannelInvoiceRequest,
    IssuedChannelInvoiceResult,
    LOCKED_BILL_STATUSES,
    _effective_coverage_cents,
    distribute_gross,
    prepare_issued_invoice,
    to_cents,
)
from app.api.invoice import _ensure_unique_identity, _lock_invoice_identity
from app.core.deps import get_db
from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.invoice import InvoiceRecord
from app.models.operation_log import OperationLog
from app.models.reconciliation import ReconciliationRecord

router = APIRouter()


class ReceivedRdInputInvoiceRequest(IssuedChannelInvoiceRequest):
    """Input invoice identity and both legal counterparties are mandatory."""
    seller_tax_no: str = Field(min_length=1, max_length=64)


def normalize_legal_name(value) -> str:
    """Collapse whitespace, but never merge different company/short-name identities."""
    return "".join(str(value or "").split()).lower()


@router.post("/receive", response_model=IssuedChannelInvoiceResult, status_code=status.HTTP_201_CREATED)
def record_received_rd_input_invoice(
    payload: ReceivedRdInputInvoiceRequest,
    db: Session = Depends(get_db),
) -> IssuedChannelInvoiceResult:
    ids, number_data, identity, gross_cents, net_cents, tax_cents = prepare_issued_invoice(payload)
    try:
        # Serialize competing allocations on the same R&D bills. The shared
        # identity lock also prevents duplicate numbers across the invoice ledger.
        bill_rows = db.execute(
            select(ReconciliationRecord)
            .where(ReconciliationRecord.id.in_(sorted(ids)))
            .order_by(ReconciliationRecord.id)
            .with_for_update()
        ).scalars().all()
        if len(bill_rows) != len(ids):
            raise HTTPException(404, detail={
                "error": "bill_not_found", "message": "部分研发账单不存在或已删除，请刷新后重新选择"
            })

        by_id = {str(row.id): row for row in bill_rows}
        selected = [by_id[bill_id] for bill_id in ids]
        partners = {normalize_legal_name(row.partner_name) for row in selected}
        if "" in partners or len(partners) != 1:
            raise HTTPException(409, detail={
                "error": "partner_mismatch", "message": "只能合并同一研发公司主体的账单，不可跨公司收票"
            })

        seller = normalize_legal_name(payload.seller_name)
        if seller not in partners:
            raise HTTPException(409, detail={
                "error": "invoice_seller_mismatch",
                "message": "进项发票的销售方必须与研发账单的合作公司主体一致；请核对发票抬头"
            })
        if not normalize_legal_name(payload.buyer_name) or not str(payload.buyer_tax_no or "").strip():
            raise HTTPException(422, detail={
                "error": "invoice_buyer_required",
                "message": "请填写真实发票上的购买方公司名称和税号"
            })
        if any(str(row.status or "").strip().lower() not in LOCKED_BILL_STATUSES for row in selected):
            raise HTTPException(409, detail={
                "error": "bill_not_confirmed",
                "message": "有研发账单尚未核对完成，请先完成账单核对再关联进项发票"
            })
        if any(to_cents(row.settlement_amount or 0) <= 0 for row in selected):
            raise HTTPException(409, detail={
                "error": "nonpositive_bill",
                "message": "零结算或负数冲减账单不可按普通进项发票合并收票"
            })

        covered = _effective_coverage_cents(db, ids, "rd")
        remaining = [
            to_cents(row.settlement_amount or 0) - covered.get(str(row.id), 0)
            for row in selected
        ]
        if any(amount <= 0 for amount in remaining):
            raise HTTPException(409, detail={
                "error": "invoice_already_covered",
                "message": "选中的账单包含已全额收票项，请取消该项，避免重复关联"
            })
        total = sum(remaining)
        if total != gross_cents:
            raise HTTPException(409, detail={
                "error": "invoice_amount_changed",
                "expected_amount": total / 100,
                "message": "当前待收票余额已发生变化，请关闭弹窗重新核对后再登记"
            })

        _lock_invoice_identity(db, identity)
        try:
            _ensure_unique_identity(db, identity)
        except HTTPException as error:
            if error.status_code == 409:
                raise HTTPException(409, detail={
                    "error": "duplicate_invoice",
                    "message": "该正式进项发票号码已存在；请在发票中心关联已有发票，不能重复登记"
                }) from error
            raise

        invoice_id = str(uuid4())
        invoice_number = number_data["digital_invoice_no"] or number_data["invoice_no"]
        remarks = [
            f"{row.statement_no or row.id}（{row.settlement_month or '-'}）：{cents / 100:.2f}"
            for row, cents in zip(selected, remaining)
        ]
        note = "研发账单合并收票：" + "；".join(remarks)
        if payload.remark and payload.remark.strip():
            note += "；" + payload.remark.strip()

        record = InvoiceRecord(
            id=invoice_id,
            invoice_direction="input",
            invoice_type=payload.invoice_type.strip(),
            digital_invoice_no=number_data["digital_invoice_no"] or None,
            invoice_code=number_data["invoice_code"] or None,
            invoice_no=number_data["invoice_no"] or None,
            invoice_identity_key=identity,
            buyer_name=payload.buyer_name.strip(),
            buyer_tax_no=payload.buyer_tax_no.strip(),
            seller_name=payload.seller_name.strip(),
            seller_tax_no=payload.seller_tax_no.strip(),
            title=payload.seller_name.strip(),
            tax_no=payload.seller_tax_no.strip(),
            invoice_amount=net_cents / 100,
            tax_amount=tax_cents / 100,
            amount_with_tax=gross_cents / 100,
            invoice_date=payload.invoice_date,
            invoice_source="rd_merged_input_invoice",
            tax_status="normal",
            status="已开",
            remark=note,
            verified=False,
            verified_amount=0,
            verified_record_ids=[],
        )
        db.add(record)
        assigned_parts = distribute_gross(remaining, net_cents, tax_cents)
        now = datetime.now(timezone.utc)
        for row, cents, (net, tax) in zip(selected, remaining, assigned_parts):
            db.add(BillInvoiceAllocation(
                id=str(uuid4()),
                bill_type="rd",
                bill_id=str(row.id),
                invoice_id=invoice_id,
                allocated_gross_amount=cents / 100,
                allocated_net_amount=net / 100,
                allocated_tax_amount=tax / 100,
                status="confirmed",
                match_type="manual",
                match_score=0,
                match_reasons=["研发账单合并收票：财务已核对正式进项发票"],
                confirmed_at=now,
            ))
            db.add(OperationLog(
                id=str(uuid4()),
                entity_type="rd",
                entity_id=str(row.id),
                entity_number=row.statement_no,
                action="invoice_merge_linked",
                summary=f"已关联研发进项发票 {invoice_number}，金额 ¥{cents / 100:.2f}",
                metadata_json={
                    "invoice_id": invoice_id,
                    "invoice_number": invoice_number,
                    "invoice_direction": "input",
                    "allocated_amount": cents / 100,
                },
                changes={},
            ))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, detail={
            "error": "rd_invoice_merge_conflict",
            "message": "发票号码或账单关联冲突，请刷新后重新核对，系统没有写入半张发票"
        })
    except Exception:
        db.rollback()
        raise

    return IssuedChannelInvoiceResult(
        invoice_id=invoice_id,
        invoice_number=invoice_number,
        allocated_amount=total / 100,
        allocated_bills=len(ids),
        bill_ids=ids,
    )
