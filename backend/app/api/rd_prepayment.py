"""R&D prepayment: actual bank funding and invoice evidence."""

from __future__ import annotations

import re
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import bindparam, select, text
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.bank_reconciliation_match import BankReconciliationMatch
from app.models.bank_transaction import BankTransaction
from app.models.invoice import InvoiceRecord
from app.models.operation_log import OperationLog
from app.models.user import AuthUser
from app.services.permissions import require_permission

router = APIRouter()
CENT = Decimal("0.01")
ZERO = Decimal("0")
EPS = Decimal("0.01")


def _money(value) -> Decimal:
    try:
        parsed = Decimal(str(value or 0))
    except Exception:
        return ZERO
    if not parsed.is_finite():
        return ZERO
    return parsed.quantize(CENT, rounding=ROUND_HALF_UP)


def _name(value: object) -> str:
    return re.sub(r"[\s\-—_·,，.。()（）\[\]【】/\\]", "", str(value or "").strip().lower())


def _match_score(left: object, right: object) -> int:
    a, b = _name(left), _name(right)
    if not a or not b:
        return 0
    if a == b:
        return 100
    if a in b or b in a:
        return 80
    return 0


def _actor(user: AuthUser) -> str:
    return str(user.email or user.id or "")


def _bank_expense(tx: BankTransaction) -> Decimal:
    expense = abs(_money(tx.expense_amount))
    income = abs(_money(tx.income_amount))
    if expense > EPS and income <= EPS:
        return expense
    if income > EPS:
        return ZERO
    if str(tx.type or "") in {"payment_register", "statement_import"}:
        return abs(_money(tx.amount))
    return ZERO


def _regularly_linked(db: Session, tx: BankTransaction) -> bool:
    if str(tx.reconciliation_id or "").strip():
        return True
    matched = db.execute(
        select(BankReconciliationMatch.id).where(
            BankReconciliationMatch.bank_transaction_id == str(tx.id),
            BankReconciliationMatch.status == "confirmed",
        ).limit(1)
    ).scalar_one_or_none()
    return matched is not None


def _aggregate_map(db: Session, sql: str, key: str) -> dict[str, Decimal]:
    return {
        str(row[key]): max(ZERO, _money(row["amount"]))
        for row in db.execute(text(sql)).mappings().all()
        if row.get(key)
    }


def _funding_count_map(db: Session) -> dict[str, int]:
    return {
        str(row["access_item_id"]): int(row["count"] or 0)
        for row in db.execute(text("""
            SELECT access_item_id, COUNT(*) AS count
            FROM cf_rd_prepayment_fundings
            GROUP BY access_item_id
        """)).mappings().all()
    }


