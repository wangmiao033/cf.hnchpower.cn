"""异常中心所需的轻量聚合与智能风险分析接口。"""

from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.channel import ChannelRecord
from app.models.invoice import InvoiceRecord
from app.models.reconciliation import ReconciliationRecord
from app.schemas.anomaly import BillInvoiceOverview
from app.schemas.anomaly_ai import AnomalyAiAnalysisRequest, AnomalyAiAnalysisResponse
from app.services.anomaly_ai import analyze_with_database
from app.services.data_consistency import build_data_consistency_audit

router = APIRouter()
ACTIVE_STATUSES = ("suggested", "confirmed")


def _parse_bill_refs(raw: str) -> list[tuple[str, str]]:
    refs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for part in str(raw or "").split(","):
        bill_type, separator, bill_id = part.strip().partition(":")
        key = (bill_type.strip(), bill_id.strip())
        if not separator or key[0] not in {"rd", "channel"} or not key[1] or key in seen:
            continue
        refs.append(key)
        seen.add(key)
        if len(refs) >= 500:
            break
    return refs


def _invoice_gross(invoice: InvoiceRecord) -> float:
    gross = float(invoice.amount_with_tax or 0)
    return gross if gross != 0 else float(invoice.invoice_amount or 0) + float(invoice.tax_amount or 0)


def _is_invoice_allocatable(invoice: InvoiceRecord) -> bool:
    tax_status = str(invoice.tax_status or "normal").strip().lower()
    return tax_status not in {"red", "void"} and invoice.status != "作废"


def _coverage_status(allocated: float, bill_amount: float) -> str:
    if allocated <= 0.01:
        return "none"
    if allocated + 0.01 < bill_amount:
        return "partial"
    if allocated > bill_amount + 0.01:
        return "over"
    return "complete"


@router.get("/bill-invoices", response_model=list[BillInvoiceOverview])
def list_bill_invoice_overviews(
    bill_refs: str = Query("", max_length=30000),
    db: Session = Depends(get_db),
) -> list[BillInvoiceOverview]:
    refs = _parse_bill_refs(bill_refs)
    if not refs:
        return []

    rd_ids = [bill_id for bill_type, bill_id in refs if bill_type == "rd"]
    channel_ids = [bill_id for bill_type, bill_id in refs if bill_type == "channel"]
    bill_amounts: dict[tuple[str, str], float] = {}

    if rd_ids:
        for row in db.execute(
            select(ReconciliationRecord).where(ReconciliationRecord.id.in_(rd_ids))
        ).scalars().all():
            bill_amounts[("rd", str(row.id))] = round(abs(float(row.settlement_amount or 0)), 2)

    if channel_ids:
        for row in db.execute(
            select(ChannelRecord).where(ChannelRecord.id.in_(channel_ids))
        ).scalars().all():
            bill_amounts[("channel", str(row.id))] = round(abs(float(row.settlement_amount or 0)), 2)

    predicates = []
    if rd_ids:
        predicates.append(
            and_(
                BillInvoiceAllocation.bill_type == "rd",
                BillInvoiceAllocation.bill_id.in_(rd_ids),
            )
        )
    if channel_ids:
        predicates.append(
            and_(
                BillInvoiceAllocation.bill_type == "channel",
                BillInvoiceAllocation.bill_id.in_(channel_ids),
            )
        )

    allocation_rows = (
        db.execute(
            select(BillInvoiceAllocation).where(
                or_(*predicates),
                BillInvoiceAllocation.status.in_(ACTIVE_STATUSES),
            )
        ).scalars().all()
        if predicates
        else []
    )

    invoice_ids = list({row.invoice_id for row in allocation_rows})
    invoices = (
        {
            str(invoice.id): invoice
            for invoice in db.execute(
                select(InvoiceRecord).where(InvoiceRecord.id.in_(invoice_ids))
            ).scalars().all()
        }
        if invoice_ids
        else {}
    )

    red_totals = (
        {
            str(original_id): float(total or 0)
            for original_id, total in db.execute(
                select(
                    InvoiceRecord.original_invoice_id,
                    func.coalesce(func.sum(func.abs(InvoiceRecord.amount_with_tax)), 0),
                ).where(
                    InvoiceRecord.original_invoice_id.in_(invoice_ids),
                    InvoiceRecord.tax_status == "red",
                ).group_by(InvoiceRecord.original_invoice_id)
            ).all()
        }
        if invoice_ids
        else {}
    )

    allocated_by_bill: dict[tuple[str, str], float] = defaultdict(float)
    count_by_bill: dict[tuple[str, str], int] = defaultdict(int)
    for row in allocation_rows:
        invoice = invoices.get(str(row.invoice_id))
        if invoice is None or not _is_invoice_allocatable(invoice):
            continue
        invoice_gross = abs(_invoice_gross(invoice))
        red_ratio = min(1.0, red_totals.get(str(invoice.id), 0) / invoice_gross) if invoice_gross else 0
        key = (str(row.bill_type), str(row.bill_id))
        allocated_by_bill[key] += float(row.allocated_gross_amount or 0) * (1 - red_ratio)
        count_by_bill[key] += 1

    items: list[BillInvoiceOverview] = []
    for key in refs:
        if key not in bill_amounts:
            continue
        bill_amount = bill_amounts[key]
        allocated = round(allocated_by_bill.get(key, 0), 2)
        remaining = round(max(0, bill_amount - allocated), 2)
        percent = allocated / bill_amount * 100 if bill_amount > 0 else 0
        items.append(
            BillInvoiceOverview(
                bill_type=key[0],
                bill_id=key[1],
                bill_amount=bill_amount,
                allocated_amount=allocated,
                remaining_amount=remaining,
                coverage_percent=round(min(999.9, percent), 1),
                coverage_status=_coverage_status(allocated, bill_amount),
                allocation_count=count_by_bill.get(key, 0),
            )
        )
    return items


@router.get("/consistency-audit")
def get_consistency_audit(
    limit: int = Query(default=500, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> dict:
    """只读巡检账单、发票、银行核销和归档之间的数据一致性。"""
    return build_data_consistency_audit(db, limit=limit)


@router.post("/ai-analysis", response_model=AnomalyAiAnalysisResponse)
def analyze_anomaly_risks(
    payload: AnomalyAiAnalysisRequest,
    db: Session = Depends(get_db),
) -> AnomalyAiAnalysisResponse:
    """根据当前巡检异常 + 银行核销 + 利润信号生成可解释风险分析。"""
    return AnomalyAiAnalysisResponse.model_validate(
        analyze_with_database(db, payload.items)
    )