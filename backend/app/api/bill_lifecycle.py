"""账单状态流转、锁单状态与轻量归档 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from uuid import uuid4
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_current_user
from app.models.user import AuthUser
from app.schemas.bill_lifecycle import BillLifecycleRead, BillTransitionRequest
from app.models.channel import ChannelRecord, ChannelRecordLineItem
from app.models.operation_log import OperationLog
from app.services.channel_small_variance_approval import assess_channel_small_variance_approval
from app.services import bill_lock_guard as _bill_lock_guard  # noqa: F401  注册 SQLAlchemy 锁单守卫
from app.services.bill_archive import archive_bill, archive_snapshot, unarchive_bill
from app.services.bill_lifecycle import build_lifecycle_snapshot, load_bill, transition_bill

router = APIRouter()


def _prefer_channel_line_item_settlement(bill_type: str, bill) -> None:
    if bill_type != "channel":
        return
    items = list(getattr(bill, "line_items", None) or [])
    if not items:
        return
    total = round(sum(float(getattr(item, "settlement_amount", 0) or 0) for item in items), 2)
    if abs(total) <= 0.01:
        return
    current = round(float(getattr(bill, "settlement_amount", 0) or 0), 2)
    if abs(current - total) > 0.01:
        bill.settlement_amount = total


def _apply_cross_link_guards(snapshot: dict) -> dict:
    paid_amount = float(snapshot.get("paid_amount") or 0)
    allocated_amount = float(snapshot.get("invoice_allocated_amount") or 0)
    reason = None
    if paid_amount > 0.01:
        reason = "账单已有收付款记录，请先解除或冲销资金关联后再取消。"
    elif allocated_amount > 0.01:
        reason = "账单已有发票关联，请先撤销发票分配后再取消。"
    if reason:
        for option in snapshot.get("transitions") or []:
            if option.get("status") == "cancelled":
                option["available"] = False
                option["blocked_reason"] = reason
    return snapshot


def _channel_validation_reason(bill_type: str, bill) -> str | None:
    if bill_type != "channel" or str(getattr(bill, "validation_status", "unvalidated")) != "fail":
        return None
    difference = float(getattr(bill, "settlement_difference", 0) or 0)
    return f"系统计算与平台账单存在差异 {difference:+.2f} 元，请先修正结算规则或平台金额。"


def _snapshot(db: Session, bill_type: str, bill, user: AuthUser) -> dict:
    _prefer_channel_line_item_settlement(bill_type, bill)
    snapshot = _apply_cross_link_guards(build_lifecycle_snapshot(db, bill_type, bill, user))
    reason = _channel_validation_reason(bill_type, bill)
    if reason:
        for option in snapshot.get("transitions") or []:
            if option.get("status") == "confirmed":
                option["available"] = False
                option["blocked_reason"] = reason
    return snapshot


class ApprovedSmallVarianceRequest(BaseModel):
    """Only a documented admin approval; not a way to edit contract/amount data."""
    reason: str = Field(min_length=2, max_length=500)


@router.post("/channel/{bill_id}/confirm-small-variance", response_model=BillLifecycleRead)
def confirm_approved_channel_small_variance(
    bill_id: str,
    payload: ApprovedSmallVarianceRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> BillLifecycleRead:
    """Confirm a saved channel bill with <=¥0.50 explicitly approved contract variance.

    This is deliberately more restrictive than a normal lifecycle transition:
    only an administrator may use it, accepted finance exceptions must be linked
    to the actual current saved line economics, and a reason is audited alongside
    the resulting status transition in one database commit.
    """
    if str(user.role or "").strip().lower() != "admin":
        raise HTTPException(
            status_code=403,
            detail={"error": "admin_only", "message": "小额差异强制确认需要管理员权限"},
        )
    reason = str(payload.reason or "").strip()
    if len(reason) < 2:
        raise HTTPException(
            status_code=422,
            detail={"error": "reason_required", "message": "请填写本次强制确认核对的原因"},
        )

    bill = db.execute(
        select(ChannelRecord).where(ChannelRecord.id == bill_id).with_for_update()
    ).scalar_one_or_none()
    if bill is None:
        raise HTTPException(404, detail={"error": "bill_not_found", "message": "账单不存在，请刷新"})
    if str(bill.status or "pending").strip().lower() != "pending":
        raise HTTPException(
            409,
            detail={"error": "bill_status_changed", "message": "账单状态已发生变化，请刷新后重试"},
        )
    # Existing channel system-versus-platform validation still blocks:
    # this action is exclusively for previously accepted CONTRACT differences.
    platform_failure = _channel_validation_reason("channel", bill)
    if platform_failure:
        raise HTTPException(409, detail={"error": "platform_validation_failed", "message": platform_failure})

    rows = db.execute(
        select(ChannelRecordLineItem)
        .where(ChannelRecordLineItem.channel_record_id == bill_id)
        .order_by(ChannelRecordLineItem.sort_order, ChannelRecordLineItem.id)
    ).scalars().all()
    table_name = db.execute(
        text("SELECT to_regclass('public.cf_contract_difference_cases')")
    ).scalar_one_or_none()
    if not table_name:
        raise HTTPException(
            409,
            detail={"error": "contract_evidence_unavailable", "message": "合同差异处置表不存在，不能强制确认"},
        )
    cases = [dict(row) for row in db.execute(text("""
        SELECT id, bill_type, bill_id, line_id, game_name, settlement_cycle,
               expected_amount, actual_amount, status, handling_type, reason_type,
               description, source_snapshot_json
        FROM cf_contract_difference_cases
        WHERE bill_type = 'channel' AND bill_id = :bill_id
        ORDER BY updated_at DESC, id DESC
        LIMIT 300
    """), {"bill_id": bill_id}).mappings().all()]
    assessment = assess_channel_small_variance_approval(bill_id, rows, cases)

    db.add(OperationLog(
        id=str(uuid4()),
        entity_type="channel",
        entity_id=str(bill.id),
        entity_number=bill.statement_no,
        action="small_variance_confirm",
        summary=f"管理员按已核准小额合同差异强制确认渠道账单，差异 ¥{assessment['difference_cents'] / 100:.2f}",
        actor_user_id=str(user.id),
        actor_email=str(user.email or ""),
        changes={},
        metadata_json={
            "reason": reason,
            "approval_source": "existing_contract_difference_acceptance",
            "recorded_settlement_amount": float(bill.settlement_amount or 0),
            "variance_total_cents": assessment["difference_cents"],
            "max_variance_cents": 50,
            "approved_lines": assessment["approved_lines"],
        },
    ))
    db.info["allow_lifecycle_transition"] = True
    try:
        # Commit + lifecycle/status audit happen together; no calculation, fee,
        # discount, contract, invoice or receipt is rewritten by this operation.
        transition_bill(db, "channel", bill, "confirmed", reason, user)
    finally:
        db.info.pop("allow_lifecycle_transition", None)
    return BillLifecycleRead.model_validate(_snapshot(db, "channel", bill, user))


@router.get("/archive")
def get_bill_archive_snapshot(
    bill_type: str = Query(..., pattern="^(rd|channel)$"),
    auto: bool = Query(default=True),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> dict:
    del user
    return archive_snapshot(db, bill_type, run_auto=auto)


@router.post("/archive/{bill_type}/{bill_id}")
def archive_one_bill(
    bill_type: str,
    bill_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> dict:
    return archive_bill(db, bill_type, bill_id, user=user, source="manual")


@router.delete("/archive/{bill_type}/{bill_id}")
def unarchive_one_bill(
    bill_type: str,
    bill_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> dict:
    return unarchive_bill(db, bill_type, bill_id, user=user)


@router.get("/{bill_type}/{bill_id}", response_model=BillLifecycleRead)
def get_bill_lifecycle(
    bill_type: str,
    bill_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> BillLifecycleRead:
    bill = load_bill(db, bill_type, bill_id)
    return BillLifecycleRead.model_validate(_snapshot(db, bill_type, bill, user))


@router.post("/{bill_type}/{bill_id}/transition", response_model=BillLifecycleRead)
def transition_bill_status(
    bill_type: str,
    bill_id: str,
    payload: BillTransitionRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> BillLifecycleRead:
    bill = load_bill(db, bill_type, bill_id)
    before = _snapshot(db, bill_type, bill, user)
    target = str(payload.to_status or "").strip().lower()

    if target == "confirmed":
        reason = _channel_validation_reason(bill_type, bill)
        if reason:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "settlement_validation_failed", "message": reason},
            )

    if target == "cancelled":
        cancel_option = next((option for option in before.get("transitions") or [] if option.get("status") == "cancelled"), None)
        if cancel_option is not None and not cancel_option.get("available", False):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "transition_blocked",
                    "message": cancel_option.get("blocked_reason") or "当前账单不能取消。",
                    "current_status": before.get("status"),
                    "target_status": "cancelled",
                },
            )

    db.info["allow_lifecycle_transition"] = True
    try:
        transition_bill(db, bill_type, bill, payload.to_status, payload.reason, user)
    finally:
        db.info.pop("allow_lifecycle_transition", None)
    return BillLifecycleRead.model_validate(_snapshot(db, bill_type, bill, user))
