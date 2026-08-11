"""Finance workbench invoice task workflow."""

from __future__ import annotations

from datetime import datetime, timezone
import re
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.channel import ChannelRecord
from app.models.finance_invoice_task import FinanceInvoiceTask
from app.models.invoice import InvoiceRecord
from app.models.user import AuthUser
from app.schemas.finance_invoice_task import (
    FinanceInvoiceTaskCompleteRequest,
    FinanceInvoiceTaskListResponse,
    FinanceInvoiceTaskRead,
    FinanceInvoiceTaskRejectRequest,
    FinanceInvoiceTaskStatusItem,
    FinanceInvoiceTaskStatusResponse,
    FinanceInvoiceTaskSummary,
)
from app.services.channel_cumulative_invoice import (
    assert_single_bill_invoice_allowed,
    complete_cumulative_task,
    reject_cumulative_task,
)
from app.services.permissions import require_permission

router = APIRouter()
ACTIVE_ALLOCATION_STATUSES = ("suggested", "confirmed")
ACTIVE_TASK_STATUSES = ("pending", "processing")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _actor_name(user: AuthUser) -> str:
    return str(user.display_name or user.email or user.id)


def _invoice_gross(invoice: InvoiceRecord) -> float:
    gross = float(invoice.amount_with_tax or 0)
    return abs(gross if gross != 0 else float(invoice.invoice_amount or 0) + float(invoice.tax_amount or 0))


def _company_key(value: str | None) -> str:
    normalized = re.sub(r"[\s\W_]+", "", str(value or "").lower())
    for suffix in ("有限责任公司", "股份有限公司", "有限公司"):
        if normalized.endswith(suffix):
            normalized = normalized[: -len(suffix)]
            break
    return normalized


def _allocated_to_bill(db: Session, bill_type: str, bill_id: str) -> float:
    value = db.execute(
        select(func.coalesce(func.sum(BillInvoiceAllocation.allocated_gross_amount), 0)).where(
            BillInvoiceAllocation.bill_type == bill_type,
            BillInvoiceAllocation.bill_id == bill_id,
            BillInvoiceAllocation.status.in_(ACTIVE_ALLOCATION_STATUSES),
        )
    ).scalar_one()
    return float(value or 0)


def _allocated_from_invoice(db: Session, invoice_id: str) -> float:
    value = db.execute(
        select(func.coalesce(func.sum(BillInvoiceAllocation.allocated_gross_amount), 0)).where(
            BillInvoiceAllocation.invoice_id == invoice_id,
            BillInvoiceAllocation.status.in_(ACTIVE_ALLOCATION_STATUSES),
        )
    ).scalar_one()
    return float(value or 0)


def _task_read(row: FinanceInvoiceTask) -> FinanceInvoiceTaskRead:
    return FinanceInvoiceTaskRead.model_validate(row)


def _load_task(db: Session, task_id: str) -> FinanceInvoiceTask:
    row = db.get(FinanceInvoiceTask, task_id)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "task_not_found", "id": task_id})
    return row


