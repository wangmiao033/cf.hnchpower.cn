"""Response models for V2.5-3 customer 360."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Customer360Partner(BaseModel):
    id: str
    name: str
    short_name: str = ""
    category: str = ""
    tag: str = ""
    tax_registration_no: str = ""
    bank_name: str = ""
    bank_account: str = ""
    invoice_content: str = ""
    recipient: str = ""
    recipient_phone: str = ""
    mailing_address: str = ""
    created_at: str | None = None
    updated_at: str | None = None


class Customer360Access(BaseModel):
    contracts: bool = False
    reconciliation: bool = False
    invoices: bool = False
    funds: bool = False


class Customer360Summary(BaseModel):
    contract_count: int | None = None
    active_contract_count: int | None = None
    contract_amount: float | None = None
    rd_bill_count: int | None = None
    rd_settlement_amount: float | None = None
    rd_paid_amount: float | None = None
    rd_unpaid_amount: float | None = None
    channel_bill_count: int | None = None
    channel_settlement_amount: float | None = None
    channel_received_amount: float | None = None
    channel_unreceived_amount: float | None = None
    invoice_count: int | None = None
    invoice_amount: float | None = None
    input_invoice_count: int | None = None
    output_invoice_count: int | None = None
    bank_transaction_count: int | None = None
    bank_inflow_amount: float | None = None
    bank_outflow_amount: float | None = None
    latest_trade_date: str | None = None


class Customer360Contract(BaseModel):
    id: str
    internal_contract_no: str = ""
    contract_no: str = ""
    contract_name: str = ""
    contract_type: str = ""
    products: list[str] = Field(default_factory=list)
    channels: list[str] = Field(default_factory=list)
    amount: float = 0
    effective_date: str | None = None
    end_date: str | None = None
    performance_status: str = ""
    payment_type: str = ""
    state: Literal["active", "pending", "expired", "ended"] = "active"
    created_at: str | None = None
    updated_at: str | None = None


class Customer360RdBill(BaseModel):
    id: str
    statement_no: str = ""
    settlement_month: str = ""
    games: str = ""
    settlement_amount: float = 0
    paid_amount: float = 0
    unpaid_amount: float = 0
    payment_status: str = ""
    latest_payment_date: str | None = None
    status: str = ""
    created_at: str | None = None
    updated_at: str | None = None


class Customer360ChannelBill(BaseModel):
    id: str
    statement_no: str = ""
    settlement_month: str = ""
    games: str = ""
    settlement_amount: float = 0
    received_amount: float = 0
    unreceived_amount: float = 0
    receipt_status: str = ""
    status: str = ""
    created_at: str | None = None
    updated_at: str | None = None


class Customer360Invoice(BaseModel):
    id: str
    direction: Literal["input", "output"]
    invoice_no: str = ""
    invoice_date: str = ""
    buyer_name: str = ""
    seller_name: str = ""
    amount: float = 0
    tax_amount: float = 0
    tax_status: str = ""
    status: str = ""
    created_at: str | None = None
    updated_at: str | None = None


class Customer360BankTransaction(BaseModel):
    id: str
    type: str = ""
    trade_date: str = ""
    transaction_no: str = ""
    payer_name: str = ""
    payee_name: str = ""
    summary: str = ""
    inflow: float = 0
    outflow: float = 0
    currency: str = "CNY"
    reconciliation_no: str = ""
    status: str = ""
    created_at: str | None = None
    updated_at: str | None = None


class Customer360Activity(BaseModel):
    kind: Literal["contract", "rd_bill", "channel_bill", "invoice", "bank_transaction"]
    entity_id: str
    date: str | None = None
    title: str = ""
    amount: float = 0
    meta: str = ""


class Customer360Response(BaseModel):
    partner: Customer360Partner
    access: Customer360Access
    summary: Customer360Summary
    contracts: list[Customer360Contract] = Field(default_factory=list)
    rd_bills: list[Customer360RdBill] = Field(default_factory=list)
    channel_bills: list[Customer360ChannelBill] = Field(default_factory=list)
    invoices: list[Customer360Invoice] = Field(default_factory=list)
    bank_transactions: list[Customer360BankTransaction] = Field(default_factory=list)
    recent_activities: list[Customer360Activity] = Field(default_factory=list)
