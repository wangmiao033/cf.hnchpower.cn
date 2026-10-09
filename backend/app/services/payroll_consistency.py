"""Read-only payroll-to-operating-expense integrity checks.

Only aggregate company/month amounts are returned. Employee names and individual
salaries remain in the payroll ledger, not the anomaly-centre payload.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, load_only

from app.models.operating_expense import OperatingExpense, PayrollBatch, PayrollEmployeeItem


CENT = Decimal("0.01")
TOLERANCE = Decimal("0.01")


def _money(value) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(CENT, rounding=ROUND_HALF_UP)
    except (ValueError, TypeError, ArithmeticError):
        return Decimal("0.00")


def _issue(*, code: str, severity: str, title: str, detail: str,
           batch=None, expense=None, amount=None) -> dict:
    month = str(getattr(batch, "expense_month", None) or
                getattr(expense, "expense_month", None) or "").strip()
    company = str(getattr(batch, "company_name", None) or
                  getattr(expense, "vendor_name", None) or "").strip()
    ref_id = str(getattr(batch, "id", None) or getattr(expense, "id", None) or "")
    return {
        "id": f"payroll:{code}:{ref_id}",
        "severity": severity,
        "category": "payroll",
        "title": title,
        "detail": detail,
        "bill_type": None,
        "bill_id": None,
        "bill_number": None,
        "partner_name": company or None,
        "settlement_month": month or None,
        "amount": float(_money(amount)) if amount is not None else None,
        "target_view": "payroll-expenses",
        "source_id": ref_id or None,
    }


def inspect_payroll_integrity(batches: list, expenses: list, items: list) -> list[dict]:
    """Compare imported batch summaries with expense and employee detail totals."""
    results: list[dict] = []
    expenses_by_id = {str(e.id): e for e in expenses}
    batch_expense_ids: set[str] = set()
    items_by_batch: dict[str, list] = defaultdict(list)
    for item in items:
        items_by_batch[str(item.payroll_batch_id)].append(item)

    seen_month_company: dict[tuple[str, str], str] = {}
    for batch in batches:
        batch_id = str(batch.id)
        linked_expense_id = str(batch.operating_expense_id)
        batch_expense_ids.add(linked_expense_id)
        month = str(batch.expense_month or "").strip()
        company = str(batch.company_name or "").strip()
        key = (month, company)
        if key in seen_month_company:
            results.append(_issue(
                code="duplicate", severity="critical", batch=batch,
                title="同公司同月份存在重复工资批次",
                detail=f"{month} {company} 已有另一笔工资批次（{seen_month_company[key][:8]}…），请人工核对，不要再次导入。",
            ))
        else:
            seen_month_company[key] = batch_id

        expense = expenses_by_id.get(linked_expense_id)
        if expense is None:
            results.append(_issue(
                code="orphan-batch", severity="critical", batch=batch,
                title="工资批次缺少关联经营费用",
                detail="该工资批次关联的经营费用不存在，可能导致利润统计漏计。请先核对记录，勿自行补造。",
            ))
        else:
            if expense.category != "payroll":
                results.append(_issue(
                    code="category", severity="critical", batch=batch,
                    title="工资关联费用分类异常",
                    detail=f"工资批次关联的经营费用被标记为 {expense.category!s}，应核对利润归属。",
                ))
            if str(expense.expense_month or "") != month or str(expense.vendor_name or "").strip() != company:
                results.append(_issue(
                    code="identity", severity="warning", batch=batch,
                    title="工资批次与费用台账公司或月份不一致",
                    detail=f"工资批次为 {month} {company}，费用台账为 {expense.expense_month} {expense.vendor_name or '未填写公司'}。",
                ))
            difference = _money(expense.amount) - _money(batch.gross_salary)
            if abs(difference) > TOLERANCE:
                results.append(_issue(
                    code="gross", severity="critical", batch=batch,
                    title="工资应发额与经营费用金额不一致",
                    detail=f"经营费用 {_money(expense.amount):.2f} 元，工资批次应发 {_money(batch.gross_salary):.2f} 元，差异 {abs(difference):.2f} 元。",
                    amount=abs(difference),
                ))
            if str(expense.payment_status or "") == "paid" and not str(expense.payment_date or "").strip():
                results.append(_issue(
                    code="paid-date", severity="warning", batch=batch,
                    title="工资标记已发放但缺少支付日期",
                    detail="付款状态为已发放，但没有支付日期；仅核对银行回单后补充支付日期。",
                ))

        employees = items_by_batch.get(batch_id, [])
        if not employees:
            results.append(_issue(
                code="empty-items", severity="critical", batch=batch,
                title="工资批次缺少员工工资明细",
                detail="工资批次存在，但没有员工级应发和代扣明细，不能直接认定实发数准确。",
            ))
            continue
        if int(batch.employee_count or 0) != len(employees):
            results.append(_issue(
                code="count", severity="warning", batch=batch,
                title="工资批次员工人数与明细条数不一致",
                detail=f"批次标记 {int(batch.employee_count or 0)} 人，实际明细 {len(employees)} 条。",
            ))

        fields = (
            ("gross_salary", "应发工资"),
            ("deduction_total", "个人代扣"),
            ("income_tax", "个人所得税"),
            ("net_salary", "实发工资"),
        )
        batch_fields = {
            "gross_salary": "gross_salary",
            "deduction_total": "employee_deduction_total",
            "income_tax": "income_tax_total",
            "net_salary": "net_salary_total",
        }
        for employee_field, name in fields:
            actual = sum((_money(getattr(item, employee_field, 0)) for item in employees), Decimal("0.00"))
            reported = _money(getattr(batch, batch_fields[employee_field], 0))
            if abs(actual - reported) > TOLERANCE:
                results.append(_issue(
                    code=f"details-{employee_field}", severity="critical", batch=batch,
                    title=f"工资批次{name}合计与员工明细不一致",
                    detail=f"批次合计 {reported:.2f} 元，员工明细累计 {actual:.2f} 元，差异 {abs(actual - reported):.2f} 元。",
                    amount=abs(actual - reported),
                ))

    for expense in expenses:
        if str(expense.source or "") == "payroll_import" and str(expense.id) not in batch_expense_ids:
            results.append(_issue(
                code="orphan-expense", severity="critical", expense=expense,
                title="经营费用中的工资导入记录缺少工资批次",
                detail="这笔费用仍计入利润，但工资批次及员工明细找不到，请核对历史操作及备份。",
                amount=expense.amount,
            ))
    return results


def scan_payroll_integrity(db: Session) -> tuple[list[dict], int]:
    """Read only essential payroll columns and never change database state."""
    batches = db.execute(select(PayrollBatch).options(load_only(
        PayrollBatch.id, PayrollBatch.operating_expense_id,
        PayrollBatch.expense_month, PayrollBatch.company_name,
        PayrollBatch.employee_count, PayrollBatch.gross_salary,
        PayrollBatch.employee_deduction_total, PayrollBatch.income_tax_total,
        PayrollBatch.net_salary_total,
    ))).scalars().all()
    expense_ids = [str(b.operating_expense_id) for b in batches]
    expenses = db.execute(select(OperatingExpense).options(load_only(
        OperatingExpense.id, OperatingExpense.source,
        OperatingExpense.category, OperatingExpense.expense_month,
        OperatingExpense.vendor_name, OperatingExpense.amount,
        OperatingExpense.payment_status, OperatingExpense.payment_date,
    )).where(or_(
        OperatingExpense.id.in_(expense_ids),
        OperatingExpense.source == "payroll_import",
    ))).scalars().all()
    batch_ids = [str(b.id) for b in batches]
    items = db.execute(select(PayrollEmployeeItem).options(load_only(
        PayrollEmployeeItem.id, PayrollEmployeeItem.payroll_batch_id,
        PayrollEmployeeItem.gross_salary, PayrollEmployeeItem.deduction_total,
        PayrollEmployeeItem.income_tax, PayrollEmployeeItem.net_salary,
    )).where(PayrollEmployeeItem.payroll_batch_id.in_(batch_ids))).scalars().all()
    return inspect_payroll_integrity(batches, expenses, items), len(batches)