@router.post("/invoice-requests/channel/{bill_id}", response_model=FinanceInvoiceTaskRead)
def submit_channel_invoice_request(
    bill_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("invoice_requests.submit")),
) -> FinanceInvoiceTaskRead:
    bill = db.get(ChannelRecord, bill_id)
    if bill is None:
        raise HTTPException(status_code=404, detail={"error": "bill_not_found", "id": bill_id})
    bill_status = str(bill.status or "pending").strip().lower()
    if bill_status in {"pending", "draft", "cancelled", "canceled", "void", "deleted"}:
        raise HTTPException(status_code=409, detail={"error": "bill_not_confirmed", "message": "渠道账单尚未核对完成，不能提交开票。"})
    if str(getattr(bill, "validation_status", "unvalidated") or "unvalidated") == "fail":
        raise HTTPException(status_code=409, detail={"error": "bill_validation_failed", "message": "平台结算金额校验未通过，不能提交开票。"})
    assert_single_bill_invoice_allowed(db, bill)

    active = db.execute(
        select(FinanceInvoiceTask).where(
            FinanceInvoiceTask.bill_type == "channel",
            FinanceInvoiceTask.bill_id == bill_id,
            FinanceInvoiceTask.source_kind == "bill",
            FinanceInvoiceTask.direction == "output",
            FinanceInvoiceTask.status.in_(ACTIVE_TASK_STATUSES),
        ).order_by(FinanceInvoiceTask.submitted_at.desc())
    ).scalars().first()
    if active is not None:
        return _task_read(active)

    bill_amount = abs(float(bill.settlement_amount or 0))
    remaining = round(max(0, bill_amount - _allocated_to_bill(db, "channel", bill_id)), 2)
    if remaining <= 0.01:
        raise HTTPException(status_code=409, detail={"error": "invoice_fully_covered", "message": "该账单发票已覆盖，无需再次提交开票。"})

    now = _now()
    row = FinanceInvoiceTask(
        id=str(uuid4()),
        task_no=f"FP-{now.strftime('%Y%m%d')}-{uuid4().hex[:6].upper()}",
        bill_type="channel",
        bill_id=bill_id,
        source_kind="bill",
        direction="output",
        status="pending",
        requested_amount=remaining,
        allocated_amount=0,
        bill_number=str(bill.statement_no or bill.id),
        partner_name=str(bill.partner_name or bill.channel_name or ""),
        game_name=str(bill.game_name or ""),
        settlement_month=str(bill.settlement_month or ""),
        submitted_by_id=str(user.id),
        submitted_by_email=str(user.email or ""),
        submitted_by_name=_actor_name(user),
        submitted_at=now,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.execute(
            select(FinanceInvoiceTask).where(
                FinanceInvoiceTask.bill_type == "channel",
                FinanceInvoiceTask.bill_id == bill_id,
                FinanceInvoiceTask.source_kind == "bill",
                FinanceInvoiceTask.direction == "output",
                FinanceInvoiceTask.status.in_(ACTIVE_TASK_STATUSES),
            ).order_by(FinanceInvoiceTask.submitted_at.desc())
        ).scalars().first()
        if existing is not None:
            return _task_read(existing)
        raise
    db.refresh(row)
    return _task_read(row)


@router.get("/invoice-requests/by-bills", response_model=FinanceInvoiceTaskStatusResponse)
def invoice_request_status_by_bills(
    bill_ids: str = Query("", max_length=20000),
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("reconciliation.view")),
) -> FinanceInvoiceTaskStatusResponse:
    ids = list(dict.fromkeys(part.strip() for part in bill_ids.split(",") if part.strip()))[:500]
    if not ids:
        return FinanceInvoiceTaskStatusResponse(items=[])
    rows = db.execute(
        select(FinanceInvoiceTask).where(
            FinanceInvoiceTask.bill_type == "channel",
            FinanceInvoiceTask.bill_id.in_(ids),
            FinanceInvoiceTask.source_kind == "bill",
            FinanceInvoiceTask.direction == "output",
        ).order_by(FinanceInvoiceTask.submitted_at.desc())
    ).scalars().all()
    latest: dict[str, FinanceInvoiceTask] = {}
    for row in rows:
        latest.setdefault(str(row.bill_id), row)
    return FinanceInvoiceTaskStatusResponse(items=[
        FinanceInvoiceTaskStatusItem(
            bill_type=row.bill_type,
            bill_id=row.bill_id,
            task_id=row.id,
            task_no=row.task_no,
            status=row.status,
            requested_amount=float(row.requested_amount or 0),
            allocated_amount=float(row.allocated_amount or 0),
            assigned_to_name=row.assigned_to_name,
            submitted_at=row.submitted_at,
            started_at=row.started_at,
            completed_at=row.completed_at,
            reject_reason=row.reject_reason,
            invoice_id=row.invoice_id,
        )
        for row in latest.values()
    ])


@router.get("/invoice-tasks", response_model=FinanceInvoiceTaskListResponse)
def list_invoice_tasks(
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("finance_tasks.view")),
) -> FinanceInvoiceTaskListResponse:
    stmt = select(FinanceInvoiceTask)
    count_stmt = select(func.count(FinanceInvoiceTask.id))
    if status_filter and status_filter != "all":
        stmt = stmt.where(FinanceInvoiceTask.status == status_filter)
        count_stmt = count_stmt.where(FinanceInvoiceTask.status == status_filter)
    total = int(db.execute(count_stmt).scalar_one() or 0)
    rows = db.execute(stmt.order_by(FinanceInvoiceTask.submitted_at.desc()).limit(limit).offset(offset)).scalars().all()
    return FinanceInvoiceTaskListResponse(items=[_task_read(row) for row in rows], total=total)


