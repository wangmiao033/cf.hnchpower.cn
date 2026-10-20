"""大熊游戏服务端正式入账与只读账簿接口的严格输入/输出契约。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator


class SelfOperatedOrderInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    order_id: str = Field(alias="orderId", min_length=1, max_length=160)
    game_id: str = Field(default="", alias="gameId", max_length=100)
    game_name: str = Field(default="", alias="gameName", max_length=255)
    amount_cents: StrictInt = Field(alias="amountCents", ge=1, le=999999999999)
    paid_date: date = Field(alias="paidDate")
    kind: Literal["game", "coin"]
    payment: Literal["paid"]
    disposition: Literal["ready"]

    @model_validator(mode="after")
    def validate_identity(self):
        if not self.order_id.strip() or self.order_id != self.order_id.strip():
            raise ValueError("订单编号必须保留原始文本，不能包含首尾空白")
        if self.kind == "game" and not (self.game_id.strip() or self.game_name.strip()):
            raise ValueError("游戏充值订单必须提供游戏名称或游戏ID")
        if self.paid_date.year < 2020 or self.paid_date.year > 2100:
            raise ValueError("支付日期超出允许范围")
        return self


class SelfOperatedConfirmRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    request_key: UUID = Field(alias="requestKey")
    source_filename: str = Field(alias="sourceFile", min_length=1, max_length=255)
    rows: list[SelfOperatedOrderInput] = Field(min_length=1, max_length=5000)
    confirmed: Literal[True]
    source_status_column_present: Literal[True] = Field(alias="sourceStatusColumnPresent")
    source_type_column_present: Literal[True] = Field(alias="sourceTypeColumnPresent")


class SelfOperatedConfirmResult(BaseModel):
    import_id: str
    replayed: bool
    submitted: int
    inserted: int
    skipped_existing: int
    inserted_game_cents: int
    inserted_coin_cents: int
    created_at: datetime


class SelfOperatedGameSummary(BaseModel):
    game_id: str
    game_name: str
    orders: int
    amount_cents: int


class SelfOperatedMonthlySummary(BaseModel):
    schema_ready: bool
    write_ready: bool
    status_reason: str
    settlement_month: str
    game_orders: int = 0
    game_cents: int = 0
    coin_orders: int = 0
    coin_cents: int = 0
    games: list[SelfOperatedGameSummary] = Field(default_factory=list)


class SelfOperatedImportAudit(BaseModel):
    id: str
    source_filename: str
    submitted_count: int
    inserted_count: int
    duplicate_count: int
    inserted_game_cents: int
    inserted_coin_cents: int
    created_at: datetime
