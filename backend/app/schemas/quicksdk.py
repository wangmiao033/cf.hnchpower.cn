"""QuickSDK flow library API schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class QuickSdkBatchRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_file: str | None = None
    settlement_month: str | None = None
    row_count: int = 0
    game_count: int = 0
    channel_count: int = 0
    total_flow: float = 0
    note: str | None = None
    imported_at: datetime


class QuickSdkBatchListResponse(BaseModel):
    items: list[QuickSdkBatchRead]
    total: int


class QuickSdkSummaryResponse(BaseModel):
    batch_count: int = 0
    row_count: int = 0
    game_count: int = 0
    channel_count: int = 0
    total_flow: float = 0


class QuickSdkFlowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    batch_id: str
    flow_date: str | None = None
    settlement_month: str | None = None
    game_name: str
    channel_name: str
    gross_flow: float
    created_at: datetime


class QuickSdkFlowListResponse(BaseModel):
    items: list[QuickSdkFlowRead]
    total: int


class QuickSdkImportRow(BaseModel):
    flow_date: str | None = None
    settlement_month: str | None = None
    game_name: str = Field(min_length=1)
    channel_name: str = Field(min_length=1)
    gross_flow: float = 0


class QuickSdkImportRequest(BaseModel):
    source_file: str | None = None
    settlement_month: str | None = None
    note: str | None = None
    rows: list[QuickSdkImportRow]


class QuickSdkRankItem(BaseModel):
    name: str
    flow: float = 0
    row_count: int = 0
    percentage: float = 0


class QuickSdkAnalyticsResponse(BaseModel):
    game_rankings: list[QuickSdkRankItem] = []
    channel_rankings: list[QuickSdkRankItem] = []


class QuickSdkGameFlowResponse(BaseModel):
    game_name: str
    settlement_month: str | None = None
    row_count: int = 0
    channel_count: int = 0
    source_game_count: int = 0
    total_flow: float = 0
    top_channel: str | None = None
    top_channel_flow: float = 0


class QuickSdkRdLineSuggestion(BaseModel):
    game_name: str = Field(description="研发账单使用的产品/项目组名称")
    settlement_month: str | None = None
    row_count: int = 0
    channel_count: int = 0
    source_game_count: int = 0
    total_flow: float = 0
    top_channel: str | None = None
    top_channel_flow: float = 0


class QuickSdkRdLineListResponse(BaseModel):
    items: list[QuickSdkRdLineSuggestion]
    total: int
