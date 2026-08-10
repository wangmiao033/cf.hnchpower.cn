"""P2 银行多对多核销 API 模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.bank_auto_reconciliation import BankMatchHistoryRow


class P2Candidate(BaseModel):
    bill_type: str
    bill_id: str
    bill_number: str
    partner_name: str = ""
    settlement_month: str | None = None
    game_name: str | None = None
    bill_amount: float = 0
    outstanding_amount: float = 0
    recommended_amount: float = 0
    score: float = 0
    confidence_level: str = "low"
    reasons: list[str] = Field(default_factory=list)


class P2ExistingAllocation(BaseModel):
    match_id: str
    bill_type: str
    bill_id: str
    bill_number: str | None = None
    linked_amount: float = 0


class P2Suggestion(BaseModel):
    transaction_id: str
    trade_date: str | None = None
    transaction_no: str | None = None
    direction: str
    direction_label: str
    amount: float = 0
    total_amount: float = 0
    allocated_amount: float = 0
    remaining_amount: float = 0
    allocation_count: int = 0
    allocation_status: str = "unallocated"
    bill_numbers: list[str] = Field(default_factory=list)
    existing_allocations: list[P2ExistingAllocation] = Field(default_factory=list)
    currency: str | None = None
    counterparty_name: str | None = None
    summary: str | None = None
    confidence_level: str = "none"
    top_score: float = 0
    ambiguity_margin: float = 0
    candidates: list[P2Candidate] = Field(default_factory=list)
    blocked_reason: str | None = None


class P2DashboardStats(BaseModel):
    pending_transactions: int = 0
    partial_transactions: int = 0
    remaining_amount: float = 0


class P2Dashboard(BaseModel):
    stats: P2DashboardStats
    suggestions: list[P2Suggestion] = Field(default_factory=list)


class P2AllocationItem(BaseModel):
    bill_type: str
    bill_id: str
    amount: float = Field(gt=0)


class P2AllocateRequest(BaseModel):
    allocations: list[P2AllocationItem] = Field(min_length=1, max_length=20)


class P2TransactionSummary(BaseModel):
    transaction_id: str
    direction: str
    total_amount: float = 0
    allocated_amount: float = 0
    remaining_amount: float = 0
    allocation_count: int = 0
    allocation_status: str = "unallocated"
    bill_numbers: list[str] = Field(default_factory=list)


class P2AllocateResponse(BaseModel):
    matches: list[BankMatchHistoryRow] = Field(default_factory=list)
    transaction: P2TransactionSummary
    message: str


class P2TransactionSummaryRequest(BaseModel):
    transaction_ids: list[str] = Field(default_factory=list, max_length=500)


class P2TransactionSummaryResponse(BaseModel):
    items: list[P2TransactionSummary] = Field(default_factory=list)


class P2BillAllocationRow(BaseModel):
    match_id: str
    bank_transaction_id: str
    linked_amount: float = 0
    trade_date: str | None = None
    transaction_no: str | None = None
    counterparty_name: str | None = None
    summary: str | None = None
    bank_account: str | None = None
    source_bank: str | None = None
    source_file_name: str | None = None
    source_row_no: int | None = None
    confirmed_email: str | None = None
    confirmed_at: datetime


class P2BillSummary(BaseModel):
    bill_type: str
    bill_id: str
    bill_number: str
    partner_name: str = ""
    bill_amount: float = 0
    bank_allocated_amount: float = 0
    cash_total_amount: float = 0
    remaining_amount: float = 0
    allocation_count: int = 0
    allocations: list[P2BillAllocationRow] = Field(default_factory=list)
