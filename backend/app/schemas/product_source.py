"""QuickSDK ProductCode source registry schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProductSourceImportRow(BaseModel):
    game_name: str = Field(min_length=1, max_length=255)
    product_code: str = Field(min_length=1, max_length=64)


class ProductSourceImportRequest(BaseModel):
    source_file: str | None = Field(default=None, max_length=255)
    rows: list[ProductSourceImportRow] = Field(min_length=1, max_length=2000)


class ProductSourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    game_name: str
    product_code: str
    source_file: str | None
    created_at: datetime
    updated_at: datetime


class ProductSourceListResponse(BaseModel):
    items: list[ProductSourceRead]
    total: int
    latest_import_at: datetime | None = None


class ProductSourceImportResponse(BaseModel):
    inserted: int
    updated: int
    skipped: int
    total: int

