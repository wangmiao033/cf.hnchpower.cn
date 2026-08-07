"""经营费用台账 API 模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class OperatingExpenseBase(BaseModel):
    expense_month: str = Field(min_length=4, max_length=16)
    expense_date: str | None = Field(default=None, max_length=32)
    category: str = Field(min_length=1, max_length=32)
    amount: float = Field(gt=0, le=999999999999)
    game_name: str | None = Field(default=None, max_length=500)
    vendor_name: str | None = Field(default=None, max_length=500)
    remark: str | None = Field(default=None, max_length=2000)
    source: str = Field(default="manual", min_length=1, max_length=32)


class OperatingExpenseCreate(OperatingExpenseBase):
    pass


class OperatingExpenseUpdate(BaseModel):
    expense_month: str | None = Field(default=None, min_length=4, max_length=16)
    expense_date: str | None = Field(default=None, max_length=32)
    category: str | None = Field(default=None, min_length=1, max_length=32)
    amount: float | None = Field(default=None, gt=0, le=999999999999)
    game_name: str | None = Field(default=None, max_length=500)
    vendor_name: str | None = Field(default=None, max_length=500)
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
