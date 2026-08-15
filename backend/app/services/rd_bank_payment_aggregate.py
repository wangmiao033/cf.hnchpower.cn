"""研发对账资金聚合：手工付款 + 银行核销分配统一口径。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.models.bank_reconciliation_match import BankReconciliationMatch
from app.models.bank_transaction import BankTransaction
from app.services.rd_prepayment import deductions_for_bill_ids, financial_payable

EPS = Decimal("0.005")
RD_TYPE = "rd"


@dataclass
class RdPaymentAggregate:
    paid_amount: Decimal
    unpaid_amount: Decimal
    payment_status: str
    payment_count: int
    latest_payment_date: str | None
    prepayment_deduction: Decimal = Decimal("0")
    cash_payable_amount: Decimal = Decimal("0")


def _payable_decimal(settlement_amount: Any) -> Decimal:
    try:
        return Decimal(str(settlement_amount or 0))
    except Exception:
        return Decimal("0")


def _compute_status(payable: Decimal, paid: Decimal) -> str:
    if payable <= EPS:
        return "已付款"
    if paid <= EPS:
        return "未付款"
    if paid + EPS < payable:
        return "部分付款"
    return "已付款"


def _date_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    raw = str(value).strip()
    return raw[:10] if raw else None


def aggregate_rd_payments_for_ids(
    db: Session, reconciliation_ids: list[str]
) -> dict[str, RdPaymentAggregate]:
    """按研发账单聚合真实现金付款，并带出预付款抵扣金额。

    - 银行核销：以 bank_reconciliation_matches.confirmed.linked_amount 为事实源。
    - 旧手工付款登记：仍从 bank_transactions(payment_register) 聚合，但排除已有
      confirmed match 的流水，避免同一笔银行钱重复计算。
    - 研发预付款抵扣：作为非现金结算层单独带出，不计入 paid_amount；但会减少
      后续仍需由银行实际支付的 cash_payable_amount / unpaid_amount。
    """
    ids = list(dict.fromkeys(str(value) for value in reconciliation_ids if value))
    if not ids:
        return {}

    totals: dict[str, Decimal] = {item: Decimal("0") for item in ids}
    counts: dict[str, int] = {item: 0 for item in ids}
    latest: dict[str, str | None] = {item: None for item in ids}
    prepayment_map = deductions_for_bill_ids(db, ids)

    match_rows = db.execute(
        select(
            BankReconciliationMatch.bill_id,
            func.coalesce(func.sum(BankReconciliationMatch.linked_amount), 0).label("paid_sum"),
            func.count(BankReconciliationMatch.id).label("cnt"),
            func.max(BankReconciliationMatch.confirmed_at).label("latest_at"),
        )
        .where(
            BankReconciliationMatch.bill_type == RD_TYPE,
            BankReconciliationMatch.direction == "payment",
            BankReconciliationMatch.status == "confirmed",
            BankReconciliationMatch.bill_id.in_(ids),
        )
        .group_by(BankReconciliationMatch.bill_id)
    ).all()
    for rec_id, paid_sum, cnt, latest_at in match_rows:
        sid = str(rec_id)
        totals[sid] = totals.get(sid, Decimal("0")) + Decimal(str(paid_sum or 0))
        counts[sid] = counts.get(sid, 0) + int(cnt or 0)
        latest[sid] = _date_string(latest_at)

    active_match_exists = exists(
        select(BankReconciliationMatch.id).where(
            BankReconciliationMatch.bank_transaction_id == BankTransaction.id,
            BankReconciliationMatch.status == "confirmed",
        )
    ).correlate(BankTransaction)
    paid_expr = func.coalesce(BankTransaction.linked_amount, BankTransaction.amount, 0)
    manual_rows = db.execute(
        select(
            BankTransaction.reconciliation_id,
            func.coalesce(func.sum(paid_expr), 0).label("paid_sum"),
            func.count(BankTransaction.id).label("cnt"),
            func.max(BankTransaction.created_at).label("latest_at"),
        )
        .where(
            BankTransaction.type == "payment_register",
            BankTransaction.reconciliation_type == RD_TYPE,
            BankTransaction.reconciliation_id.in_(ids),
            ~active_match_exists,
        )
        .group_by(BankTransaction.reconciliation_id)
    ).all()
    for rec_id, paid_sum, cnt, latest_at in manual_rows:
        if not rec_id:
            continue
        sid = str(rec_id)
        totals[sid] = totals.get(sid, Decimal("0")) + Decimal(str(paid_sum or 0))
        counts[sid] = counts.get(sid, 0) + int(cnt or 0)
        candidate = _date_string(latest_at)
        if candidate and (latest.get(sid) is None or candidate > str(latest[sid])):
            latest[sid] = candidate

    return {
        sid: RdPaymentAggregate(
            paid_amount=totals.get(sid, Decimal("0")),
            unpaid_amount=Decimal("0"),
            payment_status="未付款",
            payment_count=counts.get(sid, 0),
            latest_payment_date=latest.get(sid),
            prepayment_deduction=max(Decimal("0"), prepayment_map.get(sid, Decimal("0"))),
            cash_payable_amount=Decimal("0"),
        )
        for sid in ids
        if (
            totals.get(sid, Decimal("0")) > EPS
            or counts.get(sid, 0) > 0
            or prepayment_map.get(sid, Decimal("0")) > EPS
        )
    }


def fill_payable_for_row(
    agg: RdPaymentAggregate | None, settlement_amount: Any
) -> RdPaymentAggregate:
    signed_payable = _payable_decimal(settlement_amount)
    paid = agg.paid_amount if agg is not None else Decimal("0")
    requested_prepayment = agg.prepayment_deduction if agg is not None else Decimal("0")
    prepayment, cash_payable = financial_payable(signed_payable, requested_prepayment)
    unpaid = max(Decimal("0"), cash_payable - paid)
    return RdPaymentAggregate(
        paid_amount=paid,
        unpaid_amount=unpaid,
        payment_status=_compute_status(cash_payable, paid),
        payment_count=agg.payment_count if agg is not None else 0,
        latest_payment_date=agg.latest_payment_date if agg is not None else None,
        prepayment_deduction=prepayment,
        cash_payable_amount=cash_payable,
    )
