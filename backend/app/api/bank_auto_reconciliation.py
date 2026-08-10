"""银行流水自动核销 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_current_user
from app.models.bank_reconciliation_match import BankReconciliationMatch
from app.models.bank_transaction import BankTransaction
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
from app.services.bank_auto_reconciliation_reverse import reverse_confirmed_match
from app.services.bank_multi_allocation import (
    active_matches_for_transaction,
    allocate_transaction,
    bill_summary,
    build_p2_dashboard,
    transaction_summaries,
    transaction_summary,
)
from app.services.permissions import require_permission

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


@router.get("/p2-dashboard", response_model=P2Dashboard)
def get_p2_dashboard(
    limit: int = Query(500, ge=1, le=500),
    db: Session = Depends(get_db),
    _user: AuthUser = Depends(require_current_user),
) -> P2Dashboard:
    return P2Dashboard.model_validate(build_p2_dashboard(db, limit=limit))


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
        allocate_transaction(
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
    """兼容旧版“确认核销”按钮，但统一走 P2 分配引擎。

    P2 上线后数据库会保护已核销流水的兼容投影字段；旧 confirm_match 在同一
    flush 中先生成 confirmed match、再更新 bank_transactions 投影时会被触发器拦截。
    这里复用 allocate_transaction，由 sync_transaction_projection 通过受控会话标志
    更新兼容投影，避免绕过数据库保护，同时保持旧接口响应结构不变。
    """
    tx = db.get(BankTransaction, transaction_id)
    if tx is None:
        raise HTTPException(status_code=404, detail="银行流水不存在")

    summary = transaction_summary(tx, active_matches_for_transaction(db, transaction_id))
    remaining = round(float(summary.get("remaining_amount") or 0), 2)
    if remaining <= 0:
        raise HTTPException(status_code=409, detail="该银行流水已经全额核销")

    result = allocate_transaction(
        db,
        transaction_id,
        [{"bill_type": payload.bill_type, "bill_id": payload.bill_id, "amount": remaining}],
        user,
    )
    matches = result.get("matches") or []
    if not matches:
        raise HTTPException(status_code=500, detail="核销已执行但未返回核销记录")
    return BankMatchConfirmResponse.model_validate(
        {"match": matches[0], "message": "银行流水核销成功"}
    )


@router.post("/matches/{match_id}/reverse", response_model=BankMatchConfirmResponse)
def reverse_bank_match(
    match_id: str,
    payload: BankMatchReverseRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> BankMatchConfirmResponse:
    return BankMatchConfirmResponse.model_validate(
        reverse_confirmed_match(db, match_id, payload.reason, user)
    )
