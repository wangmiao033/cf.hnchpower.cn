"""Cumulative settlement batch lifecycle for channel receivables."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.channel import ChannelRecord
from app.models.channel_cumulative_settlement import (
    ChannelCumulativeSettlementBatch,
    ChannelCumulativeSettlementBatchItem,
    ChannelCumulativeSettlementPolicy,
)
from app.models.user import AuthUser
from app.services.channel_cumulative_policy import (
    EPS,
    _num,
    is_threshold_policy,
    normalize_partner_key,
    policy_for_partner,
    policy_to_dict,
    pool_state,
)


def _batch_query(batch_id: str):
    return (
        select(ChannelCumulativeSettlementBatch)
        .options(selectinload(ChannelCumulativeSettlementBatch.items))
        .where(ChannelCumulativeSettlementBatch.id == str(batch_id))
    )


def batch_by_id(db: Session, batch_id: str) -> ChannelCumulativeSettlementBatch:
    row = db.execute(_batch_query(batch_id)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "batch_not_found", "id": batch_id})
    return row


def batch_to_dict(db: Session, batch: ChannelCumulativeSettlementBatch) -> dict:
    items = [item for item in (batch.items or []) if item.released_at is None]
    bill_ids = [str(item.bill_id) for item in items]
    bills = {
        str(row.id): row
        for row in db.execute(select(ChannelRecord).where(ChannelRecord.id.in_(bill_ids))).scalars().all()
    } if bill_ids else {}
    received_total = round(sum(max(0.0, _num(bills.get(str(item.bill_id)).received_amount if bills.get(str(item.bill_id)) else 0)) for item in items), 2)
    settlement_total = round(_num(batch.settlement_total), 2)
    current_status = str(batch.status or "ready")
    if current_status in {"invoicing", "invoiced"} and items and received_total + EPS >= settlement_total:
        current_status = "settled"
        if batch.status != "settled":
            batch.status = "settled"
            batch.settled_at = datetime.now(timezone.utc)
            batch.updated_at = datetime.now(timezone.utc)
            db.flush()
    return {
        "id": str(batch.id),
        "batch_no": str(batch.batch_no),
        "partner_key": str(batch.partner_key),
        "partner_name": str(batch.partner_name),
        "threshold_basis": str(batch.threshold_basis),
        "threshold_amount": round(_num(batch.threshold_amount), 2),
        "basis_total": round(_num(batch.basis_total), 2),
        "settlement_total": settlement_total,
        "period_start": batch.period_start,
        "period_end": batch.period_end,
        "status": current_status,
        "invoice_task_id": batch.invoice_task_id,
        "invoice_id": batch.invoice_id,
        "received_total": received_total,
        "remaining_receivable": round(max(0.0, settlement_total - received_total), 2),
        "created_by_id": batch.created_by_id,
        "created_by_name": batch.created_by_name,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
        "invoiced_at": batch.invoiced_at.isoformat() if batch.invoiced_at else None,
        "settled_at": batch.settled_at.isoformat() if batch.settled_at else None,
        "cancelled_at": batch.cancelled_at.isoformat() if batch.cancelled_at else None,
        "cancel_reason": batch.cancel_reason or "",
        "items": [
            {
                "id": str(item.id),
                "bill_id": str(item.bill_id),
                "settlement_month": item.settlement_month,
                "basis_amount": round(_num(item.basis_amount), 2),
                "settlement_amount": round(_num(item.settlement_amount), 2),
                "received_amount": round(max(0.0, _num(bills.get(str(item.bill_id)).received_amount if bills.get(str(item.bill_id)) else 0)), 2),
                "bill_number": str(bills.get(str(item.bill_id)).statement_no or item.bill_id) if bills.get(str(item.bill_id)) else str(item.bill_id),
                "game_name": str(bills.get(str(item.bill_id)).game_name or "") if bills.get(str(item.bill_id)) else "",
            }
            for item in items
        ],
    }


def active_batch_for_bill(db: Session, bill_id: str) -> ChannelCumulativeSettlementBatch | None:
    item = db.execute(
        select(ChannelCumulativeSettlementBatchItem)
        .where(
            ChannelCumulativeSettlementBatchItem.bill_id == str(bill_id),
            ChannelCumulativeSettlementBatchItem.released_at.is_(None),
        )
        .order_by(ChannelCumulativeSettlementBatchItem.created_at.desc())
    ).scalars().first()
    if item is None:
        return None
    batch = db.execute(_batch_query(str(item.batch_id))).scalar_one_or_none()
    return batch if batch and str(batch.status or "") != "cancelled" else None


def bill_condition(db: Session, bill: ChannelRecord) -> dict:
    partner_name = str(bill.partner_name or bill.channel_name or "")
    policy = policy_for_partner(db, partner_name)
    if not is_threshold_policy(policy):
        return {
            "mode": "periodic",
            "state": "normal",
            "deferred": False,
            "policy": policy_to_dict(policy, partner_name),
            "pool": None,
            "batch": None,
        }
    batch = active_batch_for_bill(db, str(bill.id))
    if batch is not None:
        return {
            "mode": "threshold",
            "state": "batched",
            "deferred": False,
            "policy": policy_to_dict(policy, partner_name),
            "pool": None,
            "batch": batch_to_dict(db, batch),
        }
    if str(bill.status or "pending").strip().lower() != "confirmed":
        return {
            "mode": "threshold",
            "state": "not_applicable",
            "deferred": False,
            "policy": policy_to_dict(policy, partner_name),
            "pool": None,
            "batch": None,
        }
    pool = pool_state(db, partner_name)
    belongs = any(str(item.get("bill_id")) == str(bill.id) for item in pool.get("bills") or [])
    if not belongs:
        return {
            "mode": "threshold",
            "state": "financial_activity_started",
            "deferred": False,
            "policy": policy_to_dict(policy, partner_name),
            "pool": pool,
            "batch": None,
        }
    return {
        "mode": "threshold",
        "state": "ready" if pool.get("ready") else "accumulating",
        "deferred": True,
        "policy": policy_to_dict(policy, partner_name),
        "pool": pool,
        "batch": None,
    }


def create_batch(db: Session, partner_name: str, user: AuthUser) -> dict:
    policy = policy_for_partner(db, partner_name)
    if not is_threshold_policy(policy):
        raise HTTPException(status_code=409, detail={"error": "not_threshold_partner", "message": "当前合作方未启用累计达标结算。"})
    policy = db.execute(
        select(ChannelCumulativeSettlementPolicy)
        .where(ChannelCumulativeSettlementPolicy.id == policy.id)
        .with_for_update()
    ).scalar_one()
    state = pool_state(db, policy.partner_name)
    if not state.get("ready"):
        raise HTTPException(
            status_code=409,
            detail={
                "error": "threshold_not_reached",
                "message": f"累计金额尚未达到结算门槛，还差 {state.get('remaining_to_threshold', 0):.2f} 元。",
            },
        )
    bills = state.get("bills") or []
    if not bills:
        raise HTTPException(status_code=409, detail={"error": "empty_pool", "message": "当前没有可生成批次的已核对账单。"})
    settlement_total = round(sum(_num(item.get("settlement_amount")) for item in bills), 2)
    if settlement_total <= EPS:
        raise HTTPException(status_code=409, detail={"error": "zero_batch", "message": "累计池结算金额为 0，无需生成收款批次。"})
    now = datetime.now(timezone.utc)
    batch = ChannelCumulativeSettlementBatch(
        id=str(uuid4()),
        batch_no=f"CUM-{now.strftime('%Y%m%d')}-{uuid4().hex[:6].upper()}",
        partner_key=str(policy.partner_key),
        partner_name=str(policy.partner_name),
        threshold_basis=str(policy.threshold_basis),
        threshold_amount=round(_num(policy.threshold_amount), 2),
        basis_total=round(_num(state.get("basis_total")), 2),
        settlement_total=settlement_total,
        period_start=state.get("period_start"),
        period_end=state.get("period_end"),
        status="ready",
        created_by_id=str(user.id),
        created_by_name=str(user.display_name or user.email or user.id),
    )
    db.add(batch)
    db.flush()
    for item in bills:
        db.add(
            ChannelCumulativeSettlementBatchItem(
                id=str(uuid4()),
                batch_id=str(batch.id),
                bill_id=str(item["bill_id"]),
                settlement_month=item.get("settlement_month") or None,
                basis_amount=round(_num(item.get("basis_amount")), 2),
                settlement_amount=round(_num(item.get("settlement_amount")), 2),
            )
        )
    db.flush()
    return batch_to_dict(db, db.execute(_batch_query(str(batch.id))).scalar_one())


def list_batches(db: Session, partner_name: str, limit: int = 20) -> list[dict]:
    key = normalize_partner_key(partner_name)
    if not key:
        return []
    rows = db.execute(
        select(ChannelCumulativeSettlementBatch)
        .options(selectinload(ChannelCumulativeSettlementBatch.items))
        .where(ChannelCumulativeSettlementBatch.partner_key == key)
        .order_by(ChannelCumulativeSettlementBatch.created_at.desc())
        .limit(max(1, min(100, int(limit))))
    ).scalars().all()
    return [batch_to_dict(db, row) for row in rows]


def cancel_batch(db: Session, batch_id: str, reason: str) -> dict:
    batch = batch_by_id(db, batch_id)
    if str(batch.status or "") in {"invoiced", "settled"} or batch.invoice_id:
        raise HTTPException(status_code=409, detail={"error": "batch_financial_activity", "message": "批次已经开票或进入资金流程，不能直接取消。"})
    if batch.invoice_task_id:
        raise HTTPException(status_code=409, detail={"error": "batch_task_exists", "message": "批次已有财务开票任务，请先在财务工作台处理任务。"})
    now = datetime.now(timezone.utc)
    batch.status = "cancelled"
    batch.cancelled_at = now
    batch.cancel_reason = str(reason or "").strip()
    batch.updated_at = now
    for item in batch.items or []:
        if item.released_at is None:
            item.released_at = now
            item.release_reason = batch.cancel_reason or "取消累计结算批次"
    db.flush()
    return batch_to_dict(db, batch)


def refresh_batches_for_bill(db: Session, bill_id: str) -> None:
    batch = active_batch_for_bill(db, bill_id)
    if batch is not None:
        batch_to_dict(db, batch)
