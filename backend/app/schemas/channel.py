"""渠道对账 API 模型：主表 + 明细 items。"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator


_BUSINESS_TZ = ZoneInfo("Asia/Shanghai")
_SETTLEMENT_MONTH_RE = re.compile(r"^(20\d{2})(?:[-/.]|年)\s*(0?[1-9]|1[0-2])月?$")


def _current_business_month() -> str:
    now = datetime.now(_BUSINESS_TZ)
    return f"{now.year:04d}-{now.month:02d}"


def _normalize_safe_settlement_month(value: str | None) -> str | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    match = _SETTLEMENT_MONTH_RE.match(raw)
    if match is None:
        raise ValueError("结算月份必须使用 YYYY-MM 格式，例如 2025-10")
    normalized = f"{match.group(1)}-{int(match.group(2)):02d}"
    current = _current_business_month()
    if normalized > current:
        raise ValueError(f"结算月份不能晚于当前月份（{current}）")
    return normalized


class ChannelReceiptCreate(BaseModel):
    amount: float = Field(gt=0, description="收款金额，须大于 0")
    receipt_date: str | None = None
    bank_account: str | None = None
    remark: str | None = None
    attachment_url: str | None = None


class ChannelReceiptRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    channel_record_id: str
    amount: float
    receipt_date: str | None
    bank_account: str | None
    remark: str | None
    attachment_url: str | None
    created_at: datetime
    source_type: str = "manual"
    source_label: str = "手工登记"
    bank_match_id: str | None = None
    bank_transaction_id: str | None = None
    bank_transaction_no: str | None = None
    bank_match_status: str | None = None
    can_delete_directly: bool = True


class ChannelReceiptListResponse(BaseModel):
    items: list[ChannelReceiptRead]


class ChannelLineItemCreate(BaseModel):
    settlement_cycle: str | None = None
    game_name: str | None = None
    billing_flow: float = Field(default=0, ge=0)
    discount_factor: float = Field(default=1, ge=0, le=1)
    voucher_cost: float = 0
    no_worry_cost: float = 0
    refund_cost: float = 0
    test_cost: float = 0
    welfare_cost: float = 0
    coin_cost: float = 0
    share_rate: float = Field(default=0, ge=0, le=100)
    billing_amount: float = 0
    share_amount: float = 0
    tax_rate: float = Field(default=0, ge=0, le=100)
    gateway_cost: float = 0
    settlement_rule_code: str | None = None
    channel_fee_mode: str | None = None
    channel_fee_rate: float | None = Field(default=None, ge=0, le=100)
    tax_mode: str | None = None
    validation_tolerance: float | None = Field(default=None, ge=0, le=1000)
    platform_settlement_amount: float | None = None
    system_settlement_amount: float = 0
    settlement_difference: float | None = None
    validation_status: str = "unvalidated"
    settlement_amount: float = 0

    @field_validator("settlement_cycle", mode="before")
    @classmethod
    def validate_settlement_cycle(cls, value: str | None) -> str | None:
        return _normalize_safe_settlement_month(value)


class ChannelLineItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    channel_record_id: str
    sort_order: int
    settlement_cycle: str | None = None
    game_name: str | None
    billing_flow: float
    discount_factor: float = 1
    voucher_cost: float
    no_worry_cost: float
    refund_cost: float
    test_cost: float
    welfare_cost: float
    coin_cost: float = 0
    share_rate: float
    billing_amount: float
    share_amount: float
    tax_rate: float
    gateway_cost: float
    settlement_rule_code: str | None = None
    channel_fee_mode: str | None = None
    channel_fee_rate: float | None = None
    tax_mode: str | None = None
    validation_tolerance: float | None = None
    platform_settlement_amount: float | None = None
    system_settlement_amount: float = 0
    settlement_difference: float | None = None
    validation_status: str = "unvalidated"
    settlement_amount: float
    created_at: datetime
    updated_at: datetime


class ChannelRecordCreate(BaseModel):
    statement_no: str | None = None
    channel_name: str | None = None
    partner_name: str | None = None
    settlement_month: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    remark: str | None = None
    status: str | None = "pending"
    server_cost: float | None = None
    discount_type: str | None = None
    channel_fee_rate: float | None = Field(default=None, ge=0, le=100)
    dev_share_rate: float | None = Field(default=None, ge=0, le=100)
    profit_rate: float | None = Field(default=None, ge=0, le=100)
    settlement_rule_code: str = "legacy_fixed_fee_tax"
    channel_fee_mode: str = "fixed"
    tax_mode: str = "share"
    validation_tolerance: float = Field(default=0.05, ge=0, le=1000)
    settlement_adjustment_type: str | None = None
    settlement_adjustment_source_month: str | None = None
    settlement_adjustment_amount: float = 0
    settlement_adjustment_reason: str | None = None
    settlement_final_override: float | None = Field(default=None, ge=0)
    items: Annotated[list[ChannelLineItemCreate], Field(min_length=1)]

    @field_validator("settlement_month", mode="before")
    @classmethod
    def validate_settlement_month(cls, value: str | None) -> str | None:
        return _normalize_safe_settlement_month(value)

    @field_validator("settlement_adjustment_source_month", mode="before")
    @classmethod
    def validate_adjustment_source_month(cls, value: str | None) -> str | None:
        return _normalize_safe_settlement_month(value)


class ChannelRecordUpdate(BaseModel):
    statement_no: str | None = None
    channel_name: str | None = None
    partner_name: str | None = None
    settlement_month: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    remark: str | None = None
    status: str | None = None
    server_cost: float | None = None
    discount_type: str | None = None
    channel_fee_rate: float | None = Field(default=None, ge=0, le=100)
    dev_share_rate: float | None = Field(default=None, ge=0, le=100)
    profit_rate: float | None = Field(default=None, ge=0, le=100)
    settlement_rule_code: str | None = None
    channel_fee_mode: str | None = None
    tax_mode: str | None = None
    validation_tolerance: float | None = Field(default=None, ge=0, le=1000)
    settlement_adjustment_type: str | None = None
    settlement_adjustment_source_month: str | None = None
    settlement_adjustment_amount: float | None = None
    settlement_adjustment_reason: str | None = None
    settlement_final_override: float | None = Field(default=None, ge=0)
    items: list[ChannelLineItemCreate] | None = None

    @field_validator("settlement_month", mode="before")
    @classmethod
    def validate_settlement_month(cls, value: str | None) -> str | None:
        return _normalize_safe_settlement_month(value)

    @field_validator("settlement_adjustment_source_month", mode="before")
    @classmethod
    def validate_adjustment_source_month(cls, value: str | None) -> str | None:
        return _normalize_safe_settlement_month(value)


class ChannelRecordRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    statement_no: str | None = None
    channel_name: str | None
    partner_name: str | None
    game_name: str | None
    settlement_month: str | None
    start_date: str | None
    end_date: str | None
    billing_flow: float
    voucher_cost: float
    no_worry_cost: float
    refund_cost: float
    test_cost: float
    welfare_cost: float
    coin_cost: float = 0
    share_rate: float
    billing_amount: float
    share_amount: float
    tax_rate: float
    gateway_cost: float
    settlement_amount: float
    settlement_adjustment_type: str | None = None
    settlement_adjustment_source_month: str | None = None
    settlement_adjustment_amount: float = 0
    settlement_adjustment_reason: str | None = None
    settlement_final_override: float | None = None
    received_amount: float = 0
    receipt_status: str = "unpaid"
    status: str | None
    remark: str | None
    server_cost: float | None
    discount_type: str | None
    channel_fee_rate: float | None
    dev_share_rate: float | None
    profit_rate: float | None
    settlement_rule_code: str = "legacy_fixed_fee_tax"
    channel_fee_mode: str = "fixed"
    tax_mode: str = "share"
    validation_tolerance: float = 0.05
    system_settlement_amount: float = 0
    platform_settlement_amount: float | None = None
    settlement_difference: float | None = None
    validation_status: str = "unvalidated"
    created_at: datetime
    updated_at: datetime
    items: list[ChannelLineItemRead] = Field(default_factory=list)


class ChannelRecordListResponse(BaseModel):
    items: list[ChannelRecordRead]
    total: int