@router.get("/invoice-tasks/summary", response_model=FinanceInvoiceTaskSummary)
def invoice_task_summary(
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("finance_tasks.view")),
) -> FinanceInvoiceTaskSummary:
    rows = db.execute(
        select(
            FinanceInvoiceTask.status,
            func.count(FinanceInvoiceTask.id),
            func.coalesce(func.sum(FinanceInvoiceTask.requested_amount), 0),
        ).group_by(FinanceInvoiceTask.status)
    ).all()
    values = {str(row[0]): (int(row[1] or 0), float(row[2] or 0)) for row in rows}
    return FinanceInvoiceTaskSummary(
        pending_count=values.get("pending", (0, 0))[0],
        pending_amount=values.get("pending", (0, 0))[1],
        processing_count=values.get("processing", (0, 0))[0],
        processing_amount=values.get("processing", (0, 0))[1],
        completed_count=values.get("completed", (0, 0))[0],
        completed_amount=values.get("completed", (0, 0))[1],
        rejected_count=values.get("rejected", (0, 0))[0],
        rejected_amount=values.get("rejected", (0, 0))[1],
    )


@router.post("/invoice-tasks/{task_id}/start", response_model=FinanceInvoiceTaskRead)
def start_invoice_task(
    task_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("finance_tasks.manage")),
) -> FinanceInvoiceTaskRead:
    row = _load_task(db, task_id)
    if row.status == "completed":
        raise HTTPException(status_code=409, detail={"error": "task_completed", "message": "该任务已经完成。"})
    if row.status == "rejected":
        raise HTTPException(status_code=409, detail={"error": "task_rejected", "message": "该任务已经驳回，请业务重新提交。"})
    if row.status == "processing" and row.assigned_to_id and row.assigned_to_id != str(user.id):
        raise HTTPException(status_code=409, detail={"error": "task_claimed", "message": f"任务正在由 {row.assigned_to_name or row.assigned_to_email} 处理。"})
    if row.status == "pending":
        row.status = "processing"
        row.started_at = _now()
    row.assigned_to_id = str(user.id)
    row.assigned_to_email = str(user.email or "")
    row.assigned_to_name = _actor_name(user)
    db.commit()
    db.refresh(row)
    return _task_read(row)


@router.post("/invoice-tasks/{task_id}/reject", response_model=FinanceInvoiceTaskRead)
def reject_invoice_task(
    task_id: str,
    payload: FinanceInvoiceTaskRejectRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("finance_tasks.manage")),
) -> FinanceInvoiceTaskRead:
    row = _load_task(db, task_id)
    if row.status == "completed":
        raise HTTPException(status_code=409, detail={"error": "task_completed", "message": "已完成任务不能驳回。"})
    now = _now()
    row.status = "rejected"
    row.reject_reason = payload.reason.strip()
    row.rejected_at = now
    row.assigned_to_id = str(user.id)
    row.assigned_to_email = str(user.email or "")
    row.assigned_to_name = _actor_name(user)
    if row.started_at is None:
        row.started_at = now
    reject_cumulative_task(db, row)
    db.commit()
    db.refresh(row)
    return _task_read(row)


