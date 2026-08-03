"""研发/渠道账单与发票的金额分配。"""

from __future__ import annotations

from datetime import datetime, timezone
import re
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.channel import ChannelRecord
from app.models.invoice import InvoiceRecord
from app.models.reconciliation import ReconciliationRecord
from app.schemas.bill_invoice_allocation import (
    AllocationInvoiceBrief,
    BillInvoiceAllocationCreate,
    BillInvoiceAllocationRead,
    BillInvoiceCandidate,
    BillInvoiceSummary,
)

router = APIRouter()
ACTIVE_STATUSES = ("suggested", "confirmed")


def _bill(db: Session, bill_type: str, bill_id: str):
    if bill_type == "rd":
        row = db.get(ReconciliationRecord, bill_id)
    elif bill_type == "channel":
        row = db.get(ChannelRecord, bill_id)
    else:
        raise HTTPException(status_code=422, detail={"error": "invalid_bill_type"})
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "bill_not_found", "id": bill_id})
    return row


def _invoice_gross(invoice: InvoiceRecord) -> float:
    gross = float(invoice.amount_with_tax or 0)
    return gross if gross != 0 else float(invoice.invoice_amount or 0) + float(invoice.tax_amount or 0)


def _invoice_number(invoice: InvoiceRecord) -> str:
    return invoice.digital_invoice_no or invoice.invoice_no or invoice.id


def _invoice_brief(invoice: InvoiceRecord) -> AllocationInvoiceBrief:
    direction = invoice.invoice_direction or "output"
    counterparty = (
        invoice.seller_name if direction == "input" else invoice.buyer_name
    ) or invoice.title or "未填写往来单位"
    return AllocationInvoiceBrief(
        id=invoice.id,
        direction=direction,
        number=_invoice_number(invoice),
        counterparty_name=counterparty,
        gross_amount=round(_invoice_gross(invoice), 2),
        tax_status=invoice.tax_status or "normal",
        issue_date=invoice.invoice_date,
    )


def _allocation_read(row: BillInvoiceAllocation, invoice: InvoiceRecord) -> BillInvoiceAllocationRead:
    return BillInvoiceAllocationRead(
        id=row.id,
        bill_type=row.bill_type,
        bill_id=row.bill_id,
        invoice_id=row.invoice_id,
        allocated_net_amount=float(row.allocated_net_amount or 0),
        allocated_tax_amount=float(row.allocated_tax_amount or 0),
        allocated_gross_amount=float(row.allocated_gross_amount or 0),
        status=row.status,
        match_type=row.match_type,
        match_score=float(row.match_score or 0),
        match_reasons=list(row.match_reasons or []),
        confirmed_at=row.confirmed_at,
        created_at=row.created_at,
        invoice=_invoice_brief(invoice),
    )


def _used_by_invoice(db: Session, invoice_id: str) -> float:
    value = db.execute(
        select(func.coalesce(func.sum(BillInvoiceAllocation.allocated_gross_amount), 0)).where(
            BillInvoiceAllocation.invoice_id == invoice_id,
            BillInvoiceAllocation.status.in_(ACTIVE_STATUSES),
        )
    ).scalar_one()
    return float(value or 0)


def _coverage_status(allocated: float, bill_amount: float) -> str:
    if allocated <= 0.01:
        return "none"
    if allocated + 0.01 < bill_amount:
        return "partial"
    if allocated > bill_amount + 0.01:
        return "over"
    return "complete"


def _month_key(value: str | None) -> str:
    """Normalize YYYY-MM, YYYY年M月 and full dates to YYYY-MM."""
    text_value = str(value or "").strip()
    match = re.search(r"(\d{4})\D*(\d{1,2})", text_value)
    if not match:
        return ""
    return f"{match.group(1)}-{int(match.group(2)):02d}"


def _is_invoice_allocatable(invoice: InvoiceRecord) -> bool:
    tax_status = invoice.tax_status or "normal"
    return tax_status not in {"red", "void"} and invoice.status != "作废"


