"""APIs for partner-level cumulative channel settlement pools and batches."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.channel import ChannelRecord
from app.models.channel_cumulative_settlement import ChannelCumulativeSettlementPolicy
from app.models.finance_invoice_task import FinanceInvoiceTask
from app.models.user import AuthUser
from app.services.channel_cumulative_batch import (
    batch_by_id,
    batch_to_dict,
    bill_condition,
    cancel_batch,
    create_batch,
    list_batches,
)
from app.services.channel_cumulative_policy import (
    EPS,
    _num,
    deferred_bill_ids,
    is_threshold_policy,
    normalize_partner_key,
    policy_for_partner,
    policy_to_dict,
    pool_state,
)
from app.services.permissions import require_permission

router = APIRouter()


def _actor_name(user: AuthUser) -> str:
    return str(user.display_name or user.email or user.id)


@router.get("/policy")
def get_policy(
    partner_name: str = Query(..., min_length=1, max_length=500),
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("reconciliation.view")),
) -> dict:
    return policy_to_dict(policy_for_partner(db, partner_name), partner_name)


@router.put("/policy")
def upsert_policy(
    payload: dict,
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("reconciliation.manage")),
) -> dict:
    partner_name = str(payload.get("partner_name") or "").strip()[:500]
    if not partner_name:
        raise HTTPException(status_code=422, detail="请填写合作方")
    mode = str(payload.get("settlement_mode") or "periodic").strip()
    basis = str(payload.get("threshold_basis") or "billing_flow").strip()
    scope = str(payload.get("scope") or "partner").strip()
    threshold = round(_num(payload.get("threshold_amount")), 2)
    enabled = bool(payload.get("enabled", True))
    if mode not in {"periodic", "threshold"}:
        raise HTTPException(status_code=422, detail="不支持的结算方式")
    if basis not in {"billing_flow", "settlement_amount"}:
        raise HTTPException(status_code=422, detail="不支持的累计口径")
    if scope != "partner":
        raise HTTPException(status_code=422, detail="当前仅支持同合作方全部游戏累计")
    if mode == "threshold" and threshold <= EPS:
        raise HTTPException(status_code=422, detail="累计达标结算的门槛必须大于 0")

    key = normalize_partner_key(partner_name)
    row = db.execute(
        select(ChannelCumulativeSettlementPolicy).where(ChannelCumulativeSettlementPolicy.partner_key == key)
    ).scalar_one_or_none()
    if row is None:
        row = ChannelCumulativeSettlementPolicy(id=str(uuid4()), partner_key=key, partner_name=partner_name)
        db.add(row)
    row.partner_name = partner_name
    row.settlement_mode = mode
    row.threshold_basis = basis
    row.threshold_amount = threshold if mode == "threshold" else 0
    row.scope = scope
    row.enabled = enabled
    row.note = str(payload.get("note") or "").strip()[:4000]
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return policy_to_dict(row, partner_name)


@router.get("/pool")
def get_pool(
    partner_name: str = Query(..., min_length=1, max_length=500),
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("reconciliation.view")),
) -> dict:
    result = pool_state(db, partner_name)
    db.commit()
    return result


@router.get("/snapshot")
def get_snapshot(
    partner_name: str = Query(..., min_length=1, max_length=500),
    batch_limit: int = Query(8, ge=1, le=100),
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("reconciliation.view")),
) -> dict:
    """Return policy, pool and recent batches in one read request.

    The underlying policy/pool/batch services remain the single source of truth;
    this endpoint only coalesces HTTP round trips.
    """
    policy = policy_to_dict(policy_for_partner(db, partner_name), partner_name)
    pool = pool_state(db, partner_name)
    batches = list_batches(db, partner_name, batch_limit)
    db.commit()
    return {
        "policy": policy,
        "pool": pool,
        "batches": {"items": batches, "total": len(batches)},
    }


@router.get("/bill/{bill_id}")
def get_bill_condition(
    bill_id: str,
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("reconciliation.view")),
) -> dict:
    bill = db.get(ChannelRecord, bill_id)
    if bill is None:
        raise HTTPException(status_code=404, detail="渠道账单不存在")
    result = bill_condition(db, bill)
    db.commit()
    return result


@router.get("/bill-statuses")
def get_bill_statuses(
    bill_ids: str = Query("", max_length=30000),
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("reconciliation.view")),
) -> dict:
    ids = list(dict.fromkeys(part.strip() for part in bill_ids.split(",") if part.strip()))[:500]
    if not ids:
        return {"items": [], "total": 0}
    rows = db.execute(select(ChannelRecord).where(ChannelRecord.id.in_(ids))).scalars().all()
    deferred = deferred_bill_ids(db, rows)
    pool_cache: dict[str, dict] = {}
    items = []
    for row in rows:
        partner = str(row.partner_name or row.channel_name or "")
        key = normalize_partner_key(partner)
        policy = policy_for_partner(db, partner)
        if key not in pool_cache and is_threshold_policy(policy):
            pool_cache[key] = pool_state(db, partner)
        state = bill_condition(db, row) if str(row.id) in deferred else {
            "mode": "threshold" if is_threshold_policy(policy) else "periodic",
            "state": "normal",
            "deferred": False,
            "policy": policy_to_dict(policy, partner),
            "pool": pool_cache.get(key),
            "batch": None,
        }
        items.append({"bill_id": str(row.id), **state})
    db.commit()
    return {"items": items, "total": len(items)}


@router.post("/batches", status_code=201)
def create_cumulative_batch(
    payload: dict,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("reconciliation.manage")),
) -> dict:
    partner_name = str(payload.get("partner_name") or "").strip()
    if not partner_name:
        raise HTTPException(status_code=422, detail="请填写合作方")
    try:
        result = create_batch(db, partner_name, user)
        db.commit()
        return result
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail={"error": "batch_conflict", "message": "累计池刚刚发生变化，请刷新后重试。"}) from None


@router.get("/batches")
def get_batches(
    partner_name: str = Query(..., min_length=1, max_length=500),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("reconciliation.view")),
) -> dict:
    items = list_batches(db, partner_name, limit)
    db.commit()
    return {"items": items, "total": len(items)}


@router.get("/batches/{batch_id}")
def get_batch(
    batch_id: str,
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("reconciliation.view")),
) -> dict:
    result = batch_to_dict(db, batch_by_id(db, batch_id))
    db.commit()
    return result


@router.post("/batches/{batch_id}/cancel")
def cancel_cumulative_batch(
    batch_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("reconciliation.manage")),
) -> dict:
    reason = str(payload.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="取消累计结算批次必须填写原因")
    result = cancel_batch(db, batch_id, reason)
    db.commit()
    return result


@router.post("/batches/{batch_id}/submit-invoice")
def submit_batch_invoice_request(
    batch_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("invoice_requests.submit")),
) -> dict:
    batch = batch_by_id(db, batch_id)
    if str(batch.status or "") == "cancelled":
        raise HTTPException(status_code=409, detail="已取消批次不能提交开票")
    if str(batch.status or "") in {"invoiced", "settled"}:
        raise HTTPException(status_code=409, detail="该累计批次已完成开票，无需重复提交")

    existing = db.execute(
        select(FinanceInvoiceTask).where(
            FinanceInvoiceTask.source_kind == "cumulative_batch",
            FinanceInvoiceTask.cumulative_batch_id == str(batch.id),
            FinanceInvoiceTask.direction == "output",
            FinanceInvoiceTask.status.in_(("pending", "processing")),
        ).order_by(FinanceInvoiceTask.submitted_at.desc())
    ).scalars().first()
    if existing is not None:
        return {"task_id": str(existing.id), "task_no": str(existing.task_no), "status": str(existing.status), "batch": batch_to_dict(db, batch)}

    detail = batch_to_dict(db, batch)
    items = detail.get("items") or []
    if not items:
        raise HTTPException(status_code=409, detail="累计批次没有可开票账单")
    first_bill_id = str(items[0]["bill_id"])
    now = datetime.now(timezone.utc)
    task = FinanceInvoiceTask(
        id=str(uuid4()),
        task_no=f"FP-CUM-{now.strftime('%Y%m%d')}-{uuid4().hex[:6].upper()}",
        bill_type="channel",
        bill_id=first_bill_id,
        direction="output",
        status="pending",
        requested_amount=round(_num(batch.settlement_total), 2),
        allocated_amount=0,
        bill_number=str(batch.batch_no),
        partner_name=str(batch.partner_name),
        game_name="、".join(dict.fromkeys(str(item.get("game_name") or "") for item in items if item.get("game_name")))[:2000],
        settlement_month=(f"{batch.period_start}~{batch.period_end}" if batch.period_start and batch.period_end and batch.period_start != batch.period_end else str(batch.period_start or batch.period_end or "")),
        submitted_by_id=str(user.id),
        submitted_by_email=str(user.email or ""),
        submitted_by_name=_actor_name(user),
        submitted_at=now,
        source_kind="cumulative_batch",
        cumulative_batch_id=str(batch.id),
        remark=f"累计结算批次 {batch.batch_no} · {len(items)} 张渠道账单",
    )
    db.add(task)
    db.flush()
    batch.invoice_task_id = str(task.id)
    batch.status = "invoicing"
    batch.updated_at = now
    db.commit()
    return {"task_id": str(task.id), "task_no": str(task.task_no), "status": str(task.status), "batch": batch_to_dict(db, batch)}
