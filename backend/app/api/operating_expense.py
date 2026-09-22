"""经营费用台账 CRUD。"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.api.operating_deposit import router as operating_deposit_router
from app.api.server_cost import router as server_cost_router
from app.core.deps import get_db
from app.models.operating_expense import OperatingExpense, PayrollBatch, PayrollEmployeeItem
from app.schemas.operating_expense import (
    OperatingExpenseCreate,
    OperatingExpenseListResponse,
    OperatingExpenseRead,
    OperatingExpenseUpdate,
    PayrollBatchCreate,
    PayrollBatchListResponse,
    PayrollBatchRead,
    PayrollBatchUpdate,
    PayrollEmployeeItemRead,
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
PAYROLL_REVIEW_STATUSES = frozenset({"pending_review", "reviewed"})
PAYROLL_WORKFLOW_STATUSES = frozenset({"pending_review", "reviewed", "paid"})
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


def _validate_payroll_review_status(raw: str | None) -> str:
    value = str(raw or "").strip().lower()
    if value not in PAYROLL_REVIEW_STATUSES:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_payroll_review_status",
                "allowed": sorted(PAYROLL_REVIEW_STATUSES),
            },
        )
    return value


def _validate_payroll_workflow_status(raw: str | None) -> str:
    value = str(raw or "").strip().lower()
    if value not in PAYROLL_WORKFLOW_STATUSES:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_payroll_workflow_status",
                "allowed": sorted(PAYROLL_WORKFLOW_STATUSES),
            },
        )
    return value


def _payroll_workflow_status(batch: PayrollBatch, expense: OperatingExpense) -> str:
    if str(expense.payment_status or "").strip().lower() == "paid":
        return "paid"
    if str(batch.review_status or "").strip().lower() == "reviewed":
        return "reviewed"
    return "pending_review"


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



PAYROLL_TOLERANCE = 0.01


def _round_money(value) -> float:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        number = 0.0
    return round(number, 2)


def _prepare_payroll_items(items) -> tuple[list[dict], dict]:
    prepared: list[dict] = []
    totals = {
        "gross_salary": 0.0,
        "employee_deduction_total": 0.0,
        "income_tax_total": 0.0,
        "net_salary_total": 0.0,
        "validation_status": "valid",
    }
    for index, item in enumerate(items or []):
        raw = item.model_dump() if hasattr(item, "model_dump") else dict(item)
        employee_name = str(raw.get("employee_name") or "").strip()
        if not employee_name:
            raise HTTPException(status_code=422, detail=f"工资明细第 {index + 1} 行缺少员工姓名")

        gross = _round_money(raw.get("gross_salary"))
        tax_adjustment = _round_money(raw.get("tax_adjustment"))
        pension = _round_money(raw.get("pension_insurance"))
        medical = _round_money(raw.get("medical_insurance"))
        unemployment = _round_money(raw.get("unemployment_insurance"))
        housing = _round_money(raw.get("housing_fund"))
        leave = _round_money(raw.get("leave_deduction"))
        late = _round_money(raw.get("late_deduction"))
        sheet_deduction = _round_money(raw.get("deduction_total"))
        income_tax = _round_money(raw.get("income_tax"))
        sheet_net = _round_money(raw.get("net_salary"))

        expected_deduction = _round_money(
            tax_adjustment + pension + medical + unemployment + housing + leave + late
        )
        deduction_difference = _round_money(sheet_deduction - expected_deduction)
        expected_net = _round_money(gross - sheet_deduction - income_tax)
        net_difference = _round_money(sheet_net - expected_net)
        validation_status = (
            "valid"
            if abs(deduction_difference) <= PAYROLL_TOLERANCE
            and abs(net_difference) <= PAYROLL_TOLERANCE
            else "mismatch"
        )
        if validation_status != "valid":
            totals["validation_status"] = "mismatch"

        prepared.append(
            {
                "id": str(uuid4()),
                "sort_order": int(raw.get("sort_order") or index),
                "employee_name": employee_name,
                "gross_salary": gross,
                "tax_adjustment": tax_adjustment,
                "pension_insurance": pension,
                "medical_insurance": medical,
                "unemployment_insurance": unemployment,
                "housing_fund": housing,
                "leave_deduction": leave,
                "late_deduction": late,
                "deduction_total": sheet_deduction,
                "income_tax": income_tax,
                "net_salary": sheet_net,
                "signature_date": _normalize_text(raw.get("signature_date")),
                "validation_status": validation_status,
                "deduction_difference": deduction_difference,
                "net_difference": net_difference,
            }
        )
        totals["gross_salary"] += gross
        totals["employee_deduction_total"] += sheet_deduction
        totals["income_tax_total"] += income_tax
        totals["net_salary_total"] += sheet_net

    if not prepared:
        raise HTTPException(status_code=422, detail="工资批次至少需要一条员工明细")

    for key in ("gross_salary", "employee_deduction_total", "income_tax_total", "net_salary_total"):
        totals[key] = _round_money(totals[key])
    if totals["gross_salary"] <= 0:
        raise HTTPException(status_code=422, detail="工资批次应发工资合计必须大于 0")
    return prepared, totals


def _payroll_batch_to_read(
    db: Session,
    batch: PayrollBatch,
    expense: OperatingExpense,
    *,
    include_items: bool = False,
) -> PayrollBatchRead:
    item_reads: list[PayrollEmployeeItemRead] = []
    if include_items:
        items = (
            db.execute(
                select(PayrollEmployeeItem)
                .where(PayrollEmployeeItem.payroll_batch_id == batch.id)
                .order_by(PayrollEmployeeItem.sort_order.asc(), PayrollEmployeeItem.created_at.asc())
            )
            .scalars()
            .all()
        )
        item_reads = [
            PayrollEmployeeItemRead(
                id=item.id,
                employee_name=item.employee_name,
                gross_salary=float(item.gross_salary or 0),
                tax_adjustment=float(item.tax_adjustment or 0),
                pension_insurance=float(item.pension_insurance or 0),
                medical_insurance=float(item.medical_insurance or 0),
                unemployment_insurance=float(item.unemployment_insurance or 0),
                housing_fund=float(item.housing_fund or 0),
                leave_deduction=float(item.leave_deduction or 0),
                late_deduction=float(item.late_deduction or 0),
                deduction_total=float(item.deduction_total or 0),
                income_tax=float(item.income_tax or 0),
                net_salary=float(item.net_salary or 0),
                signature_date=item.signature_date,
                sort_order=int(item.sort_order or 0),
                validation_status=item.validation_status or "valid",
                deduction_difference=float(item.deduction_difference or 0),
                net_difference=float(item.net_difference or 0),
            )
            for item in items
        ]

    return PayrollBatchRead(
        id=batch.id,
        operating_expense_id=expense.id,
        expense_month=batch.expense_month,
        company_name=batch.company_name,
        employee_count=int(batch.employee_count or 0),
        gross_salary=float(batch.gross_salary or 0),
        employee_deduction_total=float(batch.employee_deduction_total or 0),
        income_tax_total=float(batch.income_tax_total or 0),
        net_salary_total=float(batch.net_salary_total or 0),
        payment_status=expense.payment_status or "unpaid",
        due_date=expense.due_date,
        payment_date=expense.payment_date,
        voucher_note=expense.voucher_note,
        remark=expense.remark,
        source_file_name=batch.source_file_name,
        validation_status=batch.validation_status or "valid",
        review_status=batch.review_status or "pending_review",
        payroll_status=_payroll_workflow_status(batch, expense),
        created_at=batch.created_at,
        updated_at=batch.updated_at,
        items=item_reads,
    )


def _get_payroll_batch_pair(db: Session, batch_id: str) -> tuple[PayrollBatch, OperatingExpense]:
    pair = db.execute(
        select(PayrollBatch, OperatingExpense)
        .join(OperatingExpense, OperatingExpense.id == PayrollBatch.operating_expense_id)
        .where(PayrollBatch.id == batch_id)
    ).first()
    if pair is None:
        raise HTTPException(status_code=404, detail={"error": "payroll_batch_not_found", "id": batch_id})
    return pair[0], pair[1]


@router.get("/payroll-batches", response_model=PayrollBatchListResponse)
def list_payroll_batches(
    db: Session = Depends(get_db),
    month: str | None = Query(None),
    payment_status: str | None = Query(None),
    payroll_status: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> PayrollBatchListResponse:
    stmt = (
        select(PayrollBatch, OperatingExpense)
        .join(OperatingExpense, OperatingExpense.id == PayrollBatch.operating_expense_id)
    )
    if month and month.strip():
        stmt = stmt.where(PayrollBatch.expense_month == _validate_month(month))
    if payment_status and payment_status.strip() and payment_status != "all":
        stmt = stmt.where(
            OperatingExpense.payment_status == _validate_payment_status(payment_status)
        )
    if payroll_status and payroll_status.strip() and payroll_status != "all":
        workflow_status = _validate_payroll_workflow_status(payroll_status)
        if workflow_status == "paid":
            stmt = stmt.where(OperatingExpense.payment_status == "paid")
        elif workflow_status == "reviewed":
            stmt = stmt.where(
                OperatingExpense.payment_status == "unpaid",
                PayrollBatch.review_status == "reviewed",
            )
        else:
            stmt = stmt.where(
                OperatingExpense.payment_status == "unpaid",
                PayrollBatch.review_status == "pending_review",
            )
    if q and q.strip():
        term = f"%{q.strip()}%"
        employee_exists = (
            select(PayrollEmployeeItem.id)
            .where(
                PayrollEmployeeItem.payroll_batch_id == PayrollBatch.id,
                PayrollEmployeeItem.employee_name.ilike(term),
            )
            .exists()
        )
        stmt = stmt.where(
            or_(
                PayrollBatch.company_name.ilike(term),
                PayrollBatch.source_file_name.ilike(term),
                OperatingExpense.remark.ilike(term),
                OperatingExpense.voucher_note.ilike(term),
                employee_exists,
            )
        )

    pairs = db.execute(
        stmt.order_by(PayrollBatch.expense_month.desc(), PayrollBatch.company_name.asc())
        .limit(limit)
        .offset(offset)
    ).all()
    items = [_payroll_batch_to_read(db, pair[0], pair[1]) for pair in pairs]
    return PayrollBatchListResponse(
        items=items,
        total=len(items),
        gross_salary_total=_round_money(sum(item.gross_salary for item in items)),
        employee_deduction_total=_round_money(
            sum(item.employee_deduction_total for item in items)
        ),
        income_tax_total=_round_money(sum(item.income_tax_total for item in items)),
        net_salary_total=_round_money(sum(item.net_salary_total for item in items)),
        confirmed_net_salary_total=_round_money(
            sum(
                item.net_salary_total
                for item in items
                if item.review_status == "reviewed" or item.payment_status == "paid"
            )
        ),
        pending_review_count=sum(1 for item in items if item.payroll_status == "pending_review"),
        reviewed_count=sum(1 for item in items if item.payroll_status == "reviewed"),
        paid_count=sum(1 for item in items if item.payroll_status == "paid"),
    )


@router.get("/payroll-batches/{batch_id}", response_model=PayrollBatchRead)
def get_payroll_batch(batch_id: str, db: Session = Depends(get_db)) -> PayrollBatchRead:
    batch, expense = _get_payroll_batch_pair(db, batch_id)
    return _payroll_batch_to_read(db, batch, expense, include_items=True)


@router.post("/payroll-batches", response_model=PayrollBatchRead, status_code=status.HTTP_201_CREATED)
def create_payroll_batch(
    payload: PayrollBatchCreate,
    db: Session = Depends(get_db),
) -> PayrollBatchRead:
    month = _validate_month(payload.expense_month)
    company_name = _normalize_text(payload.company_name)
    if not company_name:
        raise HTTPException(status_code=422, detail="请输入工资所属公司")
    payment_status = _validate_payment_status(payload.payment_status)
    review_status = _validate_payroll_review_status(payload.review_status)
    payment_date = _normalize_text(payload.payment_date)
    if payment_status == "paid" and not payment_date:
        raise HTTPException(status_code=422, detail="已发放工资批次请填写实付日期")
    if payment_status == "paid":
        review_status = "reviewed"

    existing = db.execute(
        select(PayrollBatch).where(
            PayrollBatch.expense_month == month,
            PayrollBatch.company_name == company_name,
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "payroll_batch_exists",
                "id": existing.id,
                "message": f"{company_name} {month} 已存在工资批次",
            },
        )

    prepared_items, totals = _prepare_payroll_items(payload.items)
    expense_id = str(uuid4())
    batch_id = str(uuid4())
    due_date = _normalize_text(payload.due_date)
    voucher_note = _normalize_text(payload.voucher_note)
    remark = _normalize_text(payload.remark)

    expense = OperatingExpense(
        id=expense_id,
        expense_month=month,
        expense_date=payment_date or due_date,
        category="payroll",
        expense_kind="payroll",
        amount=totals["gross_salary"],
        game_name=None,
        vendor_name=company_name,
        due_date=due_date,
        payment_date=payment_date if payment_status == "paid" else None,
        payment_status=payment_status,
        invoice_status="none",
        invoice_number=None,
        voucher_note=voucher_note,
        remark=remark,
        source="payroll_import",
    )
    batch = PayrollBatch(
        id=batch_id,
        operating_expense_id=expense_id,
        expense_month=month,
        company_name=company_name,
        employee_count=len(prepared_items),
        gross_salary=totals["gross_salary"],
        employee_deduction_total=totals["employee_deduction_total"],
        income_tax_total=totals["income_tax_total"],
        net_salary_total=totals["net_salary_total"],
        source_file_name=_normalize_text(payload.source_file_name),
        validation_status=totals["validation_status"],
        review_status=review_status,
    )
    db.add(expense)
    db.add(batch)
    for item in prepared_items:
        db.add(PayrollEmployeeItem(payroll_batch_id=batch_id, **item))
    db.commit()
    db.refresh(batch)
    db.refresh(expense)
    return _payroll_batch_to_read(db, batch, expense, include_items=True)


@router.put("/payroll-batches/{batch_id}", response_model=PayrollBatchRead)
def update_payroll_batch(
    batch_id: str,
    payload: PayrollBatchUpdate,
    db: Session = Depends(get_db),
) -> PayrollBatchRead:
    batch, expense = _get_payroll_batch_pair(db, batch_id)
    data = payload.model_dump(exclude_unset=True)

    new_month = _validate_month(data["expense_month"]) if "expense_month" in data else batch.expense_month
    new_company = (
        _normalize_text(data.get("company_name"))
        if "company_name" in data
        else batch.company_name
    )
    if not new_company:
        raise HTTPException(status_code=422, detail="请输入工资所属公司")

    if new_month != batch.expense_month or new_company != batch.company_name:
        existing = db.execute(
            select(PayrollBatch).where(
                PayrollBatch.id != batch.id,
                PayrollBatch.expense_month == new_month,
                PayrollBatch.company_name == new_company,
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "payroll_batch_exists",
                    "id": existing.id,
                    "message": f"{new_company} {new_month} 已存在工资批次",
                },
            )

    payment_status = (
        _validate_payment_status(data.get("payment_status"))
        if "payment_status" in data
        else expense.payment_status
    )
    payment_date = (
        _normalize_text(data.get("payment_date"))
        if "payment_date" in data
        else expense.payment_date
    )
    review_status = (
        _validate_payroll_review_status(data.get("review_status"))
        if "review_status" in data
        else (batch.review_status or "pending_review")
    )
    if payment_status == "paid" and not payment_date:
        raise HTTPException(status_code=422, detail="已发放工资批次请填写实付日期")
    if payment_status == "paid":
        review_status = "reviewed"
    if payment_status == "unpaid":
        payment_date = None

    batch.expense_month = new_month
    batch.company_name = new_company
    batch.review_status = review_status
    expense.expense_month = new_month
    expense.vendor_name = new_company
    expense.payment_status = payment_status
    expense.payment_date = payment_date

    if "due_date" in data:
        expense.due_date = _normalize_text(data.get("due_date"))
    if "voucher_note" in data:
        expense.voucher_note = _normalize_text(data.get("voucher_note"))
    if "remark" in data:
        expense.remark = _normalize_text(data.get("remark"))
    if "source_file_name" in data:
        batch.source_file_name = _normalize_text(data.get("source_file_name"))

    if data.get("items") is not None:
        prepared_items, totals = _prepare_payroll_items(payload.items or [])
        db.execute(
            delete(PayrollEmployeeItem).where(
                PayrollEmployeeItem.payroll_batch_id == batch.id
            )
        )
        for item in prepared_items:
            db.add(PayrollEmployeeItem(payroll_batch_id=batch.id, **item))
        batch.employee_count = len(prepared_items)
        batch.gross_salary = totals["gross_salary"]
        batch.employee_deduction_total = totals["employee_deduction_total"]
        batch.income_tax_total = totals["income_tax_total"]
        batch.net_salary_total = totals["net_salary_total"]
        batch.validation_status = totals["validation_status"]
        expense.amount = totals["gross_salary"]

    expense.expense_date = expense.payment_date or expense.due_date
    now = datetime.now(timezone.utc)
    batch.updated_at = now
    expense.updated_at = now
    db.commit()
    db.refresh(batch)
    db.refresh(expense)
    return _payroll_batch_to_read(db, batch, expense, include_items=True)


@router.delete("/payroll-batches/{batch_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_payroll_batch(batch_id: str, db: Session = Depends(get_db)) -> None:
    batch, expense = _get_payroll_batch_pair(db, batch_id)
    db.delete(expense)
    db.commit()
