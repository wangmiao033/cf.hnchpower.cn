"""经营利润分析 API 模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ProfitMetric(BaseModel):
    value: float = 0
    previous_value: float = 0
    change_amount: float = 0
    change_percent: float | None = None


class ProfitTrendRow(BaseModel):
    month: str
    channel_settlement: float = 0
    rd_cost: float = 0
    server_cost: float = 0
    operating_expense: float = 0
    operating_profit: float = 0
    profit_margin: float = 0


class ProfitExpenseCategoryRow(BaseModel):
    category: str
    amount: float = 0
    share_percent: float = 0


class ProfitGameRow(BaseModel):
    game_name: str
    channel_settlement: float = 0
    rd_cost: float = 0
    server_cost_allocated: float = 0
    attributed_expense: float = 0
    attributable_profit: float = 0
    attributable_margin: float = 0
    channel_flow: float = 0
    rd_flow: float = 0


class ProfitAnalysisRead(BaseModel):
    month: str
    previous_month: str
    available_months: list[str] = Field(default_factory=list)
    latest_month: str | None = None

    channel_settlement: ProfitMetric
    rd_cost: ProfitMetric
    server_cost: ProfitMetric
    legacy_server_cost: ProfitMetric = Field(default_factory=ProfitMetric)
    standalone_server_cost: ProfitMetric = Field(default_factory=ProfitMetric)
    shared_server_cost: ProfitMetric = Field(default_factory=ProfitMetric)
    attributed_server_cost: ProfitMetric = Field(default_factory=ProfitMetric)
    operating_expense: ProfitMetric
    pre_expense_contribution: ProfitMetric
    operating_profit: ProfitMetric
    profit_margin: ProfitMetric
    shared_expense: ProfitMetric
    attributed_expense: ProfitMetric

    channel_bill_count: int = 0
    rd_bill_count: int = 0
    server_cost_count: int = 0
    expense_count: int = 0

    expense_categories: list[ProfitExpenseCategoryRow] = Field(default_factory=list)
    games: list[ProfitGameRow] = Field(default_factory=list)
    trend: list[ProfitTrendRow] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
