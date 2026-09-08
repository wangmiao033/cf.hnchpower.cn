"""经营费用台账 CRUD。"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.operating_deposit import router as operating_deposit_router
from app.api.server_cost import router as server_cost_router
from app.core.deps import get_db
from app.models.operating_expense import OperatingExpense
from app.schemas.operating_expense import (
    OperatingExpenseCreate,
    OperatingExpenseListResponse,
    OperatingExpenseRead,
    OperatingExpenseUpdate,
)
from app.services.monthly_business_dashboard import month_key

router = APIRouter()
router.include_router(server_cost_router, prefix="/server-costs", tags=["server-costs"])
router.include_router(operating_deposit_router, prefix="/deposits", tags=["operating-deposits"])

OPERATING_EXPENSE_CATEGORIES = frozenset(
    {
        "marketing",
        "payroll",
        "office",
        "tax",
        "financing",
        "platform",
        "other",
    }
)
PAYMENT_STATUSES = frozenset({"paid", "unpaid"})
INVOICE_STATUSES = frozenset({"unknown", "none", "pending", "received"})


def _normalize_text(value: str | None) -> str | None:
    text = str(value or "").strip()
    return text or None


def _validate_month(raw: str | None) -> str:
    normalized = month_key(raw)
    if not normalized:
        raise HTTPException(status_code=422, detail="费用月份格式无效，请使用 YYYY-MM")
    return normalized


def _validate_category(raw: str | None) -> str:
    category = str(raw or "").strip().lower()
    if category not in OPERATING_EXPENSE_CATEGORIES:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_expense_category",
                "allowed": sorted(OPERATING_EXPENSE_CATEGORIES),
            },
        )
    return category


def _validate_payment_status(raw: str | None) -> str:
    value = str(raw or "").strip().lower()
    if value not in PAYMENT_STATUSES:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_payment_status", "allowed": sorted(PAYMENT_STATUSES)},
        )
    return value


def _validate_invoice_status(raw: str | None) -> str:
    value = str(raw or "").strip().lower()
    if value not in INVOICE_STATUSES:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_invoice_status", "allowed": sorted(INVOICE_STATUSES)},
        )
    return value


def _normalize_expense_kind(raw: str | None) -> str:
    value = str(raw or "other").strip().lower()
    return value or "other"


def _apply_filters(
    stmt,
    *,
    month: str | None,
    category: str | None,
    expense_kind: str | None,
    game_name: str | None,
    q: str | None,
):
    if month and month.strip():
        normalized_month = _validate_month(month)
        stmt = stmt.where(OperatingExpense.expense_month == normalized_month)
    if category and category.strip():
        stmt = stmt.where(OperatingExpense.category == _validate_category(category))
    if expense_kind and expense_kind.strip():
        stmt = stmt.where(OperatingExpense.expense_kind == _normalize_expense_kind(expense_kind))
    if game_name and game_name.strip():
        stmt = stmt.where(OperatingExpense.game_name.ilike(f"%{game_name.strip()}%"))
    if q and q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                OperatingExpense.game_name.ilike(term),
                OperatingExpense.vendor_name.ilike(term),
                OperatingExpense.remark.ilike(term),
                OperatingExpense.category.ilike(term),
                OperatingExpense.expense_kind.ilike(term),
                OperatingExpense.invoice_number.ilike(term),
                OperatingExpense.voucher_note.ilike(term),
            )
        )
    return stmt


@router.get("", response_model=OperatingExpenseListResponse)
def list_operating_expenses(
    db: Session = Depends(get_db),
    month: str | None = Query(None),
    category: str | None = Query(None),
    expense_kind: str | None = Query(None),
    game_name: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> OperatingExpenseListResponse:
    base = _apply_filters(
        select(OperatingExpense),
        month=month,
        category=category,
        expense_kind=expense_kind,
        game_name=game_name,
        q=q,
    )
    filtered = base.subquery()
    total = int(db.execute(select(func.count()).select_from(filtered)).scalar_one())
    amount_total = float(
        db.execute(select(func.coalesce(func.sum(filtered.c.amount), 0))).scalar_one() or 0
    )
    rows = (
        db.execute(
            base.order_by(
                OperatingExpense.expense_month.desc(),
                OperatingExpense.created_at.desc(),
            ).limit(limit).offset(offset)
        )
        .scalars()
        .all()
    )
    return OperatingExpenseListResponse(
        items=[OperatingExpenseRead.model_validate(row) for row in rows],
        total=total,
        amount_total=round(amount_total, 2),
    )


@router.post("", response_model=OperatingExpenseRead, status_code=status.HTTP_201_CREATED)
def create_operating_expense(
    payload: OperatingExpenseCreate,
    db: Session = Depends(get_db),
) -> OperatingExpenseRead:
    data = payload.model_dump()
    data["expense_month"] = _validate_month(data.get("expense_month"))
    data["category"] = _validate_category(data.get("category"))
    data["expense_kind"] = _normalize_expense_kind(data.get("expense_kind"))
    data["payment_status"] = _validate_payment_status(data.get("payment_status"))
    data["invoice_status"] = _validate_invoice_status(data.get("invoice_status"))
    for field in (
        "game_name",
        "vendor_name",
        "remark",
        "expense_date",
        "due_date",
        "payment_date",
        "invoice_number",
        "voucher_note",
    ):
        data[field] = _normalize_text(data.get(field))
    data["source"] = str(data.get("source") or "manual").strip() or "manual"
    row = OperatingExpense(id=str(uuid4()), **data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return OperatingExpenseRead.model_validate(row)


@router.put("/{expense_id}", response_model=OperatingExpenseRead)
def update_operating_expense(
    expense_id: str,
    payload: OperatingExpenseUpdate,
    db: Session = Depends(get_db),
) -> OperatingExpenseRead:
    row = db.get(OperatingExpense, expense_id)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "id": expense_id})
    data = payload.model_dump(exclude_unset=True)
    if "expense_month" in data:
        data["expense_month"] = _validate_month(data.get("expense_month"))
    if "category" in data:
        data["category"] = _validate_category(data.get("category"))
    if "expense_kind" in data:
        data["expense_kind"] = _normalize_expense_kind(data.get("expense_kind"))
    if "payment_status" in data:
        data["payment_status"] = _validate_payment_status(data.get("payment_status"))
    if "invoice_status" in data:
        data["invoice_status"] = _validate_invoice_status(data.get("invoice_status"))
    if "amount" in data and data.get("amount") is None:
        raise HTTPException(status_code=422, detail="费用金额不能为空")
    if "source" in data:
        source = str(data.get("source") or "").strip()
        if not source:
            raise HTTPException(status_code=422, detail="费用来源不能为空")
        data["source"] = source
    for field in (
        "game_name",
        "vendor_name",
        "remark",
        "expense_date",
        "due_date",
        "payment_date",
        "invoice_number",
        "voucher_note",
    ):
        if field in data:
            data[field] = _normalize_text(data.get(field))
    for key, value in data.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return OperatingExpenseRead.model_validate(row)


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_operating_expense(expense_id: str, db: Session = Depends(get_db)) -> None:
    row = db.get(OperatingExpense, expense_id)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "id": expense_id})
    db.delete(row)
    db.commit()