def _pool_candidates(db: Session, bank_payee: str = "") -> list[dict]:
    contract_table = db.execute(text("SELECT to_regclass('public.cf_contract_access_terms')")).scalar_one_or_none()
    if not contract_table:
        return []
    rows = db.execute(text("""
        SELECT
          access.id AS access_item_id,
          access.contract_id,
          access.product_name,
          access.channel_name,
          access.status AS access_status,
          contract.contract_name,
          contract.contract_no,
          contract.counterparty,
          partner.name AS partner_name,
          partner.short_name AS partner_short_name,
          COALESCE(terms.prepayment_amount, 0) AS prepayment_agreed_amount
        FROM cf_contract_access_items AS access
        JOIN cf_contract_records AS contract ON contract.id = access.contract_id
        LEFT JOIN cf_partner_records AS partner ON partner.id = contract.partner_id
        JOIN cf_contract_access_terms AS terms ON terms.access_item_id = access.id
        WHERE COALESCE(terms.prepayment_amount, 0) > 0
          AND COALESCE(access.status, '') <> '已终止'
        ORDER BY contract.updated_at DESC, access.updated_at DESC
    """)).mappings().all()

    funded = _aggregate_map(db, """
        SELECT access_item_id, COALESCE(SUM(funded_amount), 0) AS amount
        FROM cf_rd_prepayment_fundings
        GROUP BY access_item_id
    """, "access_item_id")
    used = _aggregate_map(db, """
        SELECT access_item_id, COALESCE(SUM(deduction_amount), 0) AS amount
        FROM cf_rd_prepayment_deductions
        GROUP BY access_item_id
    """, "access_item_id")
    invoiced = _aggregate_map(db, """
        SELECT funding.access_item_id, COALESCE(SUM(allocation.allocated_amount), 0) AS amount
        FROM cf_rd_prepayment_invoice_allocations AS allocation
        JOIN cf_rd_prepayment_fundings AS funding ON funding.id = allocation.funding_id
        GROUP BY funding.access_item_id
    """, "access_item_id")
    funding_counts = _funding_count_map(db)

    out = []
    for row in rows:
        access_id = str(row["access_item_id"])
        agreed = max(ZERO, _money(row.get("prepayment_agreed_amount")))
        actual_funded = funded.get(access_id, ZERO)
        used_amount = used.get(access_id, ZERO)
        has_actual_funding = funding_counts.get(access_id, 0) > 0
        effective_cap = min(agreed, actual_funded) if has_actual_funding else agreed
        available = max(ZERO, effective_cap - used_amount)
        shortfall = max(ZERO, used_amount - actual_funded) if has_actual_funding else ZERO
        score = max(
            _match_score(bank_payee, row.get("counterparty")),
            _match_score(bank_payee, row.get("partner_name")),
            _match_score(bank_payee, row.get("partner_short_name")),
        )
        out.append({
            **dict(row),
            "prepayment_agreed_amount": float(agreed),
            "actual_funded_amount": float(actual_funded),
            "deducted_amount": float(used_amount),
            "available_balance": float(available),
            "funding_shortfall": float(shortfall),
            "invoice_allocated_amount": float(invoiced.get(access_id, ZERO)),
            "has_actual_funding": has_actual_funding,
            "max_fundable_amount": float(max(ZERO, agreed - actual_funded)),
            "bank_match_score": score,
            "recommended": score >= 80,
        })
    out.sort(key=lambda item: (item["bank_match_score"], item["max_fundable_amount"]), reverse=True)
    return out


def _invoice_gross(invoice: InvoiceRecord) -> Decimal:
    gross = abs(_money(invoice.amount_with_tax))
    if gross > EPS:
        return gross
    return abs(_money(invoice.invoice_amount)) + abs(_money(invoice.tax_amount))


def _invoice_used(db: Session, invoice_id: str) -> Decimal:
    bill = db.execute(text("""
        SELECT COALESCE(SUM(allocated_gross_amount), 0)
        FROM bill_invoice_allocations
        WHERE invoice_id = :invoice_id AND status IN ('suggested', 'confirmed')
    """), {"invoice_id": invoice_id}).scalar_one()
    prepay = db.execute(text("""
        SELECT COALESCE(SUM(allocated_amount), 0)
        FROM cf_rd_prepayment_invoice_allocations
        WHERE invoice_id = :invoice_id
    """), {"invoice_id": invoice_id}).scalar_one()
    return max(ZERO, _money(bill) + _money(prepay))


def _invoice_candidates(db: Session, bank_payee: str) -> list[dict]:
    rows = db.execute(
        select(InvoiceRecord)
        .where(InvoiceRecord.invoice_direction == "input")
        .order_by(InvoiceRecord.invoice_date.desc(), InvoiceRecord.created_at.desc())
        .limit(120)
    ).scalars().all()
    out = []
    for invoice in rows:
        if str(invoice.tax_status or "normal").lower() in {"red", "void"} or str(invoice.status or "") == "作废":
            continue
        gross = _invoice_gross(invoice)
        remaining = max(ZERO, gross - _invoice_used(db, str(invoice.id)))
        if remaining <= EPS:
            continue
        score = _match_score(bank_payee, invoice.seller_name or invoice.title)
        out.append({
            "id": str(invoice.id),
            "invoice_no": invoice.invoice_no or invoice.digital_invoice_no or invoice.invoice_code or str(invoice.id)[:8],
            "seller_name": invoice.seller_name or invoice.title or "",
            "invoice_date": invoice.invoice_date,
            "gross_amount": float(gross),
            "remaining_amount": float(remaining),
            "match_score": score,
        })
    out.sort(key=lambda item: (item["match_score"], item["invoice_date"] or ""), reverse=True)
    return out


