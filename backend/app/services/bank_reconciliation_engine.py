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
from app.services.bank_auto_reconciliation import (
    EPS,
    _candidate_pool,
    _history_row,
    _transaction_counterparty,
    transaction_direction,
)
from app.services.bank_auto_reconciliation_reverse import reverse_confirmed_match
from app.services.bank_combination_match import build_exact_combination
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


def _legacy_exact_combination_allocations(
    db: Session,
    tx: BankTransaction,
    bill_type: str,
    bill_id: str,
    remaining: float,
) -> list[dict] | None:
    """识别主表的合成组合候选，并在写入前重新计算真实分配。

    仅当所点账单正好是最优组合的第一张、且单张未结不足以承接整笔流水时触发。
    因此普通一对一确认不会被静默改成组合核销。
    """
    direction, _total, blocked = transaction_direction(tx)
    if blocked or direction == "unknown":
        return None
    candidates = list(_candidate_pool(db).get(direction, []))
    requested = next(
        (
            candidate
            for candidate in candidates
            if str(candidate.get("bill_type") or "") == str(bill_type)
            and str(candidate.get("bill_id") or "") == str(bill_id)
        ),
        None,
    )
    if requested is None or remaining <= _num(requested.get("outstanding_amount")) + EPS:
        return None

    plan = build_exact_combination(
        {
            "direction": direction,
            "remaining_amount": remaining,
            "counterparty_name": _transaction_counterparty(tx, direction),
            "candidates": candidates,
        }
    )
    if not plan or not plan.get("items"):
        return None

    first = plan["items"][0]["candidate"]
    if (
        str(first.get("bill_type") or "") != str(bill_type)
        or str(first.get("bill_id") or "") != str(bill_id)
    ):
        return None
    if plan.get("ambiguous"):
        raise HTTPException(
            status_code=409,
            detail="该流水存在多个同等级精确账单组合，请使用多对多核销人工选择后再确认。",
        )

    return [
        {
            "bill_type": str(item["candidate"].get("bill_type") or ""),
            "bill_id": str(item["candidate"].get("bill_id") or ""),
            "amount": round(_num(item.get("amount")), 2),
        }
        for item in plan["items"]
    ]


def confirm_single(db: Session, transaction_id: str, bill_type: str, bill_id: str, user: AuthUser) -> dict:
    """Legacy confirmation adapter backed by the unified P2 allocation engine.

    主表可返回一个“组合N张”的合成候选；点击原有确认按钮时，本函数会重新计算
    组合并一次性写入多条 allocation。资金事实仍然只由 allocate() 负责。
    """
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

    combination_allocations = _legacy_exact_combination_allocations(
        db, tx, bill_type, bill_id, remaining
    )
    if combination_allocations:
        result = allocate(db, transaction_id, combination_allocations, user)
        matches = result.get("matches") or []
        if not matches:
            raise HTTPException(status_code=500, detail="组合核销已执行但未返回核销记录")
        return {
            "match": matches[0],
            "message": f"银行流水组合核销成功：已分配到 {len(matches)} 张账单",
        }

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
