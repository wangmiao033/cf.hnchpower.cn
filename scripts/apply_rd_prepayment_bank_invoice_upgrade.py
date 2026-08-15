from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, got {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# ---------------------------------------------------------------------------
# Database migration: actual bank-funded prepayment pools + invoice links.
# ---------------------------------------------------------------------------
write(
    "backend/sql/045_rd_prepayment_funding_invoice.sql",
    '''CREATE TABLE IF NOT EXISTS cf_rd_prepayment_deductions (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  line_index INTEGER NOT NULL DEFAULT 0,
  line_id TEXT NOT NULL DEFAULT '',
  access_item_id TEXT NOT NULL,
  contract_id TEXT NOT NULL DEFAULT '',
  settlement_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  deduction_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bill_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_deductions_access
ON cf_rd_prepayment_deductions (access_item_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_deductions_bill
ON cf_rd_prepayment_deductions (bill_id);

CREATE TABLE IF NOT EXISTS cf_rd_prepayment_fundings (
  id TEXT PRIMARY KEY,
  access_item_id TEXT NOT NULL,
  contract_id TEXT NOT NULL DEFAULT '',
  bank_transaction_id TEXT NOT NULL,
  funded_amount NUMERIC(18,2) NOT NULL CHECK (funded_amount > 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  funding_date TEXT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bank_transaction_id, access_item_id)
);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_fundings_access
ON cf_rd_prepayment_fundings (access_item_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_fundings_bank
ON cf_rd_prepayment_fundings (bank_transaction_id, created_at);

CREATE TABLE IF NOT EXISTS cf_rd_prepayment_invoice_allocations (
  id TEXT PRIMARY KEY,
  funding_id TEXT NOT NULL REFERENCES cf_rd_prepayment_fundings(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES invoice_records(id) ON DELETE CASCADE,
  allocated_amount NUMERIC(18,2) NOT NULL CHECK (allocated_amount > 0),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (funding_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_invoice_funding
ON cf_rd_prepayment_invoice_allocations (funding_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_invoice_invoice
ON cf_rd_prepayment_invoice_allocations (invoice_id, created_at);
''',
)
replace_once(
    "backend/app/core/migrations.py",
    '*tuple(f"{number:03d}" for number in range(1, 45)),',
    '*tuple(f"{number:03d}" for number in range(1, 46)),',
)

# ---------------------------------------------------------------------------
# Core service helper: identify bank transactions already committed as R&D
# prepayment, so regular bank reconciliation cannot double-use them.
# ---------------------------------------------------------------------------
replace_once(
    "backend/app/services/rd_prepayment.py",
    'from sqlalchemy import bindparam, text\n',
    'from sqlalchemy import bindparam, text\n',
)
append_marker = '''def financial_payable(settlement_amount: Any, prepayment_deduction: Any) -> tuple[Decimal, Decimal]:
'''
text = read("backend/app/services/rd_prepayment.py")
if "def bank_funding_transaction_ids" not in text:
    insert_at = text.index(append_marker)
    helper = '''def bank_funding_transaction_ids(db: Session) -> set[str]:
    """Return bank transactions reserved as actual R&D prepayment funding."""
    exists = db.execute(text("SELECT to_regclass('public.cf_rd_prepayment_fundings')")).scalar_one_or_none()
    if not exists:
        return set()
    return {
        str(row[0])
        for row in db.execute(text("SELECT DISTINCT bank_transaction_id FROM cf_rd_prepayment_fundings")).all()
        if row[0]
    }


'''
    write("backend/app/services/rd_prepayment.py", text[:insert_at] + helper + text[insert_at:])

# ---------------------------------------------------------------------------
# Backend API: turn imported outgoing bank transactions into product-level
# prepayment funding, and optionally link input invoices as audit evidence.
# ---------------------------------------------------------------------------
write(
    "backend/app/api/rd_prepayment.py",
    '''"""R&D prepayment: actual bank funding and invoice evidence."""

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
    return re.sub(r"[\\s\\-—_·,，.。()（）\\[\\]【】/\\\\]", "", str(value or "").strip().lower())


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
''',
)

# Register API.
replace_once(
    "backend/app/main.py",
    'from app.api.reconciliation import router as reconciliation_router\n',
    'from app.api.reconciliation import router as reconciliation_router\nfrom app.api.rd_prepayment import router as rd_prepayment_router\n',
)
replace_once(
    "backend/app/main.py",
    'app.include_router(bank_auto_reconciliation_router, prefix="/api/bank-auto-reconciliation", tags=["bank-auto-reconciliation"], dependencies=[funds_access])\n',
    'app.include_router(bank_auto_reconciliation_router, prefix="/api/bank-auto-reconciliation", tags=["bank-auto-reconciliation"], dependencies=[funds_access])\napp.include_router(rd_prepayment_router, prefix="/api/rd-prepayments", tags=["rd-prepayments"], dependencies=[funds_access])\n',
)

# Exclude prepayment funding transactions from ordinary bank reconciliation.
replace_once(
    "backend/app/services/bank_auto_reconciliation.py",
    'from app.services.rd_bank_payment_aggregate import (\n',
    'from app.services.rd_prepayment import bank_funding_transaction_ids\nfrom app.services.rd_bank_payment_aggregate import (\n',
)
replace_once(
    "backend/app/services/bank_auto_reconciliation.py",
    '''def build_dashboard(db: Session, limit: int = 200) -> dict:\n    pending_total = int(\n        db.execute(\n            select(func.count(BankTransaction.id)).where(BankTransaction.type == "statement_import")\n        ).scalar_one()\n    )\n    pending = (\n        db.execute(\n            select(BankTransaction)\n            .where(BankTransaction.type == "statement_import")\n            .order_by(BankTransaction.trade_date.desc(), BankTransaction.created_at.desc())\n            .limit(limit)\n        )\n        .scalars()\n        .all()\n    )\n''',
    '''def build_dashboard(db: Session, limit: int = 200) -> dict:\n    funded_ids = bank_funding_transaction_ids(db)\n    predicate = BankTransaction.type == "statement_import"\n    if funded_ids:\n        predicate = predicate & ~BankTransaction.id.in_(funded_ids)\n    pending_total = int(\n        db.execute(select(func.count(BankTransaction.id)).where(predicate)).scalar_one()\n    )\n    pending = (\n        db.execute(\n            select(BankTransaction)\n            .where(predicate)\n            .order_by(BankTransaction.trade_date.desc(), BankTransaction.created_at.desc())\n            .limit(limit)\n        )\n        .scalars()\n        .all()\n    )\n''',
)
replace_once(
    "backend/app/services/bank_auto_reconciliation.py",
    '''    if tx is None:\n        raise HTTPException(status_code=404, detail="银行流水不存在")\n    if tx.type != "statement_import":\n''',
    '''    if tx is None:\n        raise HTTPException(status_code=404, detail="银行流水不存在")\n    if str(tx.id) in bank_funding_transaction_ids(db):\n        raise HTTPException(status_code=409, detail="该流水已经登记为研发预付款，不能再核销普通账单")\n    if tx.type != "statement_import":\n''',
)

replace_once(
    "backend/app/services/bank_multi_allocation.py",
    'from app.services.rd_bank_payment_aggregate import aggregate_rd_payments_for_ids, fill_payable_for_row\n',
    'from app.services.rd_bank_payment_aggregate import aggregate_rd_payments_for_ids, fill_payable_for_row\nfrom app.services.rd_prepayment import bank_funding_transaction_ids\n',
)
replace_once(
    "backend/app/services/bank_multi_allocation.py",
    '''    rows = db.execute(\n        select(BankTransaction)\n        .where(predicate)\n        .order_by(BankTransaction.trade_date.desc(), BankTransaction.created_at.desc())\n    ).scalars().all()\n\n    pool = _candidate_pool(db)\n''',
    '''    rows = db.execute(\n        select(BankTransaction)\n        .where(predicate)\n        .order_by(BankTransaction.trade_date.desc(), BankTransaction.created_at.desc())\n    ).scalars().all()\n    funded_ids = bank_funding_transaction_ids(db)\n    if funded_ids:\n        rows = [row for row in rows if str(row.id) not in funded_ids]\n\n    pool = _candidate_pool(db)\n''',
)
replace_once(
    "backend/app/services/bank_multi_allocation.py",
    '''    if tx is None:\n        raise HTTPException(status_code=404, detail="银行流水不存在")\n    direction, total, blocked = transaction_direction(tx)\n''',
    '''    if tx is None:\n        raise HTTPException(status_code=404, detail="银行流水不存在")\n    if str(tx.id) in bank_funding_transaction_ids(db):\n        raise HTTPException(status_code=409, detail="该流水已经登记为研发预付款，不能再分配到普通账单")\n    direction, total, blocked = transaction_direction(tx)\n''',
)

# ---------------------------------------------------------------------------
# Contract-side prepayment deduction: once actual bank funding exists for a
# product, deductions are capped by real funded money (not just contract amount).
# Legacy products without a linked bank payment keep the previous fallback until
# finance completes the bank-link migration.
# ---------------------------------------------------------------------------
replace_once(
    "contract_terms/rd_prepayment.py",
    '''    used_map: dict[str, Decimal] = {}\n    if access_ids:\n''',
    '''    used_map: dict[str, Decimal] = {}\n    funded_map: dict[str, Decimal] = {}\n    funding_count_map: dict[str, int] = {}\n    funding_table = conn.execute("SELECT to_regclass('public.cf_rd_prepayment_fundings')").fetchone()\n    if access_ids and funding_table and funding_table[0]:\n        placeholders = ",".join(["%s"] * len(access_ids))\n        for row in conn.execute(\n            f"""\n            SELECT access_item_id, COALESCE(SUM(funded_amount), 0) AS funded_amount, COUNT(*) AS funding_count\n            FROM cf_rd_prepayment_fundings\n            WHERE access_item_id IN ({placeholders})\n            GROUP BY access_item_id\n            """,\n            list(access_ids),\n        ).fetchall():\n            access_id = str(row["access_item_id"])\n            funded_map[access_id] = _money(row.get("funded_amount"))\n            funding_count_map[access_id] = int(row.get("funding_count") or 0)\n    if access_ids:\n''',
)
replace_once(
    "contract_terms/rd_prepayment.py",
    '''        agreed = max(ZERO, _money(item.get("prepayment_amount")))\n        used = max(ZERO, used_map.get(access_id, ZERO))\n        available = max(ZERO, agreed - used)\n        item["prepayment_used_amount"] = float(used)\n        item["prepayment_available_amount"] = float(available)\n''',
    '''        agreed = max(ZERO, _money(item.get("prepayment_amount")))\n        used = max(ZERO, used_map.get(access_id, ZERO))\n        actual_funded = max(ZERO, funded_map.get(access_id, ZERO))\n        has_actual_funding = funding_count_map.get(access_id, 0) > 0\n        effective_cap = min(agreed, actual_funded) if has_actual_funding else agreed\n        available = max(ZERO, effective_cap - used)\n        item["prepayment_used_amount"] = float(used)\n        item["prepayment_actual_funded_amount"] = float(actual_funded)\n        item["prepayment_funding_verified"] = has_actual_funding\n        item["prepayment_funding_shortfall"] = float(max(ZERO, used - actual_funded) if has_actual_funding else ZERO)\n        item["prepayment_available_amount"] = float(available)\n''',
)
replace_once(
    "contract_terms/rd_prepayment.py",
    '''                "prepayment_agreed_amount": 0.0,\n                "prepayment_used_amount": 0.0,\n                "prepayment_available_before": 0.0,\n''',
    '''                "prepayment_agreed_amount": 0.0,\n                "prepayment_used_amount": 0.0,\n                "prepayment_actual_funded_amount": 0.0,\n                "prepayment_funding_verified": False,\n                "prepayment_funding_shortfall": 0.0,\n                "prepayment_available_before": 0.0,\n''',
)
replace_once(
    "contract_terms/rd_prepayment.py",
    '''        used_row = conn.execute(\n            """\n            SELECT COALESCE(SUM(deduction_amount), 0) AS used_amount\n            FROM cf_rd_prepayment_deductions\n            WHERE access_item_id = %s\n            """,\n            [access_item_id],\n        ).fetchone()\n        used = max(ZERO, _money(used_row.get("used_amount") if used_row else 0))\n        available = max(ZERO, agreed - used)\n        deduction = min(settlement, available)\n''',
    '''        used_row = conn.execute(\n            """\n            SELECT COALESCE(SUM(deduction_amount), 0) AS used_amount\n            FROM cf_rd_prepayment_deductions\n            WHERE access_item_id = %s\n            """,\n            [access_item_id],\n        ).fetchone()\n        used = max(ZERO, _money(used_row.get("used_amount") if used_row else 0))\n        funding_table = conn.execute("SELECT to_regclass('public.cf_rd_prepayment_fundings')").fetchone()\n        funded = ZERO\n        funding_count = 0\n        if funding_table and funding_table[0]:\n            funding_row = conn.execute(\n                """\n                SELECT COALESCE(SUM(funded_amount), 0) AS funded_amount, COUNT(*) AS funding_count\n                FROM cf_rd_prepayment_fundings\n                WHERE access_item_id = %s\n                """,\n                [access_item_id],\n            ).fetchone()\n            funded = max(ZERO, _money(funding_row.get("funded_amount") if funding_row else 0))\n            funding_count = int(funding_row.get("funding_count") or 0) if funding_row else 0\n        effective_cap = min(agreed, funded) if funding_count > 0 else agreed\n        available = max(ZERO, effective_cap - used)\n        deduction = min(settlement, available)\n''',
)
replace_once(
    "contract_terms/rd_prepayment.py",
    '''                "prepayment_agreed_amount": float(agreed),\n                "prepayment_used_amount": float(used),\n                "prepayment_available_before": float(available),\n''',
    '''                "prepayment_agreed_amount": float(agreed),\n                "prepayment_used_amount": float(used),\n                "prepayment_actual_funded_amount": float(funded),\n                "prepayment_funding_verified": funding_count > 0,\n                "prepayment_funding_shortfall": float(max(ZERO, used - funded) if funding_count > 0 else ZERO),\n                "prepayment_available_before": float(available),\n''',
)

# ---------------------------------------------------------------------------
# Frontend API and modal.
# ---------------------------------------------------------------------------
write(
    "src/lib/api/rdPrepayment.ts",
    '''import { apiDelete, apiGet, apiPost } from '@/lib/api/client.ts'\n\nexport type RdPrepaymentFundingMapItem = {\n  id: string\n  bank_transaction_id: string\n  access_item_id: string\n  funded_amount: number\n  product_name?: string | null\n  contract_name?: string | null\n}\n\nexport type RdPrepaymentBankContext = Record<string, any>\n\nconst PATH = '/api/rd-prepayments'\n\nexport function getRdPrepaymentBankContext(bankTransactionId: string): Promise<RdPrepaymentBankContext> {\n  return apiGet(`${PATH}/bank-context/${encodeURIComponent(bankTransactionId)}`)\n}\n\nexport function getRdPrepaymentFundingMap(bankTransactionIds: string[]): Promise<{ items: RdPrepaymentFundingMapItem[] }> {\n  const ids = bankTransactionIds.filter(Boolean).join(',')\n  return apiGet(`${PATH}/funding-map?bank_transaction_ids=${encodeURIComponent(ids)}`)\n}\n\nexport function createRdPrepaymentFunding(payload: {\n  bank_transaction_id: string\n  access_item_id: string\n  funded_amount: number\n  note?: string\n}): Promise<RdPrepaymentBankContext> {\n  return apiPost(`${PATH}/fundings`, payload)\n}\n\nexport function deleteRdPrepaymentFunding(fundingId: string): Promise<RdPrepaymentBankContext> {\n  return apiDelete(`${PATH}/fundings/${encodeURIComponent(fundingId)}`)\n}\n\nexport function allocateRdPrepaymentInvoice(\n  fundingId: string,\n  payload: { invoice_id: string; allocated_amount: number }\n): Promise<RdPrepaymentBankContext> {\n  return apiPost(`${PATH}/fundings/${encodeURIComponent(fundingId)}/invoices`, payload)\n}\n\nexport function deleteRdPrepaymentInvoiceAllocation(\n  fundingId: string,\n  allocationId: string\n): Promise<RdPrepaymentBankContext> {\n  return apiDelete(`${PATH}/fundings/${encodeURIComponent(fundingId)}/invoices/${encodeURIComponent(allocationId)}`)\n}\n''',
)

write(
    "src/components/bank/RdPrepaymentFundingModal.jsx",
    '''import React, { useEffect, useMemo, useState } from 'react'\nimport {\n  allocateRdPrepaymentInvoice,\n  createRdPrepaymentFunding,\n  deleteRdPrepaymentFunding,\n  deleteRdPrepaymentInvoiceAllocation,\n  getRdPrepaymentBankContext\n} from '@/lib/api/rdPrepayment.ts'\nimport './RdPrepaymentFundingModal.css'\n\nfunction money(value) {\n  const amount = Number(value || 0)\n  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`\n}\n\nexport default function RdPrepaymentFundingModal({ open, transaction, onClose, onSaved }) {\n  const transactionId = String(transaction?.id || '')\n  const [context, setContext] = useState(null)\n  const [loading, setLoading] = useState(false)\n  const [busy, setBusy] = useState('')\n  const [error, setError] = useState('')\n  const [accessItemId, setAccessItemId] = useState('')\n  const [fundingAmount, setFundingAmount] = useState('')\n  const [note, setNote] = useState('')\n  const [invoiceChoice, setInvoiceChoice] = useState({})\n  const [invoiceAmount, setInvoiceAmount] = useState({})\n\n  const load = async () => {\n    if (!transactionId) return\n    setLoading(true)\n    setError('')\n    try {\n      const result = await getRdPrepaymentBankContext(transactionId)\n      setContext(result)\n      const candidates = result.candidates || []\n      const currentExists = candidates.some((item) => String(item.access_item_id) === String(accessItemId))\n      const next = currentExists\n        ? candidates.find((item) => String(item.access_item_id) === String(accessItemId))\n        : candidates.find((item) => item.recommended && Number(item.max_fundable_amount || 0) > 0) || candidates.find((item) => Number(item.max_fundable_amount || 0) > 0) || candidates[0]\n      if (next) setAccessItemId(String(next.access_item_id))\n    } catch (err) {\n      setError(err instanceof Error ? err.message : '预付款信息读取失败')\n    } finally {\n      setLoading(false)\n    }\n  }\n\n  useEffect(() => {\n    if (!open || !transactionId) return\n    setContext(null)\n    setAccessItemId('')\n    setFundingAmount('')\n    setNote('')\n    setInvoiceChoice({})\n    setInvoiceAmount({})\n    void load()\n  }, [open, transactionId])\n\n  const candidates = context?.candidates || []\n  const selected = useMemo(\n    () => candidates.find((item) => String(item.access_item_id) === String(accessItemId)) || null,\n    [candidates, accessItemId]\n  )\n  const bankRemaining = Number(context?.transaction?.prepayment_available_amount || 0)\n  const poolRemaining = Number(selected?.max_fundable_amount || 0)\n  const maxFunding = Math.max(0, Math.min(bankRemaining, poolRemaining))\n\n  useEffect(() => {\n    if (!selected) return\n    const current = Number(fundingAmount || 0)\n    if (!fundingAmount || current <= 0 || current > maxFunding) {\n      setFundingAmount(maxFunding > 0 ? String(maxFunding.toFixed(2)) : '')\n    }\n  }, [accessItemId, maxFunding])\n\n  if (!open) return null\n\n  const applyContext = (result) => {\n    setContext(result)\n    setError('')\n    onSaved?.(result)\n  }\n\n  const createFunding = async () => {\n    if (!selected || busy) return\n    const amount = Number(fundingAmount || 0)\n    if (!Number.isFinite(amount) || amount <= 0) {\n      setError('请输入有效的预付款入账金额')\n      return\n    }\n    setBusy('create')\n    setError('')\n    try {\n      const result = await createRdPrepaymentFunding({\n        bank_transaction_id: transactionId,\n        access_item_id: String(selected.access_item_id),\n        funded_amount: amount,\n        note: note.trim()\n      })\n      applyContext(result)\n      setFundingAmount('')\n      setNote('')\n    } catch (err) {\n      setError(err instanceof Error ? err.message : '预付款登记失败')\n    } finally {\n      setBusy('')\n    }\n  }\n\n  const removeFunding = async (funding) => {\n    if (busy) return\n    if (!window.confirm(`确认解除 ${funding.product_name || '该产品'} ${money(funding.funded_amount)} 的预付款银行入账吗？`)) return\n    setBusy(`funding:${funding.id}`)\n    try {\n      applyContext(await deleteRdPrepaymentFunding(String(funding.id)))\n    } catch (err) {\n      setError(err instanceof Error ? err.message : '解除预付款失败')\n    } finally {\n      setBusy('')\n    }\n  }\n\n  const linkInvoice = async (funding) => {\n    if (busy) return\n    const invoiceId = invoiceChoice[funding.id]\n    const amount = Number(invoiceAmount[funding.id] || 0)\n    if (!invoiceId) {\n      setError('请先选择进项发票')\n      return\n    }\n    if (!Number.isFinite(amount) || amount <= 0) {\n      setError('请输入有效的发票关联金额')\n      return\n    }\n    setBusy(`invoice:${funding.id}`)\n    try {\n      const result = await allocateRdPrepaymentInvoice(String(funding.id), { invoice_id: invoiceId, allocated_amount: amount })\n      applyContext(result)\n      setInvoiceChoice((current) => ({ ...current, [funding.id]: '' }))\n      setInvoiceAmount((current) => ({ ...current, [funding.id]: '' }))\n    } catch (err) {\n      setError(err instanceof Error ? err.message : '发票关联失败')\n    } finally {\n      setBusy('')\n    }\n  }\n\n  const unlinkInvoice = async (funding, allocation) => {\n    if (busy) return\n    if (!window.confirm(`解除发票 ${allocation.invoice_no} 的 ${money(allocation.allocated_amount)} 关联吗？`)) return\n    setBusy(`invoice-delete:${allocation.id}`)\n    try {\n      applyContext(await deleteRdPrepaymentInvoiceAllocation(String(funding.id), String(allocation.id)))\n    } catch (err) {\n      setError(err instanceof Error ? err.message : '解除发票关联失败')\n    } finally {\n      setBusy('')\n    }\n  }\n\n  const chooseInvoice = (funding, invoiceId) => {\n    setInvoiceChoice((current) => ({ ...current, [funding.id]: invoiceId }))\n    const invoice = (context?.invoice_candidates || []).find((item) => String(item.id) === String(invoiceId))\n    const suggested = Math.min(Number(funding.invoice_unallocated_amount || 0), Number(invoice?.remaining_amount || 0))\n    setInvoiceAmount((current) => ({ ...current, [funding.id]: suggested > 0 ? suggested.toFixed(2) : '' }))\n  }\n\n  const tx = context?.transaction\n  const fundings = context?.fundings || []\n  const invoices = context?.invoice_candidates || []\n\n  return (\n    <div className="rd-prepay-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose?.() }}>\n      <section className="rd-prepay-modal" role="dialog" aria-modal="true" aria-label="研发预付款银行入账">\n        <header className="rd-prepay-modal__head">\n          <div><span>研发预付款 · 银行事实入账</span><h2>{tx?.payee_name || transaction?.payee_name || '银行支出流水'}</h2><p>{tx?.trade_date || '-'} · {tx?.transaction_no || '无流水号'} · {tx?.summary || '无摘要'}</p></div>\n          <button type="button" disabled={Boolean(busy)} onClick={onClose}>×</button>\n        </header>\n\n        {loading && !context ? <div className="rd-prepay-modal__loading">正在读取合同、银行预付款与发票台账…</div> : null}\n        {error ? <div className="rd-prepay-modal__error">{error}</div> : null}\n\n        {context ? (\n          <>\n            <div className="rd-prepay-modal__bank-summary">\n              <div><span>本笔银行支出</span><strong>{money(tx.expense_amount)}</strong></div>\n              <div><span>已登记预付款</span><strong>{money(tx.prepayment_allocated_amount)}</strong></div>\n              <div><span>尚可分配</span><strong>{money(tx.prepayment_available_amount)}</strong></div>\n              <div className={tx.regular_reconciliation_linked ? 'is-warning' : ''}><span>普通账单核销</span><strong>{tx.regular_reconciliation_linked ? '已占用' : '未占用'}</strong></div>\n            </div>\n\n            {fundings.length ? (\n              <section className="rd-prepay-modal__section">\n                <div className="rd-prepay-modal__section-head"><div><h3>已登记预付款</h3><p>这里的金额已经成为该研发产品真实可追溯的预付款资金来源。</p></div><em>{fundings.length} 条</em></div>\n                <div className="rd-prepay-modal__fundings">\n                  {fundings.map((funding) => {\n                    const pool = candidates.find((item) => String(item.access_item_id) === String(funding.access_item_id))\n                    return (\n                      <article key={funding.id} className="rd-prepay-funding-card">\n                        <div className="rd-prepay-funding-card__title"><div><strong>{funding.product_name || pool?.product_name || '未命名产品'}</strong><span>{funding.contract_name || pool?.contract_name || '未命名合同'}</span></div><b>{money(funding.funded_amount)}</b></div>\n                        <div className="rd-prepay-funding-card__metrics">\n                          <div><span>合同预付</span><strong>{money(pool?.prepayment_agreed_amount)}</strong></div>\n                          <div><span>银行已付</span><strong>{money(pool?.actual_funded_amount)}</strong></div>\n                          <div><span>已抵扣</span><strong>{money(pool?.deducted_amount)}</strong></div>\n                          <div><span>当前可用</span><strong>{money(pool?.available_balance)}</strong></div>\n                        </div>\n                        {Number(pool?.funding_shortfall || 0) > 0 ? <div className="rd-prepay-funding-card__warning">历史已抵扣比当前已关联银行资金多 {money(pool.funding_shortfall)}，请继续补齐历史预付款流水。</div> : null}\n                        <div className="rd-prepay-funding-card__invoice-list">\n                          {(funding.invoice_allocations || []).map((allocation) => (\n                            <span key={allocation.id}>发票 {allocation.invoice_no} · {money(allocation.allocated_amount)}<button type="button" disabled={Boolean(busy)} onClick={() => void unlinkInvoice(funding, allocation)}>×</button></span>\n                          ))}\n                          {!funding.invoice_allocations?.length ? <small>尚未关联进项发票</small> : null}\n                        </div>\n                        {Number(funding.invoice_unallocated_amount || 0) > 0.01 ? (\n                          <div className="rd-prepay-funding-card__invoice-link">\n                            <select value={invoiceChoice[funding.id] || ''} onChange={(event) => chooseInvoice(funding, event.target.value)}>\n                              <option value="">选择进项发票</option>\n                              {invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_no} · {invoice.seller_name || '未填销方'} · 可用 {money(invoice.remaining_amount)}</option>)}\n                            </select>\n                            <input type="number" min="0" step="0.01" value={invoiceAmount[funding.id] || ''} onChange={(event) => setInvoiceAmount((current) => ({ ...current, [funding.id]: event.target.value }))} placeholder="关联金额" />\n                            <button type="button" disabled={Boolean(busy)} onClick={() => void linkInvoice(funding)}>{busy === `invoice:${funding.id}` ? '关联中…' : '关联发票'}</button>\n                          </div>\n                        ) : null}\n                        <div className="rd-prepay-funding-card__foot"><span>发票已覆盖 {money(funding.invoice_allocated_amount)} / {money(funding.funded_amount)}</span><button type="button" className="is-danger" disabled={Boolean(busy)} onClick={() => void removeFunding(funding)}>{busy === `funding:${funding.id}` ? '处理中…' : '解除银行入账'}</button></div>\n                      </article>\n                    )\n                  })}\n                </div>\n              </section>\n            ) : null}\n\n            <section className="rd-prepay-modal__section">\n              <div className="rd-prepay-modal__section-head"><div><h3>登记到研发产品</h3><p>只有合同合作清单里配置了“预付款（抵扣研发结算）”的产品才会出现在这里。</p></div></div>\n              {tx.regular_reconciliation_linked ? <div className="rd-prepay-modal__blocked">这笔流水已经核销普通账单，不能再重复登记为预付款。</div> : null}\n              <div className="rd-prepay-modal__form">\n                <label><span>预付款产品</span><select value={accessItemId} onChange={(event) => setAccessItemId(event.target.value)} disabled={tx.regular_reconciliation_linked}><option value="">请选择</option>{candidates.map((item) => <option key={item.access_item_id} value={item.access_item_id} disabled={Number(item.max_fundable_amount || 0) <= 0}>{item.recommended ? '★ ' : ''}{item.product_name || '未命名产品'} · {item.contract_name || '未命名合同'} · 尚可入账 {money(item.max_fundable_amount)}</option>)}</select></label>\n                {selected ? <div className="rd-prepay-modal__pool"><div><span>合同约定</span><strong>{money(selected.prepayment_agreed_amount)}</strong></div><div><span>银行已付</span><strong>{money(selected.actual_funded_amount)}</strong></div><div><span>累计抵扣</span><strong>{money(selected.deducted_amount)}</strong></div><div><span>当前可用</span><strong>{money(selected.available_balance)}</strong></div></div> : null}\n                <label><span>本次登记金额</span><input type="number" min="0" step="0.01" value={fundingAmount} onChange={(event) => setFundingAmount(event.target.value)} disabled={tx.regular_reconciliation_linked || !selected} /><small>本次最多 {money(maxFunding)}（受银行未分配金额和合同剩余预付款双重限制）</small></label>\n                <label><span>备注（可选）</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：合同首笔预付款 / 第二期预付" /></label>\n                <button type="button" className="rd-prepay-modal__primary" disabled={Boolean(busy) || tx.regular_reconciliation_linked || !selected || maxFunding <= 0} onClick={() => void createFunding()}>{busy === 'create' ? '登记中…' : '确认登记预付款'}</button>\n              </div>\n            </section>\n\n            <footer className="rd-prepay-modal__hint">发票这里只建立“预付款资金凭证”关联；研发月度账单的发票覆盖仍按完整研发应结金额独立核算，不会被预付款抵扣冲掉。</footer>\n          </>\n        ) : null}\n      </section>\n    </div>\n  )\n}\n''',
)

write(
    "src/components/bank/RdPrepaymentFundingModal.css",
    '''.rd-prepay-modal-backdrop { position: fixed; inset: 0; z-index: 1800; display: grid; place-items: center; padding: 20px; background: rgb(15 23 42 / 48%); }\n.rd-prepay-modal { width: min(980px, calc(100vw - 40px)); max-height: calc(100vh - 40px); overflow: auto; border: 1px solid #dbe3ef; border-radius: 10px; background: #fff; box-shadow: 0 24px 70px rgb(15 23 42 / 24%); color: var(--admin-text-main); }\n.rd-prepay-modal__head { position: sticky; top: 0; z-index: 3; display: flex; justify-content: space-between; gap: 20px; padding: 18px 20px 16px; border-bottom: 1px solid var(--admin-border-soft); background: #fff; }\n.rd-prepay-modal__head span { color: var(--admin-primary); font-size: 12px; font-weight: 800; }\n.rd-prepay-modal__head h2 { margin: 4px 0; font-size: 20px; }\n.rd-prepay-modal__head p { margin: 0; color: var(--admin-text-sub); font-size: 12px; }\n.rd-prepay-modal__head > button { width: 32px; height: 32px; border: 0; border-radius: 7px; background: #f1f5f9; color: #475569; font-size: 20px; cursor: pointer; }\n.rd-prepay-modal__loading, .rd-prepay-modal__error, .rd-prepay-modal__blocked { margin: 14px 20px; padding: 11px 13px; border-radius: 7px; font-size: 13px; }\n.rd-prepay-modal__loading { background: #eff6ff; color: #1d4ed8; }\n.rd-prepay-modal__error, .rd-prepay-modal__blocked { background: #fff1f2; color: #be123c; }\n.rd-prepay-modal__bank-summary, .rd-prepay-modal__pool, .rd-prepay-funding-card__metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }\n.rd-prepay-modal__bank-summary { border-bottom: 1px solid var(--admin-border-soft); background: #f8fafc; }\n.rd-prepay-modal__bank-summary > div, .rd-prepay-modal__pool > div, .rd-prepay-funding-card__metrics > div { padding: 12px 15px; border-right: 1px solid var(--admin-border-soft); }\n.rd-prepay-modal__bank-summary > div:last-child, .rd-prepay-modal__pool > div:last-child, .rd-prepay-funding-card__metrics > div:last-child { border-right: 0; }\n.rd-prepay-modal__bank-summary span, .rd-prepay-modal__pool span, .rd-prepay-funding-card__metrics span { display: block; color: var(--admin-text-tertiary); font-size: 11px; }\n.rd-prepay-modal__bank-summary strong, .rd-prepay-modal__pool strong, .rd-prepay-funding-card__metrics strong { display: block; margin-top: 4px; font-size: 15px; font-variant-numeric: tabular-nums; }\n.rd-prepay-modal__bank-summary .is-warning strong { color: #be123c; }\n.rd-prepay-modal__section { padding: 18px 20px; border-bottom: 1px solid var(--admin-border-soft); }\n.rd-prepay-modal__section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 12px; }\n.rd-prepay-modal__section-head h3 { margin: 0; font-size: 15px; }\n.rd-prepay-modal__section-head p { margin: 4px 0 0; color: var(--admin-text-sub); font-size: 12px; }\n.rd-prepay-modal__section-head em { padding: 3px 8px; border-radius: 999px; background: #eef2ff; color: #4338ca; font-size: 11px; font-style: normal; font-weight: 700; }\n.rd-prepay-modal__fundings { display: grid; gap: 10px; }\n.rd-prepay-funding-card { overflow: hidden; border: 1px solid #dbe5f1; border-radius: 8px; background: #fff; }\n.rd-prepay-funding-card__title { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 13px; background: #f8fafc; }\n.rd-prepay-funding-card__title strong, .rd-prepay-funding-card__title span { display: block; }\n.rd-prepay-funding-card__title span { margin-top: 3px; color: var(--admin-text-sub); font-size: 11px; }\n.rd-prepay-funding-card__title b { color: #166534; font-size: 17px; }\n.rd-prepay-funding-card__metrics { border-top: 1px solid var(--admin-border-soft); border-bottom: 1px solid var(--admin-border-soft); }\n.rd-prepay-funding-card__warning { padding: 9px 12px; background: #fff7ed; color: #b45309; font-size: 12px; }\n.rd-prepay-funding-card__invoice-list { display: flex; flex-wrap: wrap; gap: 7px; padding: 10px 12px; }\n.rd-prepay-funding-card__invoice-list span { display: inline-flex; align-items: center; gap: 6px; padding: 4px 7px; border-radius: 6px; background: #ecfdf5; color: #047857; font-size: 11px; }\n.rd-prepay-funding-card__invoice-list span button { border: 0; background: transparent; color: #047857; cursor: pointer; }\n.rd-prepay-funding-card__invoice-list small { color: var(--admin-text-tertiary); }\n.rd-prepay-funding-card__invoice-link { display: grid; grid-template-columns: minmax(0, 1fr) 140px auto; gap: 8px; padding: 0 12px 10px; }\n.rd-prepay-funding-card__invoice-link select, .rd-prepay-funding-card__invoice-link input, .rd-prepay-modal__form select, .rd-prepay-modal__form input { height: 36px; min-width: 0; border: 1px solid var(--admin-border); border-radius: 7px; padding: 0 10px; background: #fff; }\n.rd-prepay-funding-card__invoice-link button, .rd-prepay-funding-card__foot button { height: 36px; padding: 0 11px; border: 1px solid var(--admin-border); border-radius: 7px; background: #fff; color: var(--admin-primary); font-weight: 700; cursor: pointer; }\n.rd-prepay-funding-card__foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 12px; border-top: 1px solid var(--admin-border-soft); color: var(--admin-text-sub); font-size: 11px; }\n.rd-prepay-funding-card__foot button.is-danger { color: #be123c; border-color: #fecdd3; }\n.rd-prepay-modal__form { display: grid; grid-template-columns: minmax(240px, 1.4fr) minmax(180px, .7fr) minmax(220px, 1fr) auto; gap: 10px; align-items: end; }\n.rd-prepay-modal__form label { display: flex; min-width: 0; flex-direction: column; gap: 5px; color: var(--admin-text-sub); font-size: 11px; font-weight: 700; }\n.rd-prepay-modal__form label:first-child { grid-column: span 2; }\n.rd-prepay-modal__form label small { color: var(--admin-text-tertiary); font-weight: 500; }\n.rd-prepay-modal__pool { grid-column: 1 / -1; overflow: hidden; border: 1px solid var(--admin-border-soft); border-radius: 7px; background: #f8fafc; }\n.rd-prepay-modal__primary { height: 36px; padding: 0 14px; border: 1px solid var(--admin-primary); border-radius: 7px; background: var(--admin-primary); color: #fff; font-weight: 800; cursor: pointer; }\n.rd-prepay-modal button:disabled, .rd-prepay-modal input:disabled, .rd-prepay-modal select:disabled { cursor: not-allowed; opacity: .55; }\n.rd-prepay-modal__hint { padding: 12px 20px 16px; color: var(--admin-text-tertiary); font-size: 11px; line-height: 1.6; }\n@media (max-width: 760px) { .rd-prepay-modal { width: calc(100vw - 20px); max-height: calc(100vh - 20px); } .rd-prepay-modal-backdrop { padding: 10px; } .rd-prepay-modal__bank-summary, .rd-prepay-modal__pool, .rd-prepay-funding-card__metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } .rd-prepay-modal__form { grid-template-columns: 1fr; } .rd-prepay-modal__form label:first-child, .rd-prepay-modal__pool { grid-column: auto; } .rd-prepay-funding-card__invoice-link { grid-template-columns: 1fr; } }\n''',
)

# BankCenter integration.
replace_once(
    "src/pages/BankCenterPage.jsx",
    "import BankCenterImportModal from '@/components/bank/BankCenterImportModal.jsx'\n",
    "import BankCenterImportModal from '@/components/bank/BankCenterImportModal.jsx'\nimport RdPrepaymentFundingModal from '@/components/bank/RdPrepaymentFundingModal.jsx'\n",
)
replace_once(
    "src/pages/BankCenterPage.jsx",
    "} from '@/lib/api/bankTransaction.ts'\n",
    "} from '@/lib/api/bankTransaction.ts'\nimport { getRdPrepaymentFundingMap } from '@/lib/api/rdPrepayment.ts'\n",
)
replace_once(
    "src/pages/BankCenterPage.jsx",
    "  const [importOpen, setImportOpen] = useState(false)\n\n  const [ledgerRows, setLedgerRows] = useState([])\n",
    "  const [importOpen, setImportOpen] = useState(false)\n  const [prepaymentTarget, setPrepaymentTarget] = useState(null)\n  const [prepaymentMap, setPrepaymentMap] = useState({})\n\n  const [ledgerRows, setLedgerRows] = useState([])\n",
)
ledger_effect_marker = "  }, [activeTab, ledgerRevision, dataRevision, ledgerSearch, serverDateRange.from, serverDateRange.to, amountMin, amountMax, accountFilter, sourceFileFilter])\n\n  useEffect(() => {\n    if (activeTab !== 'ledger') return undefined\n    let cancelled = false\n    setAccountsLoading(true)\n"
ledger_effect_insert = "  }, [activeTab, ledgerRevision, dataRevision, ledgerSearch, serverDateRange.from, serverDateRange.to, amountMin, amountMax, accountFilter, sourceFileFilter])\n\n  useEffect(() => {\n    if (activeTab !== 'ledger' || ledgerRows.length === 0) {\n      setPrepaymentMap({})\n      return undefined\n    }\n    let cancelled = false\n    getRdPrepaymentFundingMap(ledgerRows.map((row) => String(row.id)))\n      .then((result) => {\n        if (cancelled) return\n        const next = {}\n        for (const item of result.items || []) {\n          const key = String(item.bank_transaction_id || '')\n          if (!key) continue\n          if (!next[key]) next[key] = []\n          next[key].push(item)\n        }\n        setPrepaymentMap(next)\n      })\n      .catch(() => { if (!cancelled) setPrepaymentMap({}) })\n    return () => { cancelled = true }\n  }, [activeTab, ledgerRows])\n\n  useEffect(() => {\n    if (activeTab !== 'ledger') return undefined\n    let cancelled = false\n    setAccountsLoading(true)\n"
replace_once("src/pages/BankCenterPage.jsx", ledger_effect_marker, ledger_effect_insert)
replace_once(
    "src/pages/BankCenterPage.jsx",
    '''  const visibleLedger = useMemo(() => ledgerRows.filter((row) => {\n    const direction = directionOf(row)\n    if (ledgerDirection !== 'all' && direction !== ledgerDirection) return false\n    const linked = linkedOf(row)\n    if (ledgerLinked === 'linked' && !linked) return false\n    if (ledgerLinked === 'unlinked' && linked) return false\n    return true\n  }), [ledgerRows, ledgerDirection, ledgerLinked])\n''',
    '''  const visibleLedger = useMemo(() => ledgerRows.filter((row) => {\n    const direction = directionOf(row)\n    if (ledgerDirection !== 'all' && direction !== ledgerDirection) return false\n    const linked = linkedOf(row) || Boolean(prepaymentMap[String(row.id)]?.length)\n    if (ledgerLinked === 'linked' && !linked) return false\n    if (ledgerLinked === 'unlinked' && linked) return false\n    return true\n  }), [ledgerRows, ledgerDirection, ledgerLinked, prepaymentMap])\n''',
)
replace_once(
    "src/pages/BankCenterPage.jsx",
    '''                              {canManage ? <button type="button" className={item.auto_ready ? 'is-primary' : ''} disabled={!candidate || busyId === item.transaction_id} onClick={() => confirmSelected(item)}>{busyId === item.transaction_id ? '处理中…' : item.auto_ready ? '确认核销' : '人工确认'}</button> : null}\n''',
    '''                              {canManage && item.direction === 'payment' ? <button type="button" disabled={busyId === item.transaction_id} onClick={() => setPrepaymentTarget({ id: item.transaction_id })}>预付款</button> : null}\n                              {canManage ? <button type="button" className={item.auto_ready ? 'is-primary' : ''} disabled={!candidate || busyId === item.transaction_id} onClick={() => confirmSelected(item)}>{busyId === item.transaction_id ? '处理中…' : item.auto_ready ? '确认核销' : '人工确认'}</button> : null}\n''',
)
replace_once(
    "src/pages/BankCenterPage.jsx",
    '''                  {visibleLedger.map((row) => {\n                    const direction = directionOf(row)\n                    const linked = linkedOf(row)\n                    return (\n''',
    '''                  {visibleLedger.map((row) => {\n                    const direction = directionOf(row)\n                    const linked = linkedOf(row)\n                    const prepaymentLinks = prepaymentMap[String(row.id)] || []\n                    const prepaymentLinked = prepaymentLinks.length > 0\n                    const financialLinked = linked || prepaymentLinked\n                    return (\n''',
)
replace_once(
    "src/pages/BankCenterPage.jsx",
    '''                        <td><span className={`bank-center-ledger-status ${linked ? 'is-linked' : 'is-unlinked'}`}>{linked ? '已核销' : '待核销'}</span></td>\n                        <td>{linked ? <span className="bank-center-linked-no">{linkedNo(row)}</span> : <span className="bank-center-muted">-</span>}</td>\n''',
    '''                        <td><span className={`bank-center-ledger-status ${financialLinked ? 'is-linked' : 'is-unlinked'}`}>{linked ? '已核销' : prepaymentLinked ? '研发预付款' : '待核销'}</span></td>\n                        <td>{linked ? <span className="bank-center-linked-no">{linkedNo(row)}</span> : prepaymentLinked ? <button type="button" className="bank-center-more-action" onClick={() => setPrepaymentTarget(row)}>预付款 · {prepaymentLinks[0]?.product_name || '研发产品'}{prepaymentLinks.length > 1 ? ` (+${prepaymentLinks.length - 1})` : ''}</button> : direction === 'expense' && canManage ? <button type="button" className="bank-center-more-action" onClick={() => setPrepaymentTarget(row)}>登记预付款</button> : <span className="bank-center-muted">-</span>}</td>\n''',
)
replace_once(
    "src/pages/BankCenterPage.jsx",
    '''      <BankCenterImportModal\n        open={importOpen}\n''',
    '''      <RdPrepaymentFundingModal\n        open={Boolean(prepaymentTarget)}\n        transaction={prepaymentTarget}\n        onClose={() => setPrepaymentTarget(null)}\n        onSaved={() => {\n          refreshDashboard()\n          refreshLedger()\n        }}\n      />\n\n      <BankCenterImportModal\n        open={importOpen}\n''',
)

# ---------------------------------------------------------------------------
# Regression tests for actual-funding semantics and duplicate-use guard helper.
# ---------------------------------------------------------------------------
write(
    "backend/tests/test_rd_prepayment_funding_math.py",
    '''import unittest\nfrom decimal import Decimal\n\nfrom app.services.rd_prepayment import financial_payable\n\n\nclass RdPrepaymentFundingMathTests(unittest.TestCase):\n    def test_actual_bank_cap_still_reduces_cash_payable(self):\n        deduction, payable = financial_payable(100, 60)\n        self.assertEqual(deduction, Decimal("60"))\n        self.assertEqual(payable, Decimal("40"))\n\n    def test_deduction_never_exceeds_bill(self):\n        deduction, payable = financial_payable(50, 200)\n        self.assertEqual(deduction, Decimal("50"))\n        self.assertEqual(payable, Decimal("0"))\n\n\nif __name__ == "__main__":\n    unittest.main()\n''',
)

write(
    "contract_terms/test_rd_prepayment_actual_funding.py",
    '''import unittest\nfrom decimal import Decimal\n\nfrom rd_prepayment import _money\n\n\nclass RdPrepaymentActualFundingTests(unittest.TestCase):\n    def test_money_rounds_to_financial_cent(self):\n        self.assertEqual(_money("12.345"), Decimal("12.35"))\n\n    def test_money_rejects_invalid_values(self):\n        self.assertEqual(_money("not-a-number"), Decimal("0.00"))\n\n\nif __name__ == "__main__":\n    unittest.main()\n''',
)

print("R&D prepayment bank/invoice upgrade applied")
