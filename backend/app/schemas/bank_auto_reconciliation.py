"""银行流水自动核销 API 模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class BankMatchCandidate(BaseModel):
    bill_type: str
    bill_id: str
    bill_number: str
    partner_name: str
    settlement_month: str | None = None
    game_name: str | None = None
    bill_amount: float = 0
    outstanding_amount: float = 0
    score: float = 0
    confidence_level: str = "low"
    reasons: list[str] = Field(default_factory=list)


class BankMatchSuggestion(BaseModel):
    transaction_id: str
    trade_date: str | None = None
    transaction_no: str | None = None
    direction: str
    direction_label: str
    amount: float = 0
    currency: str | None = None
    counterparty_name: str | None = None
    summary: str | None = None
    auto_ready: bool = False
    confidence_level: str = "none"
    top_score: float = 0
    ambiguity_margin: float = 0
    candidates: list[BankMatchCandidate] = Field(default_factory=list)
    blocked_reason: str | None = None


class BankMatchHistoryRow(BaseModel):
    match_id: str
    bank_transaction_id: str
    trade_date: str | None = None
    transaction_no: str | None = None
    direction: str
    direction_label: str
    bill_type: str
    bill_id: str
    bill_number: str | None = None
    linked_amount: float = 0
    confidence_score: float = 0
    confidence_level: str = "manual"
    status: str
    confirmed_email: str | None = None
    confirmed_at: datetime
    reversed_email: str | None = None
    reversed_at: datetime | None = None
    reverse_reason: str | None = None


class BankAutoReconciliationStats(BaseModel):
    pending_transactions: int = 0
    high_confidence: int = 0
    medium_confidence: int = 0
    unmatched: int = 0
    confirmed_matches: int = 0
    confirmed_amount: float = 0


class BankAutoReconciliationDashboard(BaseModel):
    stats: BankAutoReconciliationStats
    suggestions: list[BankMatchSuggestion] = Field(default_factory=list)
    recent_matches: list[BankMatchHistoryRow] = Field(default_factory=list)


class BankMatchConfirmRequest(BaseModel):
    bill_type: str
    bill_id: str


class BankMatchReverseRequest(BaseModel):
    reason: str = Field(min_length=2, max_length=500)


class BankMatchConfirmResponse(BaseModel):
    match: BankMatchHistoryRow
    message: str
