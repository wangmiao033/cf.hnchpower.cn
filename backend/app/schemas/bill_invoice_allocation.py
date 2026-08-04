"""账单—发票金额分配 API 模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class BillInvoiceAllocationCreate(BaseModel):
    bill_type: str
    bill_id: str
    invoice_id: str
    allocated_gross_amount: float = Field(gt=0)
    allocated_net_amount: float = Field(default=0, ge=0)
    allocated_tax_amount: float = Field(default=0, ge=0)
    match_type: str = "manual"
    match_score: float = Field(default=0, ge=0, le=1)
    match_reasons: list[str] = Field(default_factory=list)


class AllocationInvoiceBrief(BaseModel):
    id: str
    direction: str
    number: str
    counterparty_name: str
    gross_amount: float
    tax_status: str
    issue_date: str | None = None


class BillInvoiceAllocationRead(BaseModel):
    id: str
    bill_type: str
    bill_id: str
    invoice_id: str
    allocated_net_amount: float
    allocated_tax_amount: float
    allocated_gross_amount: float
    status: str
    match_type: str
    match_score: float
    match_reasons: list[str]
    confirmed_at: datetime | None
    created_at: datetime
    invoice: AllocationInvoiceBrief


class BillInvoiceCandidate(BaseModel):
    invoice: AllocationInvoiceBrief
    available_amount: float
    suggested_amount: float
    match_score: float
    match_reasons: list[str]


class BillInvoiceSummary(BaseModel):
    bill_type: str
    bill_id: str
    bill_amount: float
    allocated_amount: float
    remaining_amount: float
    coverage_percent: float
    coverage_status: str
    allocations: list[BillInvoiceAllocationRead]
    candidates: list[BillInvoiceCandidate]


class AllocationBillBrief(BaseModel):
    bill_type: str
    bill_id: str
    number: str
    partner_name: str
    game_name: str | None = None
    settlement_month: str | None = None
    gross_amount: float
    status: str


class InvoiceBillAllocationRead(BaseModel):
    id: str
    bill_type: str
    bill_id: str
    invoice_id: str
    allocated_gross_amount: float
    status: str
    match_type: str
    match_score: float
    match_reasons: list[str]
    confirmed_at: datetime | None
    created_at: datetime
    bill: AllocationBillBrief


class InvoiceBillCandidate(BaseModel):
    bill: AllocationBillBrief
    available_amount: float
    suggested_amount: float
    match_score: float
    match_reasons: list[str]


class InvoiceAllocationOverview(BaseModel):
    invoice_id: str
    invoice_amount: float
    allocated_amount: float
    remaining_amount: float
    coverage_percent: float
    coverage_status: str
    allocation_count: int


class InvoiceBillSummary(InvoiceAllocationOverview):
    allocations: list[InvoiceBillAllocationRead]
    candidates: list[InvoiceBillCandidate]


class InvoiceAutoMatchRequest(BaseModel):
    invoice_direction: str | None = None
    invoice_ids: list[str] = Field(default_factory=list, max_length=500)
    threshold: float = Field(default=0.8, ge=0.5, le=1)
    unique_margin: float = Field(default=0.1, ge=0, le=0.5)
    dry_run: bool = True


class InvoiceAutoMatchItem(BaseModel):
    invoice_id: str
    invoice_number: str
    bill_type: str
    bill_id: str
    bill_number: str
    allocated_gross_amount: float
    match_score: float
    match_reasons: list[str]


class InvoiceAutoMatchResponse(BaseModel):
    dry_run: bool
    matched: int
    matched_amount: float
    ambiguous: int
    unmatched: int
    skipped: int
    items: list[InvoiceAutoMatchItem]
