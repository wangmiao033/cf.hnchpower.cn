"""业务操作日志 API 模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class OperationLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    entity_type: str
    entity_id: str
    entity_number: str | None = None
    action: str
    summary: str
    actor_user_id: str | None = None
    actor_email: str | None = None
    changes: dict = Field(default_factory=dict)
    metadata: dict = Field(default_factory=dict, validation_alias="metadata_json")
    created_at: datetime


class OperationLogListResponse(BaseModel):
    items: list[OperationLogRead]
    total: int
