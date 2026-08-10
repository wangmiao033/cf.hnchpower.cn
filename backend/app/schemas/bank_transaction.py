"""银行流水台账 API模型。"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

BankTransactionType = Literal["statement_import", "payment_register", "collection_register"]


class BankTransactionCreate(BaseModel):
    type: BankTransactionType
    trade_date: str | None = None
    bank_account: str | None = None
    payer_name: str | None = None
    payer_account: str | None = None
    payer_bank_name: str | None = None
    payee_name: str | None = None
    payee_account: str | None = None
    payee_bank_name: str | None = None
    amount: Decimal | None = None
    income_amount: Decimal | None = None
    expense_amount: Decimal | None = None
    balance: Decimal | None = None
    currency: str | None = Field(default="CNY")
    transaction_no: str | None = None
    instruction_no: str | None = None
    summary: str | None = None
    purpose: str | None = None
    remark: str | None = None
    status: str | None = None
    raw_text: str | None = None
    attachment_url: str | None = None
    source_bank: str | None = None
    source_file_name: str | None = None
    source_row_no: int | None = None
    dedupe_key: str | None = None
    reconciliation_id: str | None = None
    reconciliation_type: str | None = None
    reconciliation_no: str | None = None
    linked_amount: Decimal | None = None


class BankTransactionUpdate(BaseModel):
    type: BankTransactionType | None = None
    trade_date: str | None = None
    bank_account: str | None = None
    payer_name: str | None = None
    payer_account: str | None = None
    payer_bank_name: str | None = None
    payee_name: str | None = None
    payee_account: str | None = None
    payee_bank_name: str | None = None
    amount: Decimal | None = None
    income_amount: Decimal | None = None
    expense_amount: Decimal | None = None
    balance: Decimal | None = None
    currency: str | None = None
    transaction_no: str | None = None
    instruction_no: str | None = None
    summary: str | None = None
    purpose: str | None = None
    remark: str | None = None
    status: str | None = None
    raw_text: str | None = None
    attachment_url: str | None = None
    source_bank: str | None = None
    source_file_name: str | None = None
    source_row_no: int | None = None
    dedupe_key: str | None = None
    reconciliation_id: str | None = None
    reconciliation_type: str | None = None
    reconciliation_no: str | None = None
    linked_amount: Decimal | None = None


class BankTransactionRead(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    type: str
    trade_date: str | None
    bank_account: str | None
    payer_name: str | None
    payer_account: str | None
    payer_bank_name: str | None
    payee_name: str | None
    payee_account: str | None
    payee_bank_name: str | None
    amount: Decimal | None
    income_amount: Decimal | None
    expense_amount: Decimal | None
    balance: Decimal | None = None
    currency: str | None
    transaction_no: str | None
    instruction_no: str | None
    summary: str | None
    purpose: str | None
    remark: str | None
    status: str | None
    raw_text: str | None
    attachment_url: str | None
    source_bank: str | None = None
    source_file_name: str | None = None
    source_row_no: int | None = None
    dedupe_key: str | None = None
    import_batch_id: str | None = None
    reconciliation_id: str | None = None
    reconciliation_type: str | None = None
    reconciliation_no: str | None = None
    linked_amount: Decimal | None = None
    created_at: datetime
    updated_at: datetime


class BankTransactionListResponse(BaseModel):
    items: list[BankTransactionRead]
    total: int


class BankTransactionBulkImportRequest(BaseModel):
    source_bank: str | None = Field(default="ICBC", max_length=64)
    source_file_name: str | None = Field(default=None, max_length=500)
    source_sheet_name: str | None = Field(default=None, max_length=500)
    bank_account: str | None = Field(default=None, max_length=200)
    source_total_rows: int | None = Field(default=None, ge=1, le=10000)
    source_invalid_row_nos: list[int] = Field(default_factory=list, max_length=5000)
    items: list[BankTransactionCreate] = Field(min_length=1, max_length=5000)


class BankTransactionBulkImportResponse(BaseModel):
    batch_id: str
    total: int
    inserted: int
    duplicates: int
    invalid: int
    duplicate_row_nos: list[int] = Field(default_factory=list)
    invalid_row_nos: list[int] = Field(default_factory=list)


class BankImportBatchRead(BaseModel):
    id: str
    source_bank: str | None = None
    source_file_name: str | None = None
    source_sheet_name: str | None = None
    bank_account: str | None = None
    total: int
    inserted: int
    duplicates: int
    invalid: int
    income_total: Decimal = Decimal("0")
    expense_total: Decimal = Decimal("0")
    date_from: str | None = None
    date_to: str | None = None
    duplicate_row_nos: list[int] = Field(default_factory=list)
    invalid_row_nos: list[int] = Field(default_factory=list)
    legacy_backfill: bool = False
    created_at: datetime


class BankImportBatchListResponse(BaseModel):
    items: list[BankImportBatchRead]
    total: int


class BankAccountSummaryRead(BaseModel):
    source_bank: str | None = None
    bank_account: str
    transaction_count: int
    latest_trade_date: str | None = None
    latest_balance: Decimal | None = None
    latest_file_name: str | None = None
    latest_import_batch_id: str | None = None
    last_imported_at: datetime | None = None


class BankAccountSummaryListResponse(BaseModel):
    items: list[BankAccountSummaryRead]
