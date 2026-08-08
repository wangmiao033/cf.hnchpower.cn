"""Workbench APIs: today todos and customer 360."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_current_user
from app.models.user import AuthUser
from app.schemas.customer360 import Customer360Response
from app.schemas.workbench import WorkbenchTodoResponse
from app.services.customer360 import build_customer360
from app.services.permissions import resolve_permissions
from app.services.workbench_todos import build_workbench_todos

router = APIRouter()


@router.get("/todos", response_model=WorkbenchTodoResponse)
def get_workbench_todos(
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> WorkbenchTodoResponse:
    permissions = resolve_permissions(db, user)
    payload = build_workbench_todos(db, permissions)
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
