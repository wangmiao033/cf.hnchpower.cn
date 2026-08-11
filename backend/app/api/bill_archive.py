"""账单归档 API。归档只影响列表可见性，不改账单状态。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_current_user
from app.models.user import AuthUser
from app.services.bill_archive import archive_bill, archive_snapshot, unarchive_bill

router = APIRouter()


class ArchiveMutationRead(BaseModel):
    bill_type: str
    bill_id: str
    archived: bool
    already_archived: bool | None = None
    already_unarchived: bool | None = None


@router.get("")
def get_archive_snapshot(
    bill_type: str = Query(..., pattern="^(rd|channel)$"),
    auto: bool = Query(default=True),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> dict:
    del user
    return archive_snapshot(db, bill_type, run_auto=auto)


@router.post("/{bill_type}/{bill_id}", response_model=ArchiveMutationRead)
def archive_one_bill(
    bill_type: str,
    bill_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> ArchiveMutationRead:
    result = archive_bill(db, bill_type, bill_id, user=user, source="manual")
    return ArchiveMutationRead.model_validate(result)


@router.delete("/{bill_type}/{bill_id}", response_model=ArchiveMutationRead)
def unarchive_one_bill(
    bill_type: str,
    bill_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> ArchiveMutationRead:
    result = unarchive_bill(db, bill_type, bill_id, user=user)
    return ArchiveMutationRead.model_validate(result)
