"""业务操作审计日志查询 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.operation_log import OperationLog
from app.schemas.operation_log import OperationLogListResponse, OperationLogRead

router = APIRouter()


@router.get("", response_model=OperationLogListResponse)
def list_operation_logs(
    db: Session = Depends(get_db),
    entity_type: str | None = Query(None),
    entity_id: str | None = Query(None),
    action: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> OperationLogListResponse:
    stmt = select(OperationLog)
    count_stmt = select(func.count(OperationLog.id))

    if entity_type and entity_type.strip():
        value = entity_type.strip()
        stmt = stmt.where(OperationLog.entity_type == value)
        count_stmt = count_stmt.where(OperationLog.entity_type == value)
    if entity_id and entity_id.strip():
        value = entity_id.strip()
        stmt = stmt.where(OperationLog.entity_id == value)
        count_stmt = count_stmt.where(OperationLog.entity_id == value)
    if action and action.strip():
        value = action.strip()
        stmt = stmt.where(OperationLog.action == value)
        count_stmt = count_stmt.where(OperationLog.action == value)

    total = int(db.execute(count_stmt).scalar_one())
    rows = (
        db.execute(stmt.order_by(OperationLog.created_at.desc()).limit(limit).offset(offset))
        .scalars()
        .all()
    )
    return OperationLogListResponse(
        items=[OperationLogRead.model_validate(row) for row in rows],
        total=total,
    )
