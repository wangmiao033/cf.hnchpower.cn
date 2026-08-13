"""Bill360 and reconciliation read-optimized endpoints.

Keep these endpoints read-only. They collapse many small browser requests into a
few database queries without changing reconciliation, invoice or QuickSDK facts.
"""

from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.channel import ChannelRecord
from app.models.invoice import InvoiceRecord
from app.models.quicksdk import QuickSdkFlow
from app.models.reconciliation import ReconciliationRecord

router = APIRouter()
ACTIVE_INVOICE_ALLOCATION_STATUSES = ("suggested", "confirmed")


class Bill360QuickSdkKey(BaseModel):
    key: str = Field(min_length=1, max_length=300)
    settlement_month: str = Field(min_length=1, max_length=20)
    game_name: str = Field(min_length=1, max_length=300)


class Bill360QuickSdkRequest(BaseModel):
    keys: list[Bill360QuickSdkKey] = Field(default_factory=list, max_length=40)


class BillInvoiceOverviewKey(BaseModel):
    key: str = Field(min_length=1, max_length=300)
    bill_type: str = Field(pattern="^(rd|channel)$")
    bill_id: str = Field(min_length=1, max_length=100)


class BillInvoiceOverviewRequest(BaseModel):
    keys: list[BillInvoiceOverviewKey] = Field(default_factory=list, max_length=200)


