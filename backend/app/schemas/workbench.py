"""今日待办中心响应模型。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


TodoSeverity = Literal["critical", "warning", "info", "clear"]


class WorkbenchTodoItem(BaseModel):
    key: str
    label: str
    count: int = Field(ge=0)
    amount: float | None = None
    severity: TodoSeverity = "info"
    description: str
    detail: str | None = None
    target: str
    action_label: str


class WorkbenchTodoSummary(BaseModel):
    total_count: int = Field(ge=0)
    urgent_count: int = Field(ge=0)
    review_count: int = Field(ge=0)
    receivable_amount: float = 0
    payable_amount: float = 0
    invoice_gap_amount: float = 0


class WorkbenchBillSnapshot(BaseModel):
    rd_bill_count: int = Field(default=0, ge=0)
    channel_bill_count: int = Field(default=0, ge=0)
    rd_pending_count: int = Field(default=0, ge=0)
    channel_pending_count: int = Field(default=0, ge=0)
    rd_total_amount: float = 0
    channel_total_amount: float = 0
    latest_settlement_month: str | None = None


class WorkbenchTodoResponse(BaseModel):
    generated_at: datetime
    summary: WorkbenchTodoSummary
    snapshot: WorkbenchBillSnapshot = Field(default_factory=WorkbenchBillSnapshot)
    items: list[WorkbenchTodoItem]
    visible_modules: list[str]
