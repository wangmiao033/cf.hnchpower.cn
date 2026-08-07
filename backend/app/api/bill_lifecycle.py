"""账单状态流转与锁单状态 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
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


@router.get("/{bill_type}/{bill_id}", response_model=BillLifecycleRead)
def get_bill_lifecycle(
    bill_type: str,
    bill_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> BillLifecycleRead:
    bill = load_bill(db, bill_type, bill_id)
    return BillLifecycleRead.model_validate(
        build_lifecycle_snapshot(db, bill_type, bill, user)
    )


@router.post("/{bill_type}/{bill_id}/transition", response_model=BillLifecycleRead)
def transition_bill_status(
    bill_type: str,
    bill_id: str,
    payload: BillTransitionRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> BillLifecycleRead:
    bill = load_bill(db, bill_type, bill_id)
    db.info["allow_lifecycle_transition"] = True
    try:
        snapshot = transition_bill(
            db,
            bill_type,
            bill,
            payload.to_status,
            payload.reason,
            user,
        )
    finally:
        db.info.pop("allow_lifecycle_transition", None)
    return BillLifecycleRead.model_validate(snapshot)
