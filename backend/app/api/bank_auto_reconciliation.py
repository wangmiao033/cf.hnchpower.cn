"""银行流水自动核销 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_current_user
from app.models.bank_reconciliation_match import BankReconciliationMatch
from app.models.user import AuthUser
from app.schemas.bank_auto_reconciliation import (
    BankAutoReconciliationDashboard,
    BankMatchConfirmRequest,
    BankMatchConfirmResponse,
    BankMatchReverseRequest,
)
from app.services.bank_auto_reconciliation import build_dashboard, confirm_match
from app.services.bank_auto_reconciliation_reverse import reverse_confirmed_match

router = APIRouter()


@router.get("", response_model=BankAutoReconciliationDashboard)
def get_bank_auto_reconciliation_dashboard(
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    _user: AuthUser = Depends(require_current_user),
) -> BankAutoReconciliationDashboard:
    result = build_dashboard(db, limit=limit)
    confirmed_count, confirmed_amount = db.execute(
        select(
            func.count(BankReconciliationMatch.id),
            func.coalesce(func.sum(BankReconciliationMatch.linked_amount), 0),
        ).where(BankReconciliationMatch.status == "confirmed")
    ).one()
    result["stats"]["confirmed_matches"] = int(confirmed_count or 0)
    result["stats"]["confirmed_amount"] = round(float(confirmed_amount or 0), 2)
    return BankAutoReconciliationDashboard.model_validate(result)


@router.post("/{transaction_id}/confirm", response_model=BankMatchConfirmResponse)
def confirm_bank_match(
    transaction_id: str,
    payload: BankMatchConfirmRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> BankMatchConfirmResponse:
    return BankMatchConfirmResponse.model_validate(
        confirm_match(db, transaction_id, payload.bill_type, payload.bill_id, user)
    )


@router.post("/matches/{match_id}/reverse", response_model=BankMatchConfirmResponse)
def reverse_bank_match(
    match_id: str,
    payload: BankMatchReverseRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> BankMatchConfirmResponse:
    return BankMatchConfirmResponse.model_validate(
        reverse_confirmed_match(db, match_id, payload.reason, user)
    )
