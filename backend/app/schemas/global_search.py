"""全局业务搜索响应模型。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SearchKind = Literal[
    "rd_bill",
    "channel_bill",
    "contract",
    "invoice",
    "partner",
    "bank_transaction",
]

SearchAction = Literal[
    "bill360",
    "contract_detail",
    "invoice_detail",
    "partner_focus",
    "bank_detail",
]


class GlobalSearchTarget(BaseModel):
    action: SearchAction
    view: str
    entity_id: str
    bill_type: Literal["rd", "channel"] | None = None
    direction: Literal["input", "output"] | None = None
    focus_query: str | None = None


class GlobalSearchResult(BaseModel):
    id: str
    kind: SearchKind
    title: str
    subtitle: str | None = None
    meta: str | None = None
    badge: str | None = None
    amount: float | None = None
    status: str | None = None
    score: int = Field(ge=0, le=100)
    matched_fields: list[str] = Field(default_factory=list)
    target: GlobalSearchTarget


class GlobalSearchGroupCount(BaseModel):
    kind: SearchKind
    count: int = Field(ge=0)


class GlobalSearchResponse(BaseModel):
    query: str
    total: int = Field(ge=0)
    results: list[GlobalSearchResult]
    groups: list[GlobalSearchGroupCount]
