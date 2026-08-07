"""账单生命周期 API 模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class BillTransitionOption(BaseModel):
    status: str
    label: str
    available: bool
    blocked_reason: str | None = None
    requires_reason: bool = False
    danger: bool = False


class BillLifecycleRead(BaseModel):
    bill_type: str
    bill_id: str
    status: str
    status_label: str
    locked: bool
    final: bool
    payment_phase: str
    payment_label: str
    bill_amount: float
    paid_amount: float
    invoice_coverage_status: str
    invoice_coverage_percent: float
    invoice_allocated_amount: float
    invoice_remaining_amount: float
    transitions: list[BillTransitionOption] = Field(default_factory=list)


class BillTransitionRequest(BaseModel):
    to_status: str = Field(min_length=2, max_length=32)
    reason: str | None = Field(default=None, max_length=500)
