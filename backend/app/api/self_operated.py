"""仅管理员的大熊游戏独立订单台账接口。

本模块不包含迁移执行操作，普通部署不可打开正式写入；
没有事先确认生产库可恢复备份时，POST 返回 503。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_admin
from app.models.user import AuthUser
from app.schemas.self_operated import (
    SelfOperatedConfirmRequest,
    SelfOperatedConfirmResult,
    SelfOperatedImportAudit,
    SelfOperatedMonthlySummary,
)
from app.services.self_operated_orders import (
    confirm_order_import,
    import_history,
    monthly_summary,
    readiness,
)

router = APIRouter(dependencies=[Depends(require_admin)])


@router.get("/status")
def self_operated_status(db: Session = Depends(get_db)) -> dict:
    schema_ready, write_ready, reason = readiness(db)
    return {
        "schema_ready": schema_ready,
        "write_ready": write_ready,
        "reason": reason,
        "source": "daxiong",
        "note": "订单数据库入账需生产备份核实后显式启用。",
    }


@router.get("/months/{month}", response_model=SelfOperatedMonthlySummary)
def list_self_operated_month(
    month: str,
    db: Session = Depends(get_db),
) -> SelfOperatedMonthlySummary:
    return monthly_summary(db, month)


@router.get("/imports", response_model=list[SelfOperatedImportAudit])
def list_self_operated_imports(
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[SelfOperatedImportAudit]:
    return import_history(db, limit=limit)


@router.post("/imports/confirm", response_model=SelfOperatedConfirmResult)
def confirm_self_operated_import(
    payload: SelfOperatedConfirmRequest,
    user: AuthUser = Depends(require_admin),
    db: Session = Depends(get_db),
) -> SelfOperatedConfirmResult:
    try:
        result = confirm_order_import(db, payload, user_id=str(user.id))
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise
