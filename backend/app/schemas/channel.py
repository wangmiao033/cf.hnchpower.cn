"""渠道对账 API 模型：主表 + 明细 items。"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


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
    items: Annotated[list[ChannelLineItemCreate], Field(min_length=1)]


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
    items: list[ChannelLineItemCreate] | None = None


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
