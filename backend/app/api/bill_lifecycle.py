"""账单状态流转与锁单状态 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_current_user
from app.models.user import AuthUser
from app.schemas.bill_lifecycle import (
    BillLifecycleRead,
    BillTransitionRequest,
)
from app.services import bill_lock_guard as _bill_lock_guard  # noqa: F401  注册 SQLAlchemy 锁单守卫
from app.services.bill_lifecycle import (
    build_lifecycle_snapshot,
    load_bill,
    transition_bill,
)

router = APIRouter()


def _prefer_channel_line_item_settlement(bill_type: str, bill) -> None:
    """渠道账单以游戏明细结算额为权威口径，修正历史主表缓存为 0 的情况。"""
    if bill_type != "channel":
        return
    items = list(getattr(bill, "line_items", None) or [])
    if not items:
        return
    total = round(
        sum(float(getattr(item, "settlement_amount", 0) or 0) for item in items),
        2,
    )
    if abs(total) <= 0.01:
        return
    current = round(float(getattr(bill, "settlement_amount", 0) or 0), 2)
    if abs(current - total) > 0.01:
        bill.settlement_amount = total


def _apply_cross_link_guards(snapshot: dict) -> dict:
    """Prevent cancellation while money or invoice allocations still point at the bill."""
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


def _snapshot(db: Session, bill_type: str, bill, user: AuthUser) -> dict:
    _prefer_channel_line_item_settlement(bill_type, bill)
    return _apply_cross_link_guards(
        build_lifecycle_snapshot(db, bill_type, bill, user)
    )


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
    if str(payload.to_status or "").strip().lower() == "cancelled":
        cancel_option = next(
            (
                option
                for option in before.get("transitions") or []
                if option.get("status") == "cancelled"
            ),
            None,
        )
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
        transition_bill(
            db,
            bill_type,
            bill,
            payload.to_status,
            payload.reason,
            user,
        )
    finally:
        db.info.pop("allow_lifecycle_transition", None)
    return BillLifecycleRead.model_validate(_snapshot(db, bill_type, bill, user))
