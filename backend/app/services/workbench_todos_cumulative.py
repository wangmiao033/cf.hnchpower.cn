"""Cumulative-settlement aware wrapper around the existing workbench todos."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.channel import ChannelRecord
from app.models.channel_cumulative_settlement import ChannelCumulativeSettlementPolicy
from app.services.channel_cumulative_policy import EPS, deferred_bill_ids, pool_state
from app.services.workbench_todos import build_workbench_todos as _build_base


def _num(value: Any) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed == parsed else 0.0


def _adjust_item(items: list[dict], key: str, remove_count: int, remove_amount: float) -> None:
    for item in list(items):
        if item.get("key") != key:
            continue
        item["count"] = max(0, int(item.get("count") or 0) - int(remove_count or 0))
        if item.get("amount") is not None:
            item["amount"] = round(max(0.0, _num(item.get("amount")) - remove_amount), 2)
        if item["count"] <= 0:
            items.remove(item)
        return


def build_workbench_todos(
    db: Session,
    permissions: set[str],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    payload = _build_base(db, permissions, now=now)
    can_recon = "reconciliation.view" in permissions
    can_funds = "funds.view" in permissions
    can_invoices = "invoices.view" in permissions
    if not (can_recon or can_funds or can_invoices):
        return payload

    confirmed_rows = list(
        db.execute(
            select(ChannelRecord).where(ChannelRecord.status == "confirmed")
        ).scalars().all()
    )
    deferred_ids = deferred_bill_ids(db, confirmed_rows)
    deferred_rows = [
        row for row in confirmed_rows
        if str(row.id) in deferred_ids and _num(row.settlement_amount) > EPS
    ]
    deferred_count = len(deferred_rows)
    deferred_amount = round(
        sum(max(0.0, _num(row.settlement_amount) - max(0.0, _num(row.received_amount))) for row in deferred_rows),
        2,
    )

    items = list(payload.get("items") or [])
    if can_funds and deferred_count:
        _adjust_item(items, "channel_receivable", deferred_count, deferred_amount)
        summary = payload.get("summary") or {}
        summary["receivable_amount"] = round(max(0.0, _num(summary.get("receivable_amount")) - deferred_amount), 2)
    if can_invoices and deferred_count:
        _adjust_item(items, "output_invoice_gap", deferred_count, deferred_amount)
        summary = payload.get("summary") or {}
        summary["invoice_gap_amount"] = round(max(0.0, _num(summary.get("invoice_gap_amount")) - deferred_amount), 2)

    if can_recon:
        policies = db.execute(
            select(ChannelCumulativeSettlementPolicy).where(
                ChannelCumulativeSettlementPolicy.enabled.is_(True),
                ChannelCumulativeSettlementPolicy.settlement_mode == "threshold",
                ChannelCumulativeSettlementPolicy.threshold_amount > EPS,
            )
        ).scalars().all()
        ready_pools = []
        for policy in policies:
            state = pool_state(db, policy.partner_name)
            if state.get("ready") and state.get("bill_count"):
                ready_pools.append(state)
        if ready_pools:
            items.append(
                {
                    "key": "channel_cumulative_ready",
                    "label": "累计结算已达门槛",
                    "count": len(ready_pools),
                    "amount": round(sum(_num(item.get("settlement_total")) for item in ready_pools), 2),
                    "severity": "info",
                    "description": "合作方累计口径已达到结算条件，可生成累计结算批次。",
                    "detail": "月度账单已经完成核对；生成批次后再统一开票、收款和银行核销。",
                    "target": "recon-channel",
                    "action_label": "生成结算批次",
                }
            )

    payload["items"] = items
    # Risk is a priority badge for another action and has never been counted in
    # the workbench action total. Recompute after removing deferred duplicates
    # and adding ready cumulative pools.
    action_items = [item for item in items if item.get("key") != "risk_alerts"]
    summary = payload.get("summary") or {}
    summary["total_count"] = sum(max(0, int(item.get("count") or 0)) for item in action_items)
    payload["summary"] = summary
    return payload
