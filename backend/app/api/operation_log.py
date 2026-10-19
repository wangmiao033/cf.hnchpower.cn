"""业务操作审计日志查询 API。"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.operation_log import OperationLog
from app.schemas.operation_log import BillActorSummary, OperationLogListResponse, OperationLogRead

router = APIRouter()


def _bill_or_related_condition(entity_type: str, entity_id: str):
    """Return direct bill logs plus audit rows that point back to the same bill."""
    direct = and_(
        OperationLog.entity_type == entity_type,
        OperationLog.entity_id == entity_id,
    )
    bank_related = and_(
        OperationLog.entity_type == "bank_reconciliation",
        OperationLog.metadata_json["bill_type"].astext == entity_type,
        OperationLog.metadata_json["bill_id"].astext == entity_id,
    )
    return or_(direct, bank_related)


@router.get("", response_model=OperationLogListResponse)
def list_operation_logs(
    db: Session = Depends(get_db),
    entity_type: str | None = Query(None),
    entity_id: str | None = Query(None),
    action: str | None = Query(None),
    include_related: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> OperationLogListResponse:
    stmt = select(OperationLog)
    count_stmt = select(func.count(OperationLog.id))

    type_value = entity_type.strip() if entity_type and entity_type.strip() else ""
    id_value = entity_id.strip() if entity_id and entity_id.strip() else ""

    if include_related and type_value in {"rd", "channel"} and id_value:
        condition = _bill_or_related_condition(type_value, id_value)
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)
    else:
        if type_value:
            stmt = stmt.where(OperationLog.entity_type == type_value)
            count_stmt = count_stmt.where(OperationLog.entity_type == type_value)
        if id_value:
            stmt = stmt.where(OperationLog.entity_id == id_value)
            count_stmt = count_stmt.where(OperationLog.entity_id == id_value)

    if action and action.strip():
        value = action.strip()
        stmt = stmt.where(OperationLog.action == value)
        count_stmt = count_stmt.where(OperationLog.action == value)

    total = int(db.execute(count_stmt).scalar_one())
    rows = (
        db.execute(stmt.order_by(OperationLog.created_at.desc(), OperationLog.id.desc()).limit(limit).offset(offset))
        .scalars()
        .all()
    )
    return OperationLogListResponse(
        items=[OperationLogRead.model_validate(row) for row in rows],
        total=total,
    )


@router.get("/bill-actors/{entity_type}/{entity_id}", response_model=BillActorSummary)
def get_bill_actor_summary(
    entity_type: Literal["rd", "channel"],
    entity_id: str,
    db: Session = Depends(get_db),
) -> BillActorSummary:
    """Use original audit evidence, never the current session or a truncated page."""
    base = select(OperationLog).where(
        OperationLog.entity_type == entity_type,
        OperationLog.entity_id == entity_id,
    )

    def one(condition, *, earliest=False):
        order = (OperationLog.created_at.asc(), OperationLog.id.asc()) if earliest else (OperationLog.created_at.desc(), OperationLog.id.desc())
        row = db.execute(base.where(condition).order_by(*order).limit(1)).scalars().first()
        return OperationLogRead.model_validate(row) if row is not None else None

    return BillActorSummary(
        entered=one(OperationLog.action == "create", earliest=True),
        verified=one(and_(
            OperationLog.action.in_(("status_change", "update")),
            OperationLog.changes["status"]["after"].astext == "confirmed",
        )),
        modified=one(OperationLog.action.in_(("update", "line_add", "line_update", "line_delete"))),
    )
