from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

class MonthRow(BaseModel):
    model_config = ConfigDict(extra='forbid')
    game_id: str = Field(default='', max_length=100)
    game_name: str = Field(min_length=1, max_length=255)
    cash_cents: StrictInt | None = Field(default=None, ge=0, le=999999999999)
    refund_cents: StrictInt | None = Field(default=None, ge=0, le=999999999999)
    fee_cents: StrictInt | None = Field(default=None, ge=0, le=999999999999)
    received_cents: StrictInt | None = Field(default=None, ge=0, le=999999999999)
    rd_line_id: str | None = Field(default=None, max_length=100)
    expected_cash_cents: StrictInt | None = Field(default=None, ge=0, le=999999999999)
    expected_rd_cents: StrictInt | None = Field(default=None, ge=0, le=999999999999)
    status: Literal['pending','checked'] = 'pending'
    @model_validator(mode='after')
    def identity(self):
        self.game_id=self.game_id.strip()
        self.game_name=self.game_name.strip()
        if not self.game_name: raise ValueError('游戏名称不能为空')
        return self

class MonthSave(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: UUID
    revision: StrictInt = Field(ge=0)
    rows: list[MonthRow] = Field(max_length=500)
    confirmed: Literal[True]
