"""发票归档 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_current_user
from app.models.user import AuthUser
from app.services.invoice_archive import (
    archive_invoice,
    invoice_archive_snapshot,
    unarchive_invoice,
)

router = APIRouter()


@router.get("/snapshot")
def get_invoice_archive_snapshot(
    db: Session = Depends(get_db),
) -> dict:
    return invoice_archive_snapshot(db, run_auto=False)


@router.post("/sync")
def sync_invoice_archives(
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> dict:
    return invoice_archive_snapshot(db, run_auto=True, user=user)


@router.post("/{invoice_id}/archive")
def archive_invoice_record(
    invoice_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> dict:
    return archive_invoice(db, invoice_id, user=user)


@router.post("/{invoice_id}/unarchive")
def unarchive_invoice_record(
    invoice_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> dict:
    return unarchive_invoice(db, invoice_id, user=user)
