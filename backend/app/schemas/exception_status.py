"""异常状态 API 模型。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ExceptionStatusUpsert(BaseModel):
    exception_id: str = Field(..., min_length=1)
    status: Literal["pending", "processing", "ignored", "resolved"]
    assignee: str | None = Field(default=None, max_length=320)
    note: str | None = Field(default=None, max_length=5000)


class ExceptionStatusRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    exception_id: str
    status: str
    assignee: str | None = None
    note: str | None = None
    updated_by_email: str | None = None
    started_at: datetime | None = None
    closed_at: datetime | None = None
    updated_at: datetime


class ExceptionStatusListResponse(BaseModel):
    items: list[ExceptionStatusRead]
    total: int