@router.post("/invoice-tasks/{task_id}/complete", response_model=FinanceInvoiceTaskRead)
def complete_invoice_task(
    task_id: str,
    payload: FinanceInvoiceTaskCompleteRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("finance_tasks.manage")),
) -> FinanceInvoiceTaskRead:
    row = _load_task(db, task_id)
    if row.status == "completed":
        return _task_read(row)
    if row.status == "rejected":
        raise HTTPException(status_code=409, detail={"error": "task_rejected", "message": "驳回任务不能直接完成，请业务重新提交。"})

    invoice = db.get(InvoiceRecord, payload.invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail={"error": "invoice_not_found", "id": payload.invoice_id})
    if str(invoice.invoice_direction or "output") != "output":
        raise HTTPException(status_code=409, detail={"error": "invoice_direction_mismatch", "message": "开票任务只能关联销项发票。"})
    if str(invoice.tax_status or "normal") in {"red", "void"} or str(invoice.status or "") == "作废":
        raise HTTPException(status_code=409, detail={"error": "invoice_not_allocatable", "message": "红冲或作废发票不能完成开票任务。"})
    if not str(invoice.digital_invoice_no or invoice.invoice_no or "").strip() or not str(invoice.invoice_date or "").strip():
        raise HTTPException(status_code=409, detail={"error": "invoice_not_issued", "message": "请先录入真实发票号码和开票日期，再完成开票任务。"})
    bill_company = _company_key(row.partner_name)
    invoice_company = _company_key(invoice.buyer_name or invoice.title)
    if bill_company and invoice_company and not (bill_company in invoice_company or invoice_company in bill_company):
        raise HTTPException(status_code=409, detail={"error": "invoice_partner_mismatch", "message": "销项发票购买方与来源账单合作方不一致，请核对后再关联。"})

    if str(row.source_kind or "bill") == "cumulative_batch":
        amount = complete_cumulative_task(
            db,
            row,
            invoice,
            invoice_allocated_before=_allocated_from_invoice(db, invoice.id),
            requested_amount=payload.allocated_amount,
            user=user,
        )
    else:
        bill = db.get(ChannelRecord, row.bill_id) if row.bill_type == "channel" else None
        if bill is None:
            raise HTTPException(status_code=404, detail={"error": "bill_not_found", "id": row.bill_id})
        existing = db.execute(
            select(BillInvoiceAllocation).where(
                BillInvoiceAllocation.bill_type == row.bill_type,
                BillInvoiceAllocation.bill_id == row.bill_id,
                BillInvoiceAllocation.invoice_id == invoice.id,
                BillInvoiceAllocation.status.in_(ACTIVE_ALLOCATION_STATUSES),
            ).order_by(BillInvoiceAllocation.created_at.desc())
        ).scalars().first()
        if existing is not None:
            amount = float(existing.allocated_gross_amount or 0)
        else:
            bill_amount = abs(float(bill.settlement_amount or 0))
            bill_remaining = round(max(0, bill_amount - _allocated_to_bill(db, row.bill_type, row.bill_id)), 2)
            invoice_gross = _invoice_gross(invoice)
            invoice_remaining = round(max(0, invoice_gross - _allocated_from_invoice(db, invoice.id)), 2)
            amount = round(float(payload.allocated_amount or min(float(row.requested_amount or 0), bill_remaining, invoice_remaining)), 2)
            if amount <= 0.01:
                raise HTTPException(status_code=409, detail={"error": "no_allocatable_amount", "message": "当前账单或发票已没有可分配金额。"})
            if amount > bill_remaining + 0.01:
                raise HTTPException(status_code=409, detail={"error": "bill_over_allocation", "message": "本次关联金额超过账单剩余开票金额。"})
            if amount > invoice_remaining + 0.01:
                raise HTTPException(status_code=409, detail={"error": "invoice_over_allocation", "message": "本次关联金额超过发票剩余可分配金额。"})
            ratio = amount / invoice_gross if invoice_gross > 0 else 0
            allocation = BillInvoiceAllocation(
                id=str(uuid4()),
                bill_type=row.bill_type,
                bill_id=row.bill_id,
                invoice_id=invoice.id,
                allocated_net_amount=round(abs(float(invoice.invoice_amount or 0)) * ratio, 2),
                allocated_tax_amount=round(abs(float(invoice.tax_amount or 0)) * ratio, 2),
                allocated_gross_amount=amount,
                status="confirmed",
                match_type="finance_task",
                match_score=1,
                match_reasons=["财务开票任务完成自动关联"],
                confirmed_by=str(user.email or user.id),
                confirmed_at=_now(),
            )
            db.add(allocation)
            db.flush()

    now = _now()
    row.status = "completed"
    row.allocated_amount = amount
    row.invoice_id = invoice.id
    row.completed_at = now
    row.completed_by_id = str(user.id)
    row.completed_by_email = str(user.email or "")
    row.completed_by_name = _actor_name(user)
    row.assigned_to_id = row.assigned_to_id or str(user.id)
    row.assigned_to_email = row.assigned_to_email or str(user.email or "")
    row.assigned_to_name = row.assigned_to_name or _actor_name(user)
    row.started_at = row.started_at or now
    row.remark = payload.remark
    db.commit()
    db.refresh(row)
    return _task_read(row)
