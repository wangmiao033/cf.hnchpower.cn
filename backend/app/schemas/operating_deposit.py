"""押金 / 保证金台账 API 模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class OperatingDepositBase(BaseModel):
    deposit_type: str = Field(default="office", min_length=1, max_length=32)
    title: str = Field(min_length=1, max_length=500)
    counterparty: str | None = Field(default=None, max_length=500)
    amount: float = Field(gt=0, le=999999999999)
    paid_date: str | None = Field(default=None, max_length=32)
    expected_refund_date: str | None = Field(default=None, max_length=32)
    status: str = Field(default="held", min_length=1, max_length=16)
    refund_date: str | None = Field(default=None, max_length=32)
    remark: str | None = Field(default=None, max_length=2000)


class OperatingDepositCreate(OperatingDepositBase):
    pass


class OperatingDepositUpdate(BaseModel):
    deposit_type: str | None = Field(default=None, min_length=1, max_length=32)
    title: str | None = Field(default=None, min_length=1, max_length=500)
    counterparty: str | None = Field(default=None, max_length=500)
    amount: float | None = Field(default=None, gt=0, le=999999999999)
    paid_date: str | None = Field(default=None, max_length=32)
    expected_refund_date: str | None = Field(default=None, max_length=32)
    status: str | None = Field(default=None, min_length=1, max_length=16)
    refund_date: str | None = Field(default=None, max_length=32)
    remark: str | None = Field(default=None, max_length=2000)


class OperatingDepositRead(OperatingDepositBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime


class OperatingDepositListResponse(BaseModel):
    items: list[OperatingDepositRead]
    total: int
    amount_total: float = 0
