"""Finance-task helpers for cumulative channel settlement batches."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.channel import ChannelRecord
from app.models.finance_invoice_task import FinanceInvoiceTask
from app.models.invoice import InvoiceRecord
from app.models.user import AuthUser
from app.services.channel_cumulative_batch import batch_by_id, bill_condition

EPS = 0.01
ACTIVE_ALLOCATION_STATUSES = ("suggested", "confirmed")


def _invoice_gross(invoice: InvoiceRecord) -> float:
    gross = float(invoice.amount_with_tax or 0)
    return abs(gross if gross != 0 else float(invoice.invoice_amount or 0) + float(invoice.tax_amount or 0))


def _allocated_to_bill(db: Session, bill_id: str) -> float:
    value = db.execute(
        select(func.coalesce(func.sum(BillInvoiceAllocation.allocated_gross_amount), 0)).where(
            BillInvoiceAllocation.bill_type == "channel",
            BillInvoiceAllocation.bill_id == str(bill_id),
            BillInvoiceAllocation.status.in_(ACTIVE_ALLOCATION_STATUSES),
        )
    ).scalar_one()
    return float(value or 0)


def assert_single_bill_invoice_allowed(db: Session, bill: ChannelRecord) -> None:
    condition = bill_condition(db, bill)
    state = str(condition.get("state") or "normal")
    if condition.get("deferred"):
        pool = condition.get("pool") or {}
        policy = condition.get("policy") or {}
        threshold = float(policy.get("threshold_amount") or 0)
        if pool.get("ready"):
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "cumulative_batch_required",
                    "message": f"该合作方累计金额已达到 ¥{threshold:.2f} 门槛，请先生成累计结算批次后统一提交开票。",
                },
            )
        raise HTTPException(
            status_code=409,
            detail={
                "error": "cumulative_settlement_deferred",
                "message": (
                    f"该账单已核对并进入累计结算池，当前累计 ¥{float(pool.get('basis_total') or 0):.2f} / ¥{threshold:.2f}，"
                    f"还差 ¥{float(pool.get('remaining_to_threshold') or 0):.2f}；未达门槛前无需开票。"
                ),
            },
        )
    if state == "batched":
        batch = condition.get("batch") or {}
        raise HTTPException(
            status_code=409,
            detail={
                "error": "cumulative_batch_invoice_only",
                "message": f"该账单已属于累计结算批次 {batch.get('batch_no') or ''}，请通过累计批次统一提交开票。",
            },
        )


def reject_cumulative_task(db: Session, task: FinanceInvoiceTask) -> None:
    if str(task.source_kind or "bill") != "cumulative_batch" or not task.cumulative_batch_id:
        return
    batch = batch_by_id(db, str(task.cumulative_batch_id))
    if str(batch.status or "") not in {"invoiced", "settled", "cancelled"}:
        batch.status = "ready"
        batch.invoice_task_id = None
        batch.updated_at = datetime.now(timezone.utc)
        db.flush()


def complete_cumulative_task(
    db: Session,
    task: FinanceInvoiceTask,
    invoice: InvoiceRecord,
    *,
    invoice_allocated_before: float,
    requested_amount: float | None,
    user: AuthUser,
) -> float:
    if str(task.source_kind or "bill") != "cumulative_batch" or not task.cumulative_batch_id:
        raise HTTPException(status_code=422, detail="当前任务不是累计结算任务")
    batch = batch_by_id(db, str(task.cumulative_batch_id))
    if str(batch.status or "") == "cancelled":
        raise HTTPException(status_code=409, detail="累计结算批次已经取消")

    active_items = [item for item in (batch.items or []) if item.released_at is None]
    if not active_items:
        raise HTTPException(status_code=409, detail="累计结算批次没有可开票账单")

    bill_rows: list[tuple[ChannelRecord, float]] = []
    total_needed = 0.0
    for item in active_items:
        bill = db.get(ChannelRecord, str(item.bill_id))
        if bill is None:
            raise HTTPException(status_code=404, detail=f"累计批次中的渠道账单 {item.bill_id} 不存在")
        bill_amount = abs(float(bill.settlement_amount or 0))
        remaining = round(max(0.0, bill_amount - _allocated_to_bill(db, str(bill.id))), 2)
        if remaining > EPS:
            bill_rows.append((bill, remaining))
            total_needed += remaining
    total_needed = round(total_needed, 2)
    if total_needed <= EPS:
        return 0.0

    if requested_amount is not None and float(requested_amount) + EPS < total_needed:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "cumulative_partial_invoice_not_supported",
                "message": f"累计批次本次需要完整开票 ¥{total_needed:.2f}，不能以较小金额直接完成批次。",
            },
        )

    invoice_gross = _invoice_gross(invoice)
    invoice_remaining = round(max(0.0, invoice_gross - float(invoice_allocated_before or 0)), 2)
    if invoice_remaining + EPS < total_needed:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "invoice_insufficient_for_cumulative_batch",
                "message": f"该发票剩余可分配 ¥{invoice_remaining:.2f}，不足以覆盖累计批次 ¥{total_needed:.2f}。",
            },
        )

    now = datetime.now(timezone.utc)
    for bill, amount in bill_rows:
        ratio = amount / invoice_gross if invoice_gross > 0 else 0
        db.add(
            BillInvoiceAllocation(
                id=str(uuid4()),
                bill_type="channel",
                bill_id=str(bill.id),
                invoice_id=str(invoice.id),
                allocated_net_amount=round(abs(float(invoice.invoice_amount or 0)) * ratio, 2),
                allocated_tax_amount=round(abs(float(invoice.tax_amount or 0)) * ratio, 2),
                allocated_gross_amount=amount,
                status="confirmed",
                match_type="cumulative_finance_task",
                match_score=1,
                match_reasons=[f"累计结算批次 {batch.batch_no} 完成自动分配"],
                confirmed_by=str(user.email or user.id),
                confirmed_at=now,
            )
        )
    batch.status = "invoiced"
    batch.invoice_id = str(invoice.id)
    batch.invoiced_at = now
    batch.updated_at = now
    db.flush()
    return total_needed
