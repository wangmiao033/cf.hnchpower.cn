"""账单状态流转、锁单状态与轻量归档 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_current_user
from app.models.user import AuthUser
from app.schemas.bill_lifecycle import BillLifecycleRead, BillTransitionRequest
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
