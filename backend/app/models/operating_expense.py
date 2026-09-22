"""经营费用台账 ORM。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base import Base


class OperatingExpense(Base):
    __tablename__ = "operating_expenses"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    expense_month: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    expense_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    expense_kind: Mapped[str] = mapped_column(String(32), nullable=False, default="other", index=True)
    amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    game_name: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    vendor_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    payment_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    payment_status: Mapped[str] = mapped_column(String(16), nullable=False, default="paid", index=True)
    invoice_status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    invoice_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    voucher_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )



class PayrollBatch(Base):
    __tablename__ = "payroll_batches"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    operating_expense_id: Mapped[str] = mapped_column(
        String, ForeignKey("operating_expenses.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    expense_month: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    company_name: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    employee_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    gross_salary: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    employee_deduction_total: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    income_tax_total: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    net_salary_total: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    source_file_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    validation_status: Mapped[str] = mapped_column(String(16), nullable=False, default="valid")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class PayrollEmployeeItem(Base):
    __tablename__ = "payroll_employee_items"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    payroll_batch_id: Mapped[str] = mapped_column(
        String, ForeignKey("payroll_batches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    employee_name: Mapped[str] = mapped_column(Text, nullable=False)
    gross_salary: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    tax_adjustment: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    pension_insurance: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    medical_insurance: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    unemployment_insurance: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    housing_fund: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    leave_deduction: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    late_deduction: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    deduction_total: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    income_tax: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    net_salary: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    signature_date: Mapped[str | None] = mapped_column(Text, nullable=True)
    validation_status: Mapped[str] = mapped_column(String(16), nullable=False, default="valid")
    deduction_difference: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    net_difference: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
