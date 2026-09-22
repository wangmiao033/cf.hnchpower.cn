"""经营费用台账 API 模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class OperatingExpenseBase(BaseModel):
    expense_month: str = Field(min_length=4, max_length=16)
    expense_date: str | None = Field(default=None, max_length=32)
    category: str = Field(min_length=1, max_length=32)
    expense_kind: str = Field(default="other", min_length=1, max_length=32)
    amount: float = Field(gt=0, le=999999999999)
    game_name: str | None = Field(default=None, max_length=500)
    vendor_name: str | None = Field(default=None, max_length=500)
    due_date: str | None = Field(default=None, max_length=32)
    payment_date: str | None = Field(default=None, max_length=32)
    payment_status: str = Field(default="paid", min_length=1, max_length=16)
    invoice_status: str = Field(default="unknown", min_length=1, max_length=16)
    invoice_number: str | None = Field(default=None, max_length=500)
    voucher_note: str | None = Field(default=None, max_length=1000)
    remark: str | None = Field(default=None, max_length=2000)
    source: str = Field(default="manual", min_length=1, max_length=32)


class OperatingExpenseCreate(OperatingExpenseBase):
    pass


class OperatingExpenseUpdate(BaseModel):
    expense_month: str | None = Field(default=None, min_length=4, max_length=16)
    expense_date: str | None = Field(default=None, max_length=32)
    category: str | None = Field(default=None, min_length=1, max_length=32)
    expense_kind: str | None = Field(default=None, min_length=1, max_length=32)
    amount: float | None = Field(default=None, gt=0, le=999999999999)
    game_name: str | None = Field(default=None, max_length=500)
    vendor_name: str | None = Field(default=None, max_length=500)
    due_date: str | None = Field(default=None, max_length=32)
    payment_date: str | None = Field(default=None, max_length=32)
    payment_status: str | None = Field(default=None, min_length=1, max_length=16)
    invoice_status: str | None = Field(default=None, min_length=1, max_length=16)
    invoice_number: str | None = Field(default=None, max_length=500)
    voucher_note: str | None = Field(default=None, max_length=1000)
    remark: str | None = Field(default=None, max_length=2000)
    source: str | None = Field(default=None, min_length=1, max_length=32)


class OperatingExpenseRead(OperatingExpenseBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime


class OperatingExpenseListResponse(BaseModel):
    items: list[OperatingExpenseRead]
    total: int
    amount_total: float = 0



class PayrollEmployeeItemIn(BaseModel):
    employee_name: str = Field(min_length=1, max_length=200)
    gross_salary: float = 0
    tax_adjustment: float = 0
    pension_insurance: float = 0
    medical_insurance: float = 0
    unemployment_insurance: float = 0
    housing_fund: float = 0
    leave_deduction: float = 0
    late_deduction: float = 0
    deduction_total: float = 0
    income_tax: float = 0
    net_salary: float = 0
    signature_date: str | None = Field(default=None, max_length=100)
    sort_order: int = 0


class PayrollEmployeeItemRead(PayrollEmployeeItemIn):
    id: str
    validation_status: str
    deduction_difference: float = 0
    net_difference: float = 0


class PayrollBatchCreate(BaseModel):
    expense_month: str = Field(min_length=4, max_length=16)
    company_name: str = Field(min_length=1, max_length=500)
    due_date: str | None = Field(default=None, max_length=32)
    payment_status: str = Field(default="unpaid", min_length=1, max_length=16)
    payment_date: str | None = Field(default=None, max_length=32)
    voucher_note: str | None = Field(default=None, max_length=1000)
    remark: str | None = Field(default=None, max_length=2000)
    source_file_name: str | None = Field(default=None, max_length=500)
    review_status: str = Field(default="pending_review", min_length=1, max_length=16)
    items: list[PayrollEmployeeItemIn] = Field(min_length=1, max_length=500)


class PayrollBatchUpdate(BaseModel):
    expense_month: str | None = Field(default=None, min_length=4, max_length=16)
    company_name: str | None = Field(default=None, min_length=1, max_length=500)
    due_date: str | None = Field(default=None, max_length=32)
    payment_status: str | None = Field(default=None, min_length=1, max_length=16)
    payment_date: str | None = Field(default=None, max_length=32)
    voucher_note: str | None = Field(default=None, max_length=1000)
    remark: str | None = Field(default=None, max_length=2000)
    source_file_name: str | None = Field(default=None, max_length=500)
    review_status: str | None = Field(default=None, min_length=1, max_length=16)
    items: list[PayrollEmployeeItemIn] | None = Field(default=None, min_length=1, max_length=500)


class PayrollBatchRead(BaseModel):
    id: str
    operating_expense_id: str
    expense_month: str
    company_name: str
    employee_count: int
    gross_salary: float
    employee_deduction_total: float
    income_tax_total: float
    net_salary_total: float
    payment_status: str
    due_date: str | None = None
    payment_date: str | None = None
    voucher_note: str | None = None
    remark: str | None = None
    source_file_name: str | None = None
    validation_status: str
    review_status: str
    payroll_status: str
    created_at: datetime
    updated_at: datetime
    items: list[PayrollEmployeeItemRead] = []


class PayrollBatchListResponse(BaseModel):
    items: list[PayrollBatchRead]
    total: int
    gross_salary_total: float = 0
    employee_deduction_total: float = 0
    income_tax_total: float = 0
    net_salary_total: float = 0
    confirmed_net_salary_total: float = 0
    pending_review_count: int = 0
    reviewed_count: int = 0
    paid_count: int = 0
