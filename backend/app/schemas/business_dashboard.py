"""月度经营驾驶舱 API 模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class BusinessMetric(BaseModel):
    value: float = 0
    previous_value: float = 0
    change_amount: float = 0
    change_percent: float | None = None


class MonthlyBusinessTrendItem(BaseModel):
    month: str
    channel_settlement: float = 0
    rd_settlement: float = 0
    server_cost: float = 0
    contribution: float = 0
    contribution_margin: float = 0
    channel_receipts: float = 0
    rd_payments: float = 0
    cash_net: float = 0


class MonthlyBusinessGameItem(BaseModel):
    game_name: str
    channel_settlement: float = 0
    rd_settlement: float = 0
    contribution_before_server: float = 0
    channel_flow: float = 0
    rd_flow: float = 0


class MonthlyBusinessDashboardRead(BaseModel):
    month: str
    previous_month: str
    available_months: list[str] = Field(default_factory=list)
    latest_month: str | None = None

    channel_settlement: BusinessMetric
    rd_settlement: BusinessMetric
    server_cost: BusinessMetric
    contribution: BusinessMetric
    contribution_margin: BusinessMetric

    channel_receipts: BusinessMetric
    rd_payments: BusinessMetric
    cash_net: BusinessMetric
    channel_outstanding: BusinessMetric

    channel_bill_count: int = 0
    rd_bill_count: int = 0
    channel_completed_count: int = 0
    rd_completed_count: int = 0

    trend: list[MonthlyBusinessTrendItem] = Field(default_factory=list)
    games: list[MonthlyBusinessGameItem] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
