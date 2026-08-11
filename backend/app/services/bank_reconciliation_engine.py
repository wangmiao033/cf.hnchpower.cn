"""Unified mutation facade for bank reconciliation.

All public confirmation/allocation/reversal routes should use this module.  The
existing P2 allocation service remains the single source of truth for funding
writes; legacy one-to-one confirmation is only an adapter.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.bank_transaction import BankTransaction
from app.models.channel import ChannelRecord
from app.models.user import AuthUser
from app.services.bank_auto_reconciliation import EPS, _history_row
from app.services.bank_auto_reconciliation_reverse import reverse_confirmed_match
from app.services.bank_multi_allocation import (
    active_matches_for_transaction,
    allocate_transaction,
    transaction_summary,
)
from app.services.channel_cumulative_batch import bill_condition


def _num(value) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed == parsed else 0.0


def _existing_exact_allocations(db: Session, transaction_id: str, allocations: list[dict]):
    """Return existing confirmed matches only when the request is an exact replay."""
    existing = active_matches_for_transaction(db, transaction_id)
    if not existing or not allocations:
        return None
    by_pair = {(str(item.bill_type), str(item.bill_id)): item for item in existing}
    matched = []
    for raw in allocations:
        pair = (str(raw.get("bill_type") or "").strip(), str(raw.get("bill_id") or "").strip())
        requested = round(_num(raw.get("amount")), 2)
        current = by_pair.get(pair)
        if current is None or requested <= EPS or abs(_num(current.linked_amount) - requested) > EPS:
            return None
        matched.append(current)
    return matched


def _assert_cumulative_collection_allowed(db: Session, allocations: list[dict]) -> None:
    for raw in allocations:
        if str(raw.get("bill_type") or "").strip() != "channel":
            continue
        bill_id = str(raw.get("bill_id") or "").strip()
        bill = db.get(ChannelRecord, bill_id)
        if bill is None:
            continue
        condition = bill_condition(db, bill)
        if not condition.get("deferred"):
            continue
        policy = condition.get("policy") or {}
        pool = condition.get("pool") or {}
        threshold = float(policy.get("threshold_amount") or 0)
        if pool.get("ready"):
            message = (
                f"该账单所属合作方累计金额已达到 ¥{threshold:.2f} 门槛，"
                "请先生成累计结算批次，再按批次统一回款核销。"
            )
        else:
            message = (
                f"该账单处于累计结算中：当前累计 ¥{float(pool.get('basis_total') or 0):.2f} / ¥{threshold:.2f}，"
                f"还差 ¥{float(pool.get('remaining_to_threshold') or 0):.2f}。未达门槛前不应作为普通待收账单核销。"
            )
        raise HTTPException(
            status_code=409,
            detail={"error": "cumulative_collection_deferred", "message": message},
        )


def allocate(db: Session, transaction_id: str, allocations: list[dict], user: AuthUser) -> dict:
    """Allocate one bank transaction through the sole P2 allocation write path.

    Exact retries are idempotent: a second click with the same transaction,
    bill(s) and amount(s) returns the existing confirmed allocation instead of
    reporting a duplicate failure.
    """
    tx = db.get(BankTransaction, transaction_id)
    if tx is None:
        raise HTTPException(status_code=404, detail="银行流水不存在")

    replay = _existing_exact_allocations(db, transaction_id, allocations)
    if replay is not None:
        return {
            "matches": [_history_row(match, tx) for match in replay],
            "transaction": transaction_summary(tx, active_matches_for_transaction(db, transaction_id)),
            "message": "核销分配已存在，无需重复操作",
        }

    _assert_cumulative_collection_allowed(db, allocations)
    return allocate_transaction(db, transaction_id, allocations, user)


def confirm_single(db: Session, transaction_id: str, bill_type: str, bill_id: str, user: AuthUser) -> dict:
    """Legacy one-to-one confirmation adapter backed by the unified engine."""
    tx = db.get(BankTransaction, transaction_id)
    if tx is None:
        raise HTTPException(status_code=404, detail="银行流水不存在")

    existing = active_matches_for_transaction(db, transaction_id)
    for match in existing:
        if str(match.bill_type) == str(bill_type) and str(match.bill_id) == str(bill_id):
            return {"match": _history_row(match, tx), "message": "银行流水已核销，无需重复操作"}

    summary = transaction_summary(tx, existing)
    remaining = round(float(summary.get("remaining_amount") or 0), 2)
    if remaining <= EPS:
        raise HTTPException(status_code=409, detail="该银行流水已经全额核销到其他账单")

    result = allocate(
        db,
        transaction_id,
        [{"bill_type": bill_type, "bill_id": bill_id, "amount": remaining}],
        user,
    )
    matches = result.get("matches") or []
    if not matches:
        raise HTTPException(status_code=500, detail="核销已执行但未返回核销记录")
    return {"match": matches[0], "message": result.get("message") or "银行流水核销成功"}


def reverse(db: Session, match_id: str, reason: str, user: AuthUser) -> dict:
    """Reverse exactly one allocation through the P2-aware reversal path."""
    return reverse_confirmed_match(db, match_id, reason, user)