def _num(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _normalize(value: object) -> str:
    return str(value or "").strip().lower()


def _invoice_gross(invoice: InvoiceRecord) -> float:
    gross = float(invoice.amount_with_tax or 0)
    return gross if abs(gross) > 0.005 else float(invoice.invoice_amount or 0) + float(invoice.tax_amount or 0)


def _invoice_allocatable(invoice: InvoiceRecord) -> bool:
    return (invoice.tax_status or "normal") not in {"red", "void"} and invoice.status != "作废"


def _coverage_status(allocated: float, bill_amount: float) -> str:
    if bill_amount <= 0.01 or allocated <= 0.01:
        return "none"
    if allocated + 0.01 < bill_amount:
        return "partial"
    if allocated > bill_amount + 0.01:
        return "over"
    return "complete"


@router.post("/bill360-quicksdk-summary")
def bill360_quicksdk_summary(
    payload: Bill360QuickSdkRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Return all QuickSDK game/month summaries for one Bill360 in one query."""
    keys = []
    seen = set()
    for raw in payload.keys[:40]:
        key = str(raw.key or "").strip()
        month = str(raw.settlement_month or "").strip()
        game = str(raw.game_name or "").strip()
        signature = (key, month, game)
        if not key or not month or not game or signature in seen:
            continue
        seen.add(signature)
        keys.append({"key": key, "month": month, "game": game, "game_norm": game.lower()})

    if not keys:
        return {"items": []}

    conditions = [
        and_(
            QuickSdkFlow.settlement_month == item["month"],
            QuickSdkFlow.game_name.ilike(f"%{item['game']}%"),
        )
        for item in keys
    ]
    rows = db.execute(
        select(
            QuickSdkFlow.settlement_month,
            QuickSdkFlow.game_name,
            QuickSdkFlow.channel_name,
            QuickSdkFlow.gross_flow,
        ).where(or_(*conditions))
    ).all()

    grouped = {
        item["key"]: {
            "key": item["key"],
            "settlement_month": item["month"],
            "game_name": item["game"],
            "row_count": 0,
            "total_flow": 0.0,
            "channels": defaultdict(float),
            "source_games": set(),
        }
        for item in keys
    }

    keys_by_month: dict[str, list[dict]] = defaultdict(list)
    for item in keys:
        keys_by_month[item["month"]].append(item)

    for month, source_game, channel_name, gross_flow in rows:
        source_text = str(source_game or "").strip()
        source_norm = _normalize(source_text)
        if not source_norm:
            continue
        for item in keys_by_month.get(str(month or ""), []):
            if item["game_norm"] not in source_norm:
                continue
            target = grouped[item["key"]]
            flow = _num(gross_flow)
            target["row_count"] += 1
            target["total_flow"] += flow
            target["source_games"].add(source_text)
            channel = str(channel_name or "").strip()
            if channel:
                target["channels"][channel] += flow

    items = []
    for item in keys:
        target = grouped[item["key"]]
        channel_totals = target["channels"]
        top_channel = None
        top_channel_flow = 0.0
        if channel_totals:
            top_channel, top_channel_flow = max(channel_totals.items(), key=lambda pair: pair[1])
        items.append(
            {
                "key": target["key"],
                "settlement_month": target["settlement_month"],
                "game_name": target["game_name"],
                "row_count": int(target["row_count"]),
                "channel_count": len(channel_totals),
                "source_game_count": len(target["source_games"]),
                "total_flow": round(float(target["total_flow"]), 2),
                "top_channel": top_channel,
                "top_channel_flow": round(float(top_channel_flow), 2),
            }
        )

    return {"items": items}


@router.post("/bill-invoice-overviews")
def bill_invoice_overviews(
    payload: BillInvoiceOverviewRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Return invoice coverage for many bills without loading invoice candidates.

    The detail allocation endpoint intentionally performs candidate matching. List
    pages only need coverage, so calling the detail endpoint per row is an N+1
    pattern. This endpoint preserves the same effective-allocation semantics while
    reading the visible bill set in a small fixed number of queries.
    """
    refs = []
    seen = set()
    for raw in payload.keys[:200]:
        key = str(raw.key or "").strip()
        bill_type = str(raw.bill_type or "").strip()
        bill_id = str(raw.bill_id or "").strip()
        signature = (bill_type, bill_id)
        if not key or not bill_id or signature in seen:
            continue
        seen.add(signature)
        refs.append({"key": key, "bill_type": bill_type, "bill_id": bill_id})
    if not refs:
        return {"items": []}

    ids_by_type: dict[str, list[str]] = defaultdict(list)
    for item in refs:
        ids_by_type[item["bill_type"]].append(item["bill_id"])

    bills: dict[tuple[str, str], object] = {}
    rd_ids = ids_by_type.get("rd", [])
    if rd_ids:
        for row in db.execute(
            select(ReconciliationRecord).where(ReconciliationRecord.id.in_(rd_ids))
        ).scalars().all():
            bills[("rd", str(row.id))] = row
    channel_ids = ids_by_type.get("channel", [])
    if channel_ids:
        for row in db.execute(
            select(ChannelRecord).where(ChannelRecord.id.in_(channel_ids))
        ).scalars().all():
            bills[("channel", str(row.id))] = row

    allocation_conditions = []
    if rd_ids:
        allocation_conditions.append(and_(
            BillInvoiceAllocation.bill_type == "rd",
            BillInvoiceAllocation.bill_id.in_(rd_ids),
        ))
    if channel_ids:
        allocation_conditions.append(and_(
            BillInvoiceAllocation.bill_type == "channel",
            BillInvoiceAllocation.bill_id.in_(channel_ids),
        ))
    allocation_rows = db.execute(
        select(BillInvoiceAllocation).where(
            BillInvoiceAllocation.status.in_(ACTIVE_INVOICE_ALLOCATION_STATUSES),
            or_(*allocation_conditions),
        )
    ).scalars().all() if allocation_conditions else []

    invoice_ids = list({row.invoice_id for row in allocation_rows})
    invoices = {
        invoice.id: invoice
        for invoice in db.execute(
            select(InvoiceRecord).where(InvoiceRecord.id.in_(invoice_ids))
        ).scalars().all()
    } if invoice_ids else {}
    red_totals = {
        original_id: float(total or 0)
        for original_id, total in db.execute(
            select(
                InvoiceRecord.original_invoice_id,
                func.coalesce(func.sum(func.abs(InvoiceRecord.amount_with_tax)), 0),
            ).where(
                InvoiceRecord.original_invoice_id.in_(invoice_ids),
                InvoiceRecord.tax_status == "red",
            ).group_by(InvoiceRecord.original_invoice_id)
        ).all()
        if original_id
    } if invoice_ids else {}

    allocated_by_bill: dict[tuple[str, str], float] = defaultdict(float)
    allocation_count_by_bill: dict[tuple[str, str], int] = defaultdict(int)
    for allocation in allocation_rows:
        invoice = invoices.get(allocation.invoice_id)
        if invoice is None or not _invoice_allocatable(invoice):
            continue
        invoice_gross = abs(_invoice_gross(invoice))
        red_ratio = min(1.0, red_totals.get(invoice.id, 0) / invoice_gross) if invoice_gross else 0
        bill_key = (str(allocation.bill_type), str(allocation.bill_id))
        allocated_by_bill[bill_key] += float(allocation.allocated_gross_amount or 0) * (1 - red_ratio)
        allocation_count_by_bill[bill_key] += 1

    items = []
    for ref in refs:
        bill_key = (ref["bill_type"], ref["bill_id"])
        bill = bills.get(bill_key)
        if bill is None:
            continue
        bill_amount = round(abs(float(getattr(bill, "settlement_amount", 0) or 0)), 2)
        allocated = round(float(allocated_by_bill.get(bill_key, 0)), 2)
        remaining = round(max(0, bill_amount - allocated), 2)
        coverage_percent = allocated / bill_amount * 100 if bill_amount > 0 else 0
        items.append({
            "key": ref["key"],
            "bill_type": ref["bill_type"],
            "bill_id": ref["bill_id"],
            "bill_amount": bill_amount,
            "allocated_amount": allocated,
            "remaining_amount": remaining,
            "coverage_percent": round(min(999.9, coverage_percent), 1),
            "coverage_status": _coverage_status(allocated, bill_amount),
            "allocation_count": int(allocation_count_by_bill.get(bill_key, 0)),
        })
    return {"items": items}
