"""Schemas for finance invoice tasks."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class FinanceInvoiceTaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_no: str
    bill_type: str
    bill_id: str
    direction: str
    status: str
    requested_amount: float
    allocated_amount: float
    bill_number: str | None = None
    partner_name: str | None = None
    game_name: str | None = None
    settlement_month: str | None = None
    submitted_by_id: str | None = None
    submitted_by_email: str | None = None
    submitted_by_name: str | None = None
    submitted_at: datetime
    assigned_to_id: str | None = None
    assigned_to_email: str | None = None
    assigned_to_name: str | None = None
    started_at: datetime | None = None
    rejected_at: datetime | None = None
    reject_reason: str | None = None
    completed_at: datetime | None = None
    completed_by_id: str | None = None
    completed_by_email: str | None = None
    completed_by_name: str | None = None
    invoice_id: str | None = None
    remark: str | None = None
    created_at: datetime
    updated_at: datetime


class FinanceInvoiceTaskListResponse(BaseModel):
    items: list[FinanceInvoiceTaskRead]
    total: int


class FinanceInvoiceTaskSummary(BaseModel):
    pending_count: int = 0
    pending_amount: float = 0
    processing_count: int = 0
    processing_amount: float = 0
    completed_count: int = 0
    completed_amount: float = 0
    rejected_count: int = 0
    rejected_amount: float = 0


class FinanceInvoiceTaskRejectRequest(BaseModel):
    reason: str = Field(min_length=2, max_length=1000)


class FinanceInvoiceTaskCompleteRequest(BaseModel):
    invoice_id: str = Field(min_length=1)
    allocated_amount: float | None = Field(default=None, gt=0)
    remark: str | None = Field(default=None, max_length=1000)


class FinanceInvoiceTaskStatusItem(BaseModel):
    bill_type: str
    bill_id: str
    task_id: str
    task_no: str
    status: str
    requested_amount: float
    allocated_amount: float
    assigned_to_name: str | None = None
    submitted_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    reject_reason: str | None = None
    invoice_id: str | None = None


class FinanceInvoiceTaskStatusResponse(BaseModel):
    items: list[FinanceInvoiceTaskStatusItem]
