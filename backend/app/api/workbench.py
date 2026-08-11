"""Workbench APIs: today todos and customer 360."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_current_user
from app.models.channel import ChannelRecord
from app.models.reconciliation import ReconciliationRecord
from app.models.user import AuthUser
from app.schemas.customer360 import Customer360Response
from app.schemas.workbench import WorkbenchTodoResponse
from app.services.customer360 import build_customer360
from app.services.permissions import resolve_permissions
from app.services.workbench_todos_cumulative import build_workbench_todos

router = APIRouter()

_PENDING_STATUSES = ("draft", "pending", "")


def _count_total_pending(db: Session, model) -> tuple[int, float, int, str | None]:
    total_count, amount_total, latest_month = db.execute(
        select(
            func.count(model.id),
            func.coalesce(func.sum(model.settlement_amount), 0),
            func.max(model.settlement_month),
        )
    ).one()
    pending_count = db.execute(
        select(func.count(model.id)).where(
            func.lower(func.coalesce(model.status, "pending")).in_(_PENDING_STATUSES)
        )
    ).scalar_one()
    return (
        int(total_count or 0),
        float(amount_total or 0),
        int(pending_count or 0),
        str(latest_month) if latest_month else None,
    )


def _build_bill_snapshot(db: Session, permissions: set[str]) -> dict:
    if "reconciliation.view" not in permissions:
        return {
            "rd_bill_count": 0,
            "channel_bill_count": 0,
            "rd_pending_count": 0,
            "channel_pending_count": 0,
            "rd_total_amount": 0,
            "channel_total_amount": 0,
            "latest_settlement_month": None,
        }

    rd_count, rd_total, rd_pending, rd_latest = _count_total_pending(db, ReconciliationRecord)
    channel_count, channel_total, channel_pending, channel_latest = _count_total_pending(db, ChannelRecord)
    latest_month = max((value for value in (rd_latest, channel_latest) if value), default=None)
    return {
        "rd_bill_count": rd_count,
        "channel_bill_count": channel_count,
        "rd_pending_count": rd_pending,
        "channel_pending_count": channel_pending,
        "rd_total_amount": round(rd_total, 2),
        "channel_total_amount": round(channel_total, 2),
        "latest_settlement_month": latest_month,
    }


@router.get("/todos", response_model=WorkbenchTodoResponse)
def get_workbench_todos(
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> WorkbenchTodoResponse:
    permissions = resolve_permissions(db, user)
    payload = build_workbench_todos(db, permissions)
    payload["snapshot"] = _build_bill_snapshot(db, permissions)
    return WorkbenchTodoResponse.model_validate(payload)


@router.get("/customer-360/{partner_id}", response_model=Customer360Response)
def get_customer360(
    partner_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> Customer360Response:
    permissions = resolve_permissions(db, user)
    if not ({"partners.view", "partners.manage"} & permissions):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="当前账号没有查看客户资料的权限",
        )
    payload = build_customer360(db, permissions, partner_id)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="客户不存在")
    return Customer360Response.model_validate(payload)