@router.get("/bill/{bill_type}/{bill_id}", response_model=BillInvoiceSummary)
def get_bill_invoice_summary(
    bill_type: str, bill_id: str, db: Session = Depends(get_db)
) -> BillInvoiceSummary:
    bill = _bill(db, bill_type, bill_id)
    bill_amount = abs(float(bill.settlement_amount or 0))
    allocation_rows = db.execute(
        select(BillInvoiceAllocation).where(
            BillInvoiceAllocation.bill_type == bill_type,
            BillInvoiceAllocation.bill_id == bill_id,
            BillInvoiceAllocation.status.in_(ACTIVE_STATUSES),
        ).order_by(BillInvoiceAllocation.created_at.desc())
    ).scalars().all()
    invoice_ids = {row.invoice_id for row in allocation_rows}
    invoices = {
        invoice.id: invoice
        for invoice in db.execute(
            select(InvoiceRecord).where(InvoiceRecord.id.in_(invoice_ids))
        ).scalars().all()
    } if invoice_ids else {}
    allocations = [
        _allocation_read(row, invoices[row.invoice_id])
        for row in allocation_rows
        if row.invoice_id in invoices
    ]
    linked_invoice_ids = list(invoice_ids)
    red_totals = {
        original_id: float(total or 0)
        for original_id, total in db.execute(
            select(
                InvoiceRecord.original_invoice_id,
                func.coalesce(func.sum(func.abs(InvoiceRecord.amount_with_tax)), 0),
            ).where(
                InvoiceRecord.original_invoice_id.in_(linked_invoice_ids),
                InvoiceRecord.tax_status == "red",
            ).group_by(InvoiceRecord.original_invoice_id)
        ).all()
    } if linked_invoice_ids else {}
    allocated = 0.0
    for item in allocations:
        invoice = invoices.get(item.invoice_id)
        if invoice is None or not _is_invoice_allocatable(invoice):
            continue
        invoice_gross = abs(_invoice_gross(invoice))
        red_ratio = min(1.0, red_totals.get(invoice.id, 0) / invoice_gross) if invoice_gross else 0
        allocated += item.allocated_gross_amount * (1 - red_ratio)
    allocated = round(allocated, 2)
    remaining = round(max(0, bill_amount - allocated), 2)
    direction = "input" if bill_type == "rd" else "output"
    invoice_rows = db.execute(
        select(InvoiceRecord)
        .where(InvoiceRecord.invoice_direction == direction)
        .order_by(InvoiceRecord.invoice_date.desc(), InvoiceRecord.created_at.desc())
        .limit(300)
    ).scalars().all()
    candidate_ids = [invoice.id for invoice in invoice_rows]
    used_amounts = {
        invoice_id: float(total or 0)
        for invoice_id, total in db.execute(
            select(
                BillInvoiceAllocation.invoice_id,
                func.coalesce(func.sum(BillInvoiceAllocation.allocated_gross_amount), 0),
            ).where(
                BillInvoiceAllocation.invoice_id.in_(candidate_ids),
                BillInvoiceAllocation.status.in_(ACTIVE_STATUSES),
            ).group_by(BillInvoiceAllocation.invoice_id)
        ).all()
    } if candidate_ids else {}
    candidates: list[BillInvoiceCandidate] = []
    bill_partner = str(getattr(bill, "partner_name", None) or "").strip()
    bill_month = str(getattr(bill, "settlement_month", None) or "").strip()
    for invoice in invoice_rows:
        if invoice.id in invoice_ids or not _is_invoice_allocatable(invoice):
            continue
        available = round(max(0, _invoice_gross(invoice) - used_amounts.get(invoice.id, 0)), 2)
        if available <= 0.01:
            continue
        brief = _invoice_brief(invoice)
        reasons: list[str] = []
        score = 0.0
        if bill_partner and (bill_partner in brief.counterparty_name or brief.counterparty_name in bill_partner):
            score += 0.4
            reasons.append("往来单位匹配")
        if abs(available - remaining) <= 0.01:
            score += 0.4
            reasons.append("剩余金额一致")
        elif remaining > 0 and abs(available - remaining) / remaining <= 0.05:
            score += 0.25
            reasons.append("金额接近")
        if _month_key(bill_month) and _month_key(invoice.invoice_date) == _month_key(bill_month):
            score += 0.2
            reasons.append("账期一致")
        candidates.append(BillInvoiceCandidate(
            invoice=brief,
            available_amount=available,
            suggested_amount=round(min(available, remaining or available), 2),
            match_score=round(score, 4),
            match_reasons=reasons,
        ))
    candidates.sort(key=lambda item: (item.match_score, item.invoice.issue_date or ""), reverse=True)
    coverage_percent = min(999.9, allocated / bill_amount * 100) if bill_amount > 0 else 0
    return BillInvoiceSummary(
        bill_type=bill_type,
        bill_id=bill_id,
        bill_amount=round(bill_amount, 2),
        allocated_amount=allocated,
        remaining_amount=remaining,
        coverage_percent=round(coverage_percent, 1),
        coverage_status=_coverage_status(allocated, bill_amount),
        allocations=allocations,
        candidates=candidates[:50],
    )