def _funding_rows(db: Session, bank_transaction_id: str) -> list[dict]:
    rows = db.execute(text("""
        SELECT
          funding.*,
          access.product_name,
          contract.contract_name,
          contract.contract_no,
          contract.counterparty
        FROM cf_rd_prepayment_fundings AS funding
        LEFT JOIN cf_contract_access_items AS access ON access.id = funding.access_item_id
        LEFT JOIN cf_contract_records AS contract ON contract.id = funding.contract_id
        WHERE funding.bank_transaction_id = :bank_transaction_id
        ORDER BY funding.created_at ASC, funding.id ASC
    """), {"bank_transaction_id": bank_transaction_id}).mappings().all()
    ids = [str(row["id"]) for row in rows]
    allocations: dict[str, list[dict]] = {item: [] for item in ids}
    if ids:
        stmt = text("""
            SELECT allocation.*, invoice.invoice_no, invoice.digital_invoice_no,
                   invoice.seller_name, invoice.invoice_date
            FROM cf_rd_prepayment_invoice_allocations AS allocation
            JOIN invoice_records AS invoice ON invoice.id = allocation.invoice_id
            WHERE allocation.funding_id IN :ids
            ORDER BY allocation.created_at ASC
        """).bindparams(bindparam("ids", expanding=True))
        for item in db.execute(stmt, {"ids": ids}).mappings().all():
            allocations[str(item["funding_id"])].append({
                "id": str(item["id"]),
                "invoice_id": str(item["invoice_id"]),
                "invoice_no": item.get("invoice_no") or item.get("digital_invoice_no") or str(item["invoice_id"])[:8],
                "seller_name": item.get("seller_name") or "",
                "invoice_date": item.get("invoice_date"),
                "allocated_amount": float(_money(item.get("allocated_amount"))),
            })
    out = []
    for row in rows:
        funding_id = str(row["id"])
        allocated = sum(_money(item["allocated_amount"]) for item in allocations.get(funding_id, []))
        out.append({
            **dict(row),
            "id": funding_id,
            "funded_amount": float(_money(row.get("funded_amount"))),
            "invoice_allocated_amount": float(allocated),
            "invoice_unallocated_amount": float(max(ZERO, _money(row.get("funded_amount")) - allocated)),
            "invoice_allocations": allocations.get(funding_id, []),
        })
    return out


def _bank_context(db: Session, tx: BankTransaction) -> dict:
    expense = _bank_expense(tx)
    fundings = _funding_rows(db, str(tx.id))
    allocated = sum(_money(item["funded_amount"]) for item in fundings)
    payee = str(tx.payee_name or "")
    return {
        "transaction": {
            "id": str(tx.id),
            "trade_date": tx.trade_date,
            "transaction_no": tx.transaction_no,
            "payee_name": tx.payee_name,
            "payer_name": tx.payer_name,
            "summary": tx.summary or tx.purpose or tx.remark,
            "currency": tx.currency or "CNY",
            "expense_amount": float(expense),
            "prepayment_allocated_amount": float(allocated),
            "prepayment_available_amount": float(max(ZERO, expense - allocated)),
            "regular_reconciliation_linked": _regularly_linked(db, tx),
        },
        "fundings": fundings,
        "candidates": _pool_candidates(db, payee),
        "invoice_candidates": _invoice_candidates(db, payee),
    }


