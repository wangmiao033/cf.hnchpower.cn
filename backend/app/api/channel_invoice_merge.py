"""Issue one already-created tax invoice and atomically associate it with channel bills.

This endpoint records an *existing* official invoice; it never calls a tax authority
or modifies the underlying channel statements, their calculations, or their status.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.invoice import _ensure_unique_identity, _identity_key, _lock_invoice_identity
from app.core.deps import get_db
from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.channel import ChannelRecord
from app.models.invoice import InvoiceRecord
from app.models.operation_log import OperationLog
from app.services.invoice_file_proof import verify_invoice_upload

router = APIRouter()
ACTIVE_ALLOCATION_STATUSES = ("suggested", "confirmed")
LOCKED_BILL_STATUSES = {"confirmed", "invoiced", "completed", "settled", "reconciled", "verified"}
CENT = Decimal("0.01")


def to_cents(value) -> int:
    """Money inputs use integer cents, never accumulated binary floats."""
    number = Decimal(str(value))
    if not number.is_finite():
        raise ValueError("invalid_money")
    return int((number.quantize(CENT, rounding=ROUND_HALF_UP) * 100).to_integral_value())


def distribute_gross(amounts: list[int], net_cents: int, tax_cents: int) -> list[tuple[int, int]]:
    """Allocate net/tax in cents; assign the rounded remainder to the last bill."""
    gross = sum(amounts)
    if gross <= 0 or net_cents < 0 or tax_cents < 0 or net_cents + tax_cents != gross:
        raise ValueError("amount_mismatch")
    result = []
    accumulated_gross = 0
    assigned_net = 0
    for amount in amounts:
        accumulated_gross += amount
        cumulative_net = (accumulated_gross * net_cents + gross // 2) // gross
        net = cumulative_net - assigned_net
        tax = amount - net
        if net < 0 or tax < 0 or net > amount:
            raise ValueError("invalid_tax_allocation")
        result.append((net, tax))
        assigned_net += net
    return result


class IssuedChannelInvoiceRequest(BaseModel):
    bill_ids: list[str] = Field(min_length=1, max_length=30)
    buyer_name: str = Field(min_length=1, max_length=256)
    buyer_tax_no: str = Field(min_length=1, max_length=64)
    seller_name: str = Field(min_length=1, max_length=256)
    seller_tax_no: str | None = Field(default=None, max_length=64)
    invoice_type: str = Field(min_length=1, max_length=100)
    digital_invoice_no: str | None = Field(default=None, max_length=64)
    invoice_code: str | None = Field(default=None, max_length=64)
    invoice_no: str | None = Field(default=None, max_length=64)
    invoice_date: str
    invoice_amount: Decimal = Field(ge=0, max_digits=18, decimal_places=2)
    tax_amount: Decimal = Field(ge=0, max_digits=18, decimal_places=2)
    amount_with_tax: Decimal = Field(gt=0, max_digits=18, decimal_places=2)
    # The /electronic-invoices/parse endpoint emits this signed reference.
    # Never trust a raw blob URL or file name provided by a browser.
    source_file_proof: str | None = Field(default=None, max_length=8192)
    existing_invoice_id: str | None = Field(default=None, max_length=128)
    remark: str | None = Field(default=None, max_length=1000)


class IssuedChannelInvoiceResult(BaseModel):
    invoice_id: str
    invoice_number: str
    allocated_amount: float
    allocated_bills: int
    bill_ids: list[str]
    linked_existing: bool = False


def prepare_issued_invoice(payload: IssuedChannelInvoiceRequest):
    ids = [str(bill_id).strip() for bill_id in payload.bill_ids]
    if not all(ids) or len(set(ids)) != len(ids):
        raise HTTPException(422, detail={"error": "invalid_or_duplicate_bill_ids", "message": "账单选择无效或存在重复，请重新勾选"})
    try:
        date.fromisoformat(payload.invoice_date)
    except (ValueError, TypeError):
        raise HTTPException(422, detail={"error": "invalid_invoice_date", "message": "请填写正式发票上的真实开票日期"})
    number_data = {
        "digital_invoice_no": (payload.digital_invoice_no or "").strip(),
        "invoice_code": (payload.invoice_code or "").strip(),
        "invoice_no": (payload.invoice_no or "").strip(),
    }
    identity = _identity_key(number_data)
    if not identity:
        raise HTTPException(422, detail={"error": "official_invoice_number_required", "message": "必须填写真实的数电发票号码，或完整发票代码与号码"})
    gross = to_cents(payload.amount_with_tax)
    net = to_cents(payload.invoice_amount)
    tax = to_cents(payload.tax_amount)
    if net + tax != gross:
        raise HTTPException(422, detail={"error": "invoice_net_tax_total_mismatch", "message": "不含税金额加税额必须等于价税合计"})
    return ids, number_data, identity, gross, net, tax


def _effective_coverage_cents(db: Session, bill_ids: list[str], bill_type: str = "channel") -> dict[str, int]:
    """Mirror bill-summary red-invoice treatment when computing remaining coverage."""
    allocations = db.execute(
        select(BillInvoiceAllocation).where(
            BillInvoiceAllocation.bill_type == bill_type,
            BillInvoiceAllocation.bill_id.in_(bill_ids),
            BillInvoiceAllocation.status.in_(ACTIVE_ALLOCATION_STATUSES),
        )
    ).scalars().all()
    if not allocations:
        return {}
    invoices = {
        item.id: item for item in db.execute(
            select(InvoiceRecord).where(
                InvoiceRecord.id.in_({row.invoice_id for row in allocations})
            )
        ).scalars().all()
    }
    originals = [item.id for item in invoices.values()]
    reds = {
        str(original_id): Decimal(str(total or 0))
        for original_id, total in db.execute(
            select(
                InvoiceRecord.original_invoice_id,
                func.coalesce(func.sum(func.abs(InvoiceRecord.amount_with_tax)), 0),
            ).where(
                InvoiceRecord.original_invoice_id.in_(originals),
                InvoiceRecord.tax_status == "red",
            ).group_by(InvoiceRecord.original_invoice_id)
        ).all()
    }
    amounts: dict[str, Decimal] = {}
    for allocation in allocations:
        invoice = invoices.get(allocation.invoice_id)
        if (
            invoice is None
            or (invoice.invoice_direction or "output") != ("input" if bill_type == "rd" else "output")
            or invoice.tax_status in {"red", "void"}
            or invoice.status == "作废"
        ):
            continue
        gross = Decimal(str(invoice.amount_with_tax or 0))
        if gross == 0:
            gross = Decimal(str(invoice.invoice_amount or 0)) + Decimal(str(invoice.tax_amount or 0))
        red_ratio = min(Decimal("1"), reds.get(invoice.id, Decimal("0")) / abs(gross)) if gross else Decimal("0")
        effective = Decimal(str(allocation.allocated_gross_amount or 0)) * (1 - red_ratio)
        amounts[str(allocation.bill_id)] = amounts.get(str(allocation.bill_id), Decimal("0")) + effective
    return {bill_id: to_cents(value) for bill_id, value in amounts.items()}


@router.post("/issue", response_model=IssuedChannelInvoiceResult, status_code=status.HTTP_201_CREATED)
def record_issued_merged_channel_invoice(
    payload: IssuedChannelInvoiceRequest, db: Session = Depends(get_db)
) -> IssuedChannelInvoiceResult:
    """Register a real issued invoice and allocate its value to multiple bills atomically."""
    ids, number_data, identity, gross_cents, net_cents, tax_cents = prepare_issued_invoice(payload)
    if payload.existing_invoice_id and payload.source_file_proof:
        raise HTTPException(422, detail={"error": "source_proof_existing_conflict", "message": "已有发票无需重复上传原件"})
    source = verify_invoice_upload(payload.source_file_proof) if payload.source_file_proof else None
    ordered_ids = sorted(ids)
    try:
        rows = db.execute(
            select(ChannelRecord)
            .where(ChannelRecord.id.in_(ordered_ids))
            .order_by(ChannelRecord.id)
            .with_for_update()
        ).scalars().all()
        if len(rows) != len(ids):
            raise HTTPException(404, detail={"error": "bill_not_found", "message": "账单已发生变化或被删除，请返回列表重试"})
        by_id = {row.id: row for row in rows}
        selected = [by_id[bill_id] for bill_id in ids]
        names = {" ".join(str(row.partner_name or "").split()) for row in selected}
        if "" in names or len(names) != 1:
            raise HTTPException(409, detail={"error": "partner_mismatch", "message": "只能合并同一有明确公司主体的渠道账单"})
        if any(str(row.status or "").strip().lower() not in LOCKED_BILL_STATUSES for row in selected):
            raise HTTPException(409, detail={"error": "bill_not_confirmed", "message": "必须先核对账单，才能开票"})
        if any(to_cents(row.settlement_amount or 0) <= 0 for row in selected):
            raise HTTPException(409, detail={"error": "nonpositive_bill", "message": "不能将零金额或冲减账单当作普通销项开票"})
        allocated = _effective_coverage_cents(db, ids)
        outstanding = [
            to_cents(row.settlement_amount or 0) - allocated.get(row.id, 0)
            for row in selected
        ]
        if any(amount <= 0 for amount in outstanding):
            raise HTTPException(409, detail={"error": "invoice_already_covered", "message": "存在已全额开票的账单，请重新选择"})
        actual_total = sum(outstanding)
        if source and " ".join(payload.buyer_name.split()) not in names:
            raise HTTPException(409, detail={
                "error": "invoice_buyer_partner_mismatch",
                "message": "发票购买方与当前账单合作方不同，请核对开票主体后再关联",
            })

        existing = None
        if payload.existing_invoice_id:
            existing = db.execute(
                select(InvoiceRecord)
                .where(InvoiceRecord.id == payload.existing_invoice_id)
                .with_for_update()
            ).scalars().first()
            if (
                existing is None or existing.invoice_identity_key != identity
                or existing.invoice_direction != "output"
                or existing.tax_status in ("red", "void") or existing.status == "作废"
            ):
                raise HTTPException(409, detail={
                    "error": "existing_invoice_unavailable",
                    "message": "已录入发票不存在、已作废或号码不一致，请在发票中心核对",
                })
            if (
                to_cents(existing.amount_with_tax or 0) != gross_cents
                or to_cents(existing.invoice_amount or 0) != net_cents
                or to_cents(existing.tax_amount or 0) != tax_cents
                or " ".join(str(existing.buyer_name or "").split()) not in names
            ):
                raise HTTPException(409, detail={
                    "error": "existing_invoice_details_mismatch",
                    "message": "已有发票的真实金额、税额或购买方不同，不能重复登记，请核对后再关联",
                })
            already_used = db.execute(
                select(func.coalesce(func.sum(BillInvoiceAllocation.allocated_gross_amount), 0))
                .where(
                    BillInvoiceAllocation.invoice_id == existing.id,
                    BillInvoiceAllocation.status.in_(ACTIVE_ALLOCATION_STATUSES),
                )
            ).scalar_one()
            if to_cents(already_used or 0):
                raise HTTPException(409, detail={
                    "error": "existing_invoice_partly_linked",
                    "message": "此发票已有账单关联，请在发票中心核对剩余金额后继续分配",
                })
        else:
            _lock_invoice_identity(db, identity)
            try:
                _ensure_unique_identity(db, identity)
            except HTTPException as error:
                if error.status_code == 409:
                    raise HTTPException(409, detail={
                        "error": "duplicate_invoice",
                        "message": "该发票号码已经存在，请重新上传并选择关联已有发票",
                    }) from error
                raise

        if actual_total != gross_cents:
            raise HTTPException(409, detail={
                "error": "invoice_amount_changed",
                "expected_amount": actual_total / 100,
                "invoice_gross": gross_cents / 100,
                "message": "所选账单的未开票余额与正式发票价税合计不一致，请检查是否漏选其他月份",
            })

        invoice_id = str(existing.id) if existing is not None else str(uuid4())
        number = number_data["digital_invoice_no"] or number_data["invoice_no"]
        descriptions = [
            f"{row.statement_no or row.id}（{row.settlement_month or '-'}）：{amount / 100:.2f}"
            for row, amount in zip(selected, outstanding)
        ]
        note = "渠道账单合并开票：" + "；".join(descriptions)
        if payload.remark and payload.remark.strip():
            note = note + "；" + payload.remark.strip()
        invoice = InvoiceRecord(
            id=invoice_id,
            invoice_direction="output",
            invoice_type=payload.invoice_type.strip(),
            digital_invoice_no=number_data["digital_invoice_no"] or None,
            invoice_code=number_data["invoice_code"] or None,
            invoice_no=number_data["invoice_no"] or None,
            invoice_identity_key=identity,
            buyer_name=payload.buyer_name.strip(),
            buyer_tax_no=payload.buyer_tax_no.strip(),
            seller_name=payload.seller_name.strip(),
            seller_tax_no=(payload.seller_tax_no or "").strip() or None,
            title=payload.buyer_name.strip(),
            tax_no=payload.buyer_tax_no.strip(),
            invoice_amount=net_cents / 100,
            tax_amount=tax_cents / 100,
            amount_with_tax=gross_cents / 100,
            invoice_date=payload.invoice_date,
            invoice_source="channel_scanned_invoice" if source else "channel_merged_invoice",
            source_file_name=source["name"] if source else None,
            source_file_url=source["url"] if source else None,
            source_file_type=source["type"] if source else None,
            source_file_size=source["size"] if source else None,
            tax_status="normal",
            status="已开",
            remark=note,
            verified=False,
            verified_amount=0,
            verified_record_ids=[],
        )
        now = datetime.now(timezone.utc)
        parts = distribute_gross(outstanding, net_cents, tax_cents)
        if existing is None:
            db.add(invoice)
        for row, amount, (net, tax) in zip(selected, outstanding, parts):
            db.add(BillInvoiceAllocation(
                id=str(uuid4()),
                bill_type="channel",
                bill_id=str(row.id),
                invoice_id=invoice_id,
                allocated_gross_amount=amount / 100,
                allocated_net_amount=net / 100,
                allocated_tax_amount=tax / 100,
                status="confirmed",
                match_type="manual",
                match_score=0,
                match_reasons=["已核对正式发票并确认与原渠道账单关联"],
                confirmed_at=now,
            ))
            db.add(OperationLog(
                id=str(uuid4()),
                entity_type="channel",
                entity_id=str(row.id),
                entity_number=row.statement_no,
                action="invoice_merge_linked",
                summary=f"已关联合并销项发票 {number}，金额 ¥{amount / 100:.2f}",
                metadata_json={"invoice_id": invoice_id, "invoice_number": number, "allocated_amount": amount / 100},
                changes={},
            ))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, detail={"error": "invoice_merge_conflict", "message": "发票或账单关联冲突，请刷新后核对"})
    except Exception:
        db.rollback()
        raise

    return IssuedChannelInvoiceResult(
        invoice_id=invoice_id,
        invoice_number=number,
        allocated_amount=actual_total / 100,
        allocated_bills=len(ids),
        bill_ids=ids,
        linked_existing=existing is not None,
    )