@router.post("", response_model=BillInvoiceAllocationRead, status_code=status.HTTP_201_CREATED)
def create_bill_invoice_allocation(
    payload: BillInvoiceAllocationCreate, db: Session = Depends(get_db)
) -> BillInvoiceAllocationRead:
    bill_type = payload.bill_type.strip().lower()
    bill_id = payload.bill_id.strip()
    bill = _bill(db, bill_type, bill_id)
    invoice = db.get(InvoiceRecord, payload.invoice_id.strip())
    if invoice is None:
        raise HTTPException(status_code=404, detail={"error": "invoice_not_found"})
    expected_direction = "input" if bill_type == "rd" else "output"
    if (invoice.invoice_direction or "output") != expected_direction:
        raise HTTPException(status_code=409, detail={"error": "invoice_direction_mismatch"})
    if not _is_invoice_allocatable(invoice):
        raise HTTPException(status_code=409, detail={"error": "invoice_not_allocatable"})
    amount = round(float(payload.allocated_gross_amount), 2)
    invoice_available = round(_invoice_gross(invoice) - _used_by_invoice(db, invoice.id), 2)
    if amount > invoice_available + 0.01:
        raise HTTPException(status_code=409, detail={"error": "invoice_amount_exceeded", "available": invoice_available})
    bill_used = db.execute(
        select(func.coalesce(func.sum(BillInvoiceAllocation.allocated_gross_amount), 0)).where(
            BillInvoiceAllocation.bill_type == bill_type,
            BillInvoiceAllocation.bill_id == bill_id,
            BillInvoiceAllocation.status.in_(ACTIVE_STATUSES),
        )
    ).scalar_one()
    bill_remaining = abs(float(bill.settlement_amount or 0)) - float(bill_used or 0)
    if amount > bill_remaining + 0.01:
        raise HTTPException(status_code=409, detail={"error": "bill_amount_exceeded", "remaining": round(max(0, bill_remaining), 2)})
    now = datetime.now(timezone.utc)
    row = BillInvoiceAllocation(
        id=str(uuid4()),
        bill_type=bill_type,
        bill_id=bill_id,
        invoice_id=invoice.id,
        allocated_net_amount=payload.allocated_net_amount,
        allocated_tax_amount=payload.allocated_tax_amount,
        allocated_gross_amount=amount,
        status="confirmed",
        match_type=payload.match_type or "manual",
        match_score=payload.match_score,
        match_reasons=payload.match_reasons,
        confirmed_at=now,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail={"error": "duplicate_allocation"})
    db.refresh(row)
    return _allocation_read(row, invoice)


@router.delete("/{allocation_id}", status_code=status.HTTP_204_NO_CONTENT)
def reverse_bill_invoice_allocation(allocation_id: str, db: Session = Depends(get_db)) -> None:
    row = db.get(BillInvoiceAllocation, allocation_id)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    row.status = "reversed"
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