def _audit(db: Session, user: AuthUser, entity_id: str, action: str, summary: str, changes: dict, metadata: dict) -> None:
    db.add(OperationLog(
        id=str(uuid4()),
        entity_type="rd_prepayment",
        entity_id=entity_id,
        entity_number=metadata.get("transaction_no") or None,
        action=action,
        summary=summary,
        actor_user_id=str(user.id),
        actor_email=user.email,
        changes=changes,
        metadata_json=metadata,
    ))


@router.get("/bank-context/{bank_transaction_id}")
def bank_context(bank_transaction_id: str, db: Session = Depends(get_db)) -> dict:
    tx = db.get(BankTransaction, bank_transaction_id)
    if tx is None:
        raise HTTPException(status_code=404, detail="银行流水不存在")
    return _bank_context(db, tx)


@router.get("/funding-map")
def funding_map(bank_transaction_ids: str = Query(""), db: Session = Depends(get_db)) -> dict:
    ids = [item.strip() for item in bank_transaction_ids.split(",") if item.strip()][:500]
    if not ids:
        return {"items": []}
    stmt = text("""
        SELECT funding.id, funding.bank_transaction_id, funding.access_item_id,
               funding.funded_amount, access.product_name, contract.contract_name
        FROM cf_rd_prepayment_fundings AS funding
        LEFT JOIN cf_contract_access_items AS access ON access.id = funding.access_item_id
        LEFT JOIN cf_contract_records AS contract ON contract.id = funding.contract_id
        WHERE funding.bank_transaction_id IN :ids
        ORDER BY funding.created_at ASC
    """).bindparams(bindparam("ids", expanding=True))
    return {"items": [
        {
            **dict(row),
            "id": str(row["id"]),
            "bank_transaction_id": str(row["bank_transaction_id"]),
            "funded_amount": float(_money(row.get("funded_amount"))),
        }
        for row in db.execute(stmt, {"ids": ids}).mappings().all()
    ]}


@router.post("/fundings")
def create_funding(
    payload: dict,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    transaction_id = str(payload.get("bank_transaction_id") or "").strip()
    access_item_id = str(payload.get("access_item_id") or "").strip()
    if not transaction_id or not access_item_id:
        raise HTTPException(status_code=422, detail="请选择银行流水和预付款产品")
    tx = db.execute(select(BankTransaction).where(BankTransaction.id == transaction_id).with_for_update()).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=404, detail="银行流水不存在")
    if _regularly_linked(db, tx):
        raise HTTPException(status_code=409, detail="该银行流水已经用于普通账单核销，不能重复登记为研发预付款")
    currency = str(tx.currency or "CNY").strip().upper()
    if currency not in {"CNY", "RMB"}:
        raise HTTPException(status_code=422, detail="当前研发预付款台账仅支持人民币")
    expense = _bank_expense(tx)
    if expense <= EPS:
        raise HTTPException(status_code=422, detail="只有真实支出流水才能登记为研发预付款")

    existing_bank = db.execute(text("""
        SELECT COALESCE(SUM(funded_amount), 0)
        FROM cf_rd_prepayment_fundings
        WHERE bank_transaction_id = :transaction_id
    """), {"transaction_id": transaction_id}).scalar_one()
    bank_remaining = max(ZERO, expense - _money(existing_bank))
    candidate = next((item for item in _pool_candidates(db, str(tx.payee_name or "")) if str(item["access_item_id"]) == access_item_id), None)
    if candidate is None:
        raise HTTPException(status_code=422, detail="该合同产品没有配置可用的研发预付款")
    pool_remaining = _money(candidate["max_fundable_amount"])
    requested = _money(payload.get("funded_amount") or bank_remaining)
    if requested <= ZERO:
        raise HTTPException(status_code=422, detail="预付款登记金额必须大于 0")
    if requested > bank_remaining + EPS:
        raise HTTPException(status_code=409, detail="登记金额超过该银行流水尚未分配的支出金额")
    if requested > pool_remaining + EPS:
        raise HTTPException(status_code=409, detail="登记金额超过合同约定预付款尚未入账的金额")

    funding_id = uuid4().hex
    try:
        db.execute(text("""
            INSERT INTO cf_rd_prepayment_fundings (
              id, access_item_id, contract_id, bank_transaction_id, funded_amount,
              currency, funding_date, note, created_by, created_at, updated_at
            ) VALUES (
              :id, :access_item_id, :contract_id, :bank_transaction_id, :funded_amount,
              'CNY', :funding_date, :note, :created_by, NOW(), NOW()
            )
        """), {
            "id": funding_id,
            "access_item_id": access_item_id,
            "contract_id": str(candidate.get("contract_id") or ""),
            "bank_transaction_id": transaction_id,
            "funded_amount": requested,
            "funding_date": tx.trade_date,
            "note": str(payload.get("note") or "").strip()[:1000],
            "created_by": _actor(user),
        })
    except Exception as exc:
        db.rollback()
        if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
            raise HTTPException(status_code=409, detail="该银行流水已经登记到这个预付款产品") from exc
        raise
    _audit(
        db, user, funding_id, "create", "登记研发预付款银行入账",
        {"funded_amount": {"before": 0, "after": float(requested)}},
        {"bank_transaction_id": transaction_id, "transaction_no": tx.transaction_no, "access_item_id": access_item_id, "product_name": candidate.get("product_name")},
    )
    db.commit()
    return _bank_context(db, tx)


