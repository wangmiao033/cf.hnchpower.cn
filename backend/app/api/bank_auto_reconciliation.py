"""银行流水自动核销 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
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
from app.services.bank_auto_reconciliation import _candidate_pool, build_dashboard
from app.services.bank_combination_match import enrich_auto_dashboard_with_p2
from app.services.bank_cumulative_filter import filter_cumulative_bank_suggestions
from app.services.bank_multi_allocation import (
    bill_summary,
    build_bill_match_suggestions,
    build_p2_dashboard,
    transaction_summaries,
)
from app.services.bank_partner_match import (
    customer_match_center,
    enrich_reconciliation_dashboard,
    remove_customer_link,
    save_customer_link,
)
from app.services.bank_reconciliation_engine import allocate, confirm_single, reverse
from app.services.bank_suggestion_priority import prioritize_bank_suggestions
from app.services.permissions import require_permission

router = APIRouter()


@router.get("", response_model=BankAutoReconciliationDashboard)
def get_bank_auto_reconciliation_dashboard(
    limit: int = Query(200, ge=1, le=500),
    q: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    db: Session = Depends(get_db),
    _user: AuthUser = Depends(require_current_user),
) -> BankAutoReconciliationDashboard:
    result = filter_cumulative_bank_suggestions(
        db,
        build_dashboard(
            db,
            limit=limit,
            q=q,
            date_from=date_from,
            date_to=date_to,
        ),
    )
    # 主表仍保留原一对一引擎；同时读取 P2 候选，把唯一精确多账单组合注入同一响应。
    # P2 页面只展示少量高分候选，但组合匹配必须使用完整未结账单池，否则历史账单
    # 会因为不在 Top 8 中而永远无法组成精确金额组合。
    p2_result = filter_cumulative_bank_suggestions(db, build_p2_dashboard(db, limit=limit))
    result = enrich_auto_dashboard_with_p2(
        result,
        p2_result,
        full_pool=_candidate_pool(db),
    )
    result = enrich_reconciliation_dashboard(db, result)
    # 银行中心默认把最值得先处理的流水放在前面：高置信 -> 高分 -> 高区分度 -> 新日期。
    # 前端仍可按日期、方向和匹配状态继续筛选，不改变任何核销写入规则。
    result = prioritize_bank_suggestions(result)
    confirmed_count, confirmed_amount = db.execute(
        select(
            func.count(BankReconciliationMatch.id),
            func.coalesce(func.sum(BankReconciliationMatch.linked_amount), 0),
        ).where(BankReconciliationMatch.status == "confirmed")
    ).one()
    result["stats"]["confirmed_matches"] = int(confirmed_count or 0)
    result["stats"]["confirmed_amount"] = round(float(confirmed_amount or 0), 2)
    return BankAutoReconciliationDashboard.model_validate(result)


@router.get("/customer-center")
def get_customer_match_center(
    db: Session = Depends(get_db),
    _user: AuthUser = Depends(require_current_user),
) -> dict:
    """按银行对方户名聚合流水，并返回客户中心简称/匹配状态。"""
    return customer_match_center(db)


@router.post("/customer-links")
def save_customer_match_link(
    payload: dict,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    counterparty_name = str(payload.get("counterparty_name") or "").strip()
    partner_id = str(payload.get("partner_id") or "").strip()
    if not counterparty_name or not partner_id:
        raise HTTPException(status_code=422, detail="请选择银行对方户名和客户")
    try:
        return save_customer_link(
            db,
            counterparty_name=counterparty_name,
            partner_id=partner_id,
            user=user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/customer-links/unlink")
def unlink_customer_match(
    payload: dict,
    db: Session = Depends(get_db),
    _user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    counterparty_name = str(payload.get("counterparty_name") or "").strip()
    if not counterparty_name:
        raise HTTPException(status_code=422, detail="请填写银行对方户名")
    return {
        "ok": True,
        "removed": remove_customer_link(db, counterparty_name=counterparty_name),
        "counterparty_name": counterparty_name,
    }


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


@router.get("/p2/bills/{bill_type}/{bill_id}/suggestions", response_model=P2Dashboard)
def get_p2_bill_suggestions(
    bill_type: str,
    bill_id: str,
    limit: int = Query(8, ge=1, le=20),
    db: Session = Depends(get_db),
    _user: AuthUser = Depends(require_current_user),
) -> P2Dashboard:
    """Fast bill-scoped bank matching for receipt drawers."""
    return P2Dashboard.model_validate(build_bill_match_suggestions(db, bill_type, bill_id, limit=limit))


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
