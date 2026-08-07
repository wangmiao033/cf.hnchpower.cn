"""AI/智能异常分析 API 模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class AnomalyAiInputItem(BaseModel):
    id: str = Field(min_length=1, max_length=500)
    severity: str = "warning"
    category: str = "quality"
    title: str = Field(default="", max_length=500)
    detail: str = Field(default="", max_length=3000)
    amount: float | None = None
    bill_type: str | None = None
    bill_id: str | None = None
    bill_number: str | None = None
    partner_name: str | None = None
    settlement_month: str | None = None
    game_name: str | None = None
    status: str = "pending"


class AnomalyAiAnalysisRequest(BaseModel):
    items: list[AnomalyAiInputItem] = Field(default_factory=list, max_length=500)


class AnomalyAiItemAnalysis(BaseModel):
    anomaly_id: str
    priority_score: int = 0
    priority_label: str
    confidence: float = 0
    root_causes: list[str] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)
    related_signals: list[str] = Field(default_factory=list)
    explanation: str
    bill_type: str | None = None
    bill_id: str | None = None


class AnomalyAiSystemSignal(BaseModel):
    key: str
    severity: str
    title: str
    detail: str
    value: float | None = None
    action: str | None = None


class AnomalyAiSummary(BaseModel):
    risk_score: int = 0
    health_label: str
    exposure_amount: float = 0
    critical_count: int = 0
    warning_count: int = 0
    info_count: int = 0
    narrative: str
    top_risks: list[str] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)


class AnomalyAiAnalysisResponse(BaseModel):
    engine: str = "explainable-risk-engine"
    generated_at: str
    summary: AnomalyAiSummary
    system_signals: list[AnomalyAiSystemSignal] = Field(default_factory=list)
    items: list[AnomalyAiItemAnalysis] = Field(default_factory=list)