@router.delete("/fundings/{funding_id}")
def delete_funding(
    funding_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    funding = db.execute(text("SELECT * FROM cf_rd_prepayment_fundings WHERE id = :id FOR UPDATE"), {"id": funding_id}).mappings().first()
    if funding is None:
        raise HTTPException(status_code=404, detail="预付款银行入账记录不存在")
    access_id = str(funding["access_item_id"])
    total_funded = _money(db.execute(text("SELECT COALESCE(SUM(funded_amount), 0) FROM cf_rd_prepayment_fundings WHERE access_item_id = :id"), {"id": access_id}).scalar_one())
    used = _money(db.execute(text("SELECT COALESCE(SUM(deduction_amount), 0) FROM cf_rd_prepayment_deductions WHERE access_item_id = :id"), {"id": access_id}).scalar_one())
    after = max(ZERO, total_funded - _money(funding["funded_amount"]))
    if after + EPS < used:
        raise HTTPException(status_code=409, detail=f"该预付款已经实际抵扣 ¥{used:.2f}，解除后银行已付仅 ¥{after:.2f}；请先补足或调整抵扣记录")
    tx = db.get(BankTransaction, str(funding["bank_transaction_id"]))
    db.execute(text("DELETE FROM cf_rd_prepayment_fundings WHERE id = :id"), {"id": funding_id})
    _audit(
        db, user, funding_id, "delete", "解除研发预付款银行入账",
        {"funded_amount": {"before": float(_money(funding["funded_amount"])), "after": 0}},
        {"bank_transaction_id": str(funding["bank_transaction_id"]), "transaction_no": tx.transaction_no if tx else None, "access_item_id": access_id},
    )
    db.commit()
    return _bank_context(db, tx) if tx else {"ok": True}


@router.post("/fundings/{funding_id}/invoices")
def allocate_invoice(
    funding_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    funding = db.execute(text("SELECT * FROM cf_rd_prepayment_fundings WHERE id = :id FOR UPDATE"), {"id": funding_id}).mappings().first()
    if funding is None:
        raise HTTPException(status_code=404, detail="预付款银行入账记录不存在")
    invoice_id = str(payload.get("invoice_id") or "").strip()
    invoice = db.get(InvoiceRecord, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail="发票不存在")
    if invoice.invoice_direction != "input":
        raise HTTPException(status_code=422, detail="研发预付款只能关联进项发票")
    if str(invoice.tax_status or "normal").lower() in {"red", "void"} or str(invoice.status or "") == "作废":
        raise HTTPException(status_code=409, detail="红冲或作废发票不能作为预付款凭证")
    exists = db.execute(text("SELECT id FROM cf_rd_prepayment_invoice_allocations WHERE funding_id = :funding_id AND invoice_id = :invoice_id"), {"funding_id": funding_id, "invoice_id": invoice_id}).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="该发票已经关联到这笔预付款")

    funded = _money(funding["funded_amount"])
    funding_used = _money(db.execute(text("SELECT COALESCE(SUM(allocated_amount), 0) FROM cf_rd_prepayment_invoice_allocations WHERE funding_id = :funding_id"), {"funding_id": funding_id}).scalar_one())
    funding_remaining = max(ZERO, funded - funding_used)
    invoice_remaining = max(ZERO, _invoice_gross(invoice) - _invoice_used(db, invoice_id))
    requested = _money(payload.get("allocated_amount") or min(funding_remaining, invoice_remaining))
    if requested <= ZERO:
        raise HTTPException(status_code=422, detail="发票关联金额必须大于 0")
    if requested > funding_remaining + EPS:
        raise HTTPException(status_code=409, detail="关联金额超过该预付款尚未匹配发票的金额")
    if requested > invoice_remaining + EPS:
        raise HTTPException(status_code=409, detail="关联金额超过该发票尚未分配的金额")

    allocation_id = uuid4().hex
    db.execute(text("""
        INSERT INTO cf_rd_prepayment_invoice_allocations (
          id, funding_id, invoice_id, allocated_amount, created_by, created_at, updated_at
        ) VALUES (:id, :funding_id, :invoice_id, :amount, :created_by, NOW(), NOW())
    """), {"id": allocation_id, "funding_id": funding_id, "invoice_id": invoice_id, "amount": requested, "created_by": _actor(user)})
    tx = db.get(BankTransaction, str(funding["bank_transaction_id"]))
    _audit(
        db, user, funding_id, "link_invoice", "研发预付款关联进项发票",
        {"invoice_allocation": {"before": 0, "after": float(requested)}},
        {"invoice_id": invoice_id, "invoice_no": invoice.invoice_no or invoice.digital_invoice_no, "bank_transaction_id": str(funding["bank_transaction_id"]), "transaction_no": tx.transaction_no if tx else None},
    )
    db.commit()
    return _bank_context(db, tx) if tx else {"ok": True}


@router.delete("/fundings/{funding_id}/invoices/{allocation_id}")
def delete_invoice_allocation(
    funding_id: str,
    allocation_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    allocation = db.execute(text("SELECT * FROM cf_rd_prepayment_invoice_allocations WHERE id = :id AND funding_id = :funding_id"), {"id": allocation_id, "funding_id": funding_id}).mappings().first()
    if allocation is None:
        raise HTTPException(status_code=404, detail="预付款发票关联不存在")
    funding = db.execute(text("SELECT * FROM cf_rd_prepayment_fundings WHERE id = :id"), {"id": funding_id}).mappings().first()
    db.execute(text("DELETE FROM cf_rd_prepayment_invoice_allocations WHERE id = :id"), {"id": allocation_id})
    tx = db.get(BankTransaction, str(funding["bank_transaction_id"])) if funding else None
    _audit(
        db, user, funding_id, "unlink_invoice", "解除研发预付款发票关联",
        {"invoice_allocation": {"before": float(_money(allocation["allocated_amount"])), "after": 0}},
        {"invoice_id": str(allocation["invoice_id"]), "bank_transaction_id": str(funding["bank_transaction_id"]) if funding else None, "transaction_no": tx.transaction_no if tx else None},
    )
    db.commit()
    return _bank_context(db, tx) if tx else {"ok": True}
