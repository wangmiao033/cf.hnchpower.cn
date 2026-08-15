"""Read R&D prepayment deductions without coupling core ORM to contract tables."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

EPS = Decimal("0.005")


def _decimal(value: Any) -> Decimal:
    try:
        parsed = Decimal(str(value or 0))
    except Exception:
        return Decimal("0")
    return parsed if parsed.is_finite() else Decimal("0")


def deductions_for_bill_ids(db: Session, bill_ids: list[str]) -> dict[str, Decimal]:
    ids = list(dict.fromkeys(str(value) for value in bill_ids if value))
    if not ids:
        return {}
    exists = db.execute(text("SELECT to_regclass('public.cf_rd_prepayment_deductions')")).scalar_one_or_none()
    if not exists:
        return {}
    stmt = text(
        """
        SELECT bill_id, COALESCE(SUM(deduction_amount), 0) AS deduction_amount
        FROM cf_rd_prepayment_deductions
        WHERE bill_id IN :bill_ids
        GROUP BY bill_id
        """
    ).bindparams(bindparam("bill_ids", expanding=True))
    return {
        str(row.bill_id): max(Decimal("0"), _decimal(row.deduction_amount))
        for row in db.execute(stmt, {"bill_ids": ids}).all()
    }


def bank_funding_transaction_ids(db: Session) -> set[str]:
    """Return bank transactions reserved by R&D prepayment funding or refund flows."""
    ids: set[str] = set()
    funding_exists = db.execute(text("SELECT to_regclass('public.cf_rd_prepayment_fundings')")).scalar_one_or_none()
    if funding_exists:
        ids.update(
            str(row[0])
            for row in db.execute(text("SELECT DISTINCT bank_transaction_id FROM cf_rd_prepayment_fundings")).all()
            if row[0]
        )
    refund_exists = db.execute(text("SELECT to_regclass('public.cf_rd_prepayment_refunds')")).scalar_one_or_none()
    if refund_exists:
        ids.update(
            str(row[0])
            for row in db.execute(text("SELECT DISTINCT bank_transaction_id FROM cf_rd_prepayment_refunds")).all()
            if row[0]
        )
    return ids


def financial_payable(settlement_amount: Any, prepayment_deduction: Any) -> tuple[Decimal, Decimal]:
    """Return capped deduction and remaining cash payable.

    Negative R&D settlements keep their previous absolute cash-payable behavior and
    never add value back to the prepayment pool.
    """
    signed = _decimal(settlement_amount)
    bill_amount = abs(signed)
    requested = max(Decimal("0"), _decimal(prepayment_deduction)) if signed > EPS else Decimal("0")
    deduction = min(bill_amount, requested)
    return deduction, max(Decimal("0"), bill_amount - deduction)
