"""工作台今日待办 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_current_user
from app.models.user import AuthUser
from app.schemas.workbench import WorkbenchTodoResponse
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
