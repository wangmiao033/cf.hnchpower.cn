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
from app.schemas.bank_multi_allocation import (
    P2AllocateRequest,
    P2AllocateResponse,
    P2BillSummary,
    P2Dashboard,
    P2TransactionSummaryRequest,
    P2TransactionSummaryResponse,
)
from app.services.bank_auto_reconciliation import build_dashboard
from app.services.bank_cumulative_filter import filter_cumulative_bank_suggestions
from app.services.bank_multi_allocation import (
    bill_summary,
    build_p2_dashboard,
    transaction_summaries,
)
from app.services.bank_reconciliation_engine import allocate, confirm_single, reverse
from app.services.permissions import require_permission

router = APIRouter()


@router.get("", response_model=BankAutoReconciliationDashboard)
def get_bank_auto_reconciliation_dashboard(
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    _user: AuthUser = Depends(require_current_user),
) -> BankAutoReconciliationDashboard:
    result = filter_cumulative_bank_suggestions(db, build_dashboard(db, limit=limit))
    confirmed_count, confirmed_amount = db.execute(
        select(
            func.count(BankReconciliationMatch.id),
            func.coalesce(func.sum(BankReconciliationMatch.linked_amount), 0),
        ).where(BankReconciliationMatch.status == "confirmed")
    ).one()
    result["stats"]["confirmed_matches"] = int(confirmed_count or 0)
    result["stats"]["confirmed_amount"] = round(float(confirmed_amount or 0), 2)
    return BankAutoReconciliationDashboard.model_validate(result)


@router.get("/p2-dashboard", response_model=P2Dashboard)
def get_p2_dashboard(
    limit: int = Query(500, ge=1, le=500),
    db: Session = Depends(get_db),
    _user: AuthUser = Depends(require_current_user),
) -> P2Dashboard:
    result = filter_cumulative_bank_suggestions(db, build_p2_dashboard(db, limit=limit))
    return P2Dashboard.model_validate(result)


@router.post("/p2/transaction-summaries", response_model=P2TransactionSummaryResponse)
def get_p2_transaction_summaries(
    payload: P2TransactionSummaryRequest,
    db: Session = Depends(get_db),
    _user: AuthUser = Depends(require_current_user),
) -> P2TransactionSummaryResponse:
    return P2TransactionSummaryResponse(items=transaction_summaries(db, payload.transaction_ids))


@router.get("/p2/bills/{bill_type}/{bill_id}", response_model=P2BillSummary)
def get_p2_bill_summary(
    bill_type: str,
    bill_id: str,
    db: Session = Depends(get_db),
    _user: AuthUser = Depends(require_current_user),
) -> P2BillSummary:
    return P2BillSummary.model_validate(bill_summary(db, bill_type, bill_id))


@router.post("/{transaction_id}/p2-allocate", response_model=P2AllocateResponse)
def p2_allocate_bank_transaction(
    transaction_id: str,
    payload: P2AllocateRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> P2AllocateResponse:
    return P2AllocateResponse.model_validate(
        allocate(
            db,
            transaction_id,
            [item.model_dump() for item in payload.allocations],
            user,
        )
    )


@router.post("/{transaction_id}/confirm", response_model=BankMatchConfirmResponse)
def confirm_bank_match(
    transaction_id: str,
    payload: BankMatchConfirmRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> BankMatchConfirmResponse:
    """兼容旧按钮；资金写入只允许通过统一 P2 allocation 引擎。"""
    return BankMatchConfirmResponse.model_validate(
        confirm_single(db, transaction_id, payload.bill_type, payload.bill_id, user)
    )


@router.post("/matches/{match_id}/reverse", response_model=BankMatchConfirmResponse)
def reverse_bank_match(
    match_id: str,
    payload: BankMatchReverseRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> BankMatchConfirmResponse:
    return BankMatchConfirmResponse.model_validate(reverse(db, match_id, payload.reason, user))
