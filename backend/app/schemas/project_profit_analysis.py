"""项目毛利分析 API 模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ProjectProfitMonthRow(BaseModel):
    month: str
    channel_settlement: float = 0
    rd_cost: float = 0
    server_cost: float = 0
    attributed_expense: float = 0
    total_attributable_cost: float = 0
    gross_profit: float = 0
    gross_margin: float = 0


class ProjectProfitRow(BaseModel):
    game_name: str
    channel_settlement: float = 0
    rd_cost: float = 0
    server_cost: float = 0
    attributed_expense: float = 0
    total_attributable_cost: float = 0
    gross_profit: float = 0
    gross_margin: float = 0
    channel_flow: float = 0
    rd_flow: float = 0
    active_months: int = 0
    first_month: str | None = None
    last_month: str | None = None
    monthly: list[ProjectProfitMonthRow] = Field(default_factory=list)


class ProjectProfitSummary(BaseModel):
    project_count: int = 0
    profitable_projects: int = 0
    loss_projects: int = 0
    channel_settlement: float = 0
    total_attributable_cost: float = 0
    gross_profit: float = 0
    gross_margin: float = 0
    shared_server_cost: float = 0
    shared_expense: float = 0
    data_months: int = 0


class ProjectProfitAnalysisRead(BaseModel):
    scope: str
    year: str | None = None
    available_years: list[str] = Field(default_factory=list)
    summary: ProjectProfitSummary = Field(default_factory=ProjectProfitSummary)
    projects: list[ProjectProfitRow] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
