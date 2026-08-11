"""独立服务器成本台账 API 模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ServerCostBase(BaseModel):
    expense_month: str = Field(min_length=4, max_length=16)
    expense_date: str | None = Field(default=None, max_length=32)
    provider_name: str | None = Field(default=None, max_length=500)
    category: str = Field(default="cloud_server", min_length=1, max_length=32)
    amount: float = Field(gt=0, le=999999999999)
    game_name: str | None = Field(default=None, max_length=500)
    payer_entity: str | None = Field(default=None, max_length=500)
    remark: str | None = Field(default=None, max_length=2000)
    source: str = Field(default="manual", min_length=1, max_length=32)


class ServerCostCreate(ServerCostBase):
    pass


class ServerCostUpdate(BaseModel):
    expense_month: str | None = Field(default=None, min_length=4, max_length=16)
    expense_date: str | None = Field(default=None, max_length=32)
    provider_name: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, min_length=1, max_length=32)
    amount: float | None = Field(default=None, gt=0, le=999999999999)
    game_name: str | None = Field(default=None, max_length=500)
    payer_entity: str | None = Field(default=None, max_length=500)
    remark: str | None = Field(default=None, max_length=2000)
    source: str | None = Field(default=None, min_length=1, max_length=32)


class ServerCostVoid(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)


class ServerCostRead(ServerCostBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: str = "active"
    void_reason: str | None = None
    voided_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ServerCostListResponse(BaseModel):
    items: list[ServerCostRead]
    total: int
    amount_total: float = 0
