"""账单生命周期、状态流转与财务字段锁定规则。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.channel import ChannelRecord
from app.models.invoice import InvoiceRecord
from app.models.operation_log import OperationLog
from app.models.reconciliation import ReconciliationRecord
from app.models.user import AuthUser
from app.services.rd_bank_payment_aggregate import (
    aggregate_rd_payments_for_ids,
    fill_payable_for_row,
)

ACTIVE_ALLOCATION_STATUSES = ("suggested", "confirmed")
EDITABLE_STATUSES = {"draft", "pending"}
FINAL_STATUSES = {"completed", "settled", "reconciled", "verified"}
LOCKED_STATUSES = {
    "confirmed",
    "invoiced",
    "completed",
    "settled",
    "reconciled",
    "verified",
    "cancelled",
    "canceled",
}

STATUS_LABELS = {
    "draft": "草稿",
    "pending": "待核对",
    "confirmed": "已核对",
    "invoiced": "发票已齐",
    "completed": "已完成",
    "settled": "已结算",
    "reconciled": "已核销",
    "verified": "已核销",
    "cancelled": "已取消",
    "canceled": "已取消",
}

BASE_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "draft": ("pending", "cancelled"),
    "pending": ("confirmed", "cancelled"),
    "confirmed": ("invoiced", "completed", "pending", "cancelled"),
    "invoiced": ("completed", "pending", "cancelled"),
    "completed": ("reconciled", "pending"),
    "settled": ("reconciled", "pending"),
    "reconciled": ("pending",),
    "verified": ("pending",),
    "cancelled": ("pending",),
    "canceled": ("pending",),
}

FINANCIAL_UPDATE_FIELDS = {
    "rd": {
        "statement_no",
        "settlement_month",
        "partner_id",
        "partner_name",
        "game_name",
        "game_flow",
        "test_cost",
        "voucher_cost",
        "channel_fee_rate",
        "tax_rate",
        "revenue_share_rate",
        "discount_value",
        "refund_amount",
        "settlement_amount",
        "items",
    },
    "channel": {
        "statement_no",
        "channel_name",
        "partner_name",
        "settlement_month",
        "start_date",
        "end_date",
        "server_cost",
        "discount_type",
        "channel_fee_rate",
        "dev_share_rate",
        "profit_rate",
        "items",
    },
}


@dataclass
class BillFinancialState:
    bill_amount: float
    paid_amount: float
    payment_phase: str
    payment_label: str
    invoice_amount: float
    invoice_allocated: float
    invoice_remaining: float
    invoice_coverage_status: str
    invoice_coverage_percent: float


def normalize_status(value: str | None) -> str:
    raw = str(value or "pending").strip().lower()
    return raw or "pending"


def status_label(value: str | None) -> str:
    normalized = normalize_status(value)
    return STATUS_LABELS.get(normalized, normalized)


def is_financially_locked(value: str | None) -> bool:
    return normalize_status(value) not in EDITABLE_STATUSES


def is_final_status(value: str | None) -> bool:
    return normalize_status(value) in FINAL_STATUSES


def assert_update_allowed(bill_type: str, current_status: str | None, data: dict) -> dict:
    """Block direct status changes and business-field edits once a bill is locked."""
    normalized = normalize_status(current_status)
    cleaned = dict(data)
    if "status" in cleaned:
        requested = normalize_status(cleaned.get("status"))
        if requested != normalized:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "use_status_transition",
                    "message": "账单状态必须通过状态流转操作修改。",
                    "current_status": normalized,
                    "requested_status": requested,
                },
            )
        cleaned.pop("status", None)

    if is_financially_locked(normalized):
        protected = FINANCIAL_UPDATE_FIELDS.get(bill_type, set())
        touched = sorted(key for key in cleaned if key in protected)
        if touched:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "bill_locked",
                    "message": "账单已核对并锁定。需要修改金额或业务字段时，请先退回“待核对”。",
                    "status": normalized,
                    "locked_fields": touched,
                },
            )
    return cleaned


def assert_delete_allowed(current_status: str | None) -> None:
    normalized = normalize_status(current_status)
    if normalized not in EDITABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "bill_locked",
                "message": "已核对、已结算或已取消的账单不能直接删除，请通过状态流转处理。",
                "status": normalized,
            },
        )


def _invoice_gross(invoice: InvoiceRecord) -> float:
    gross = float(invoice.amount_with_tax or 0)
    return gross if abs(gross) > 0.005 else float(invoice.invoice_amount or 0) + float(invoice.tax_amount or 0)


def _effective_invoice_allocation(db: Session, bill_type: str, bill_id: str) -> float:
    rows = db.execute(
        select(BillInvoiceAllocation).where(
            BillInvoiceAllocation.bill_type == bill_type,
            BillInvoiceAllocation.bill_id == bill_id,
            BillInvoiceAllocation.status.in_(ACTIVE_ALLOCATION_STATUSES),
        )
    ).scalars().all()
    if not rows:
        return 0.0

    invoice_ids = list({row.invoice_id for row in rows})
    invoices = {
        row.id: row
        for row in db.execute(
            select(InvoiceRecord).where(InvoiceRecord.id.in_(invoice_ids))
        ).scalars().all()
    }
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
    }

    allocated = 0.0
    for allocation in rows:
        invoice = invoices.get(allocation.invoice_id)
        if invoice is None:
            continue
        if (invoice.tax_status or "normal") in {"red", "void"} or invoice.status == "作废":
            continue
        invoice_gross = abs(_invoice_gross(invoice))
        red_ratio = min(1.0, red_totals.get(invoice.id, 0) / invoice_gross) if invoice_gross else 0
        allocated += float(allocation.allocated_gross_amount or 0) * (1 - red_ratio)
    return round(allocated, 2)


def _coverage_status(allocated: float, bill_amount: float) -> str:
    if bill_amount <= 0.01:
        return "none"
    if allocated <= 0.01:
        return "none"
    if allocated + 0.01 < bill_amount:
        return "partial"
    if allocated > bill_amount + 0.01:
        return "over"
    return "complete"


def bill_financial_state(db: Session, bill_type: str, bill) -> BillFinancialState:
    bill_amount = round(abs(float(getattr(bill, "settlement_amount", 0) or 0)), 2)
    allocated = _effective_invoice_allocation(db, bill_type, str(bill.id))
    remaining = round(max(0, bill_amount - allocated), 2)
    coverage = _coverage_status(allocated, bill_amount)
    coverage_percent = round(min(999.9, allocated / bill_amount * 100), 1) if bill_amount > 0 else 0

    if bill_type == "rd":
        aggregate = aggregate_rd_payments_for_ids(db, [str(bill.id)]).get(str(bill.id))
        payment = fill_payable_for_row(aggregate, bill_amount)
        paid = round(float(payment.paid_amount), 2)
        if paid <= 0.01:
            phase = "unpaid"
        elif paid + 0.01 < bill_amount:
            phase = "partial"
        else:
            phase = "paid"
        label = {"unpaid": "未付款", "partial": "部分付款", "paid": "已付款"}[phase]
    else:
        paid = round(abs(float(getattr(bill, "received_amount", 0) or 0)), 2)
        if paid <= 0.01:
            phase = "unpaid"
        elif paid + 0.01 < bill_amount:
            phase = "partial"
        else:
            phase = "paid"
        label = {"unpaid": "未收款", "partial": "部分收款", "paid": "已收款"}[phase]

    return BillFinancialState(
        bill_amount=bill_amount,
        paid_amount=paid,
        payment_phase=phase,
        payment_label=label,
        invoice_amount=bill_amount,
        invoice_allocated=allocated,
        invoice_remaining=remaining,
        invoice_coverage_status=coverage,
        invoice_coverage_percent=coverage_percent,
    )


def _base_bill_is_complete(bill_type: str, bill) -> tuple[bool, str | None]:
    if abs(float(getattr(bill, "settlement_amount", 0) or 0)) <= 0.01:
        return False, "结算金额必须大于 0 才能完成核对。"
    if not str(getattr(bill, "settlement_month", None) or "").strip():
        return False, "请先补齐结算月份。"
    partner = (
        getattr(bill, "partner_name", None)
        or (getattr(bill, "channel_name", None) if bill_type == "channel" else None)
    )
    if not str(partner or "").strip():
        return False, "请先补齐合作方。"
    return True, None


def _transition_requires_reason(current: str, target: str) -> bool:
    if target == "cancelled":
        return True
    if target == "pending" and current != "draft":
        return True
    return False


def _transition_guard(
    db: Session,
    bill_type: str,
    bill,
    current: str,
    target: str,
    user: AuthUser,
) -> str | None:
    allowed = BASE_TRANSITIONS.get(current, ())
    if target not in allowed:
        return f"不能从“{status_label(current)}”直接流转到“{status_label(target)}”。"

    if target == "confirmed":
        ok, reason = _base_bill_is_complete(bill_type, bill)
        return None if ok else reason

    financial = bill_financial_state(db, bill_type, bill)

    if target == "invoiced":
        if financial.invoice_coverage_status == "over":
            return "发票分配金额超过账单金额，请先修正发票关联。"
        if financial.invoice_coverage_status != "complete":
            return f"发票尚未覆盖完整账单，当前覆盖 {financial.invoice_coverage_percent:.1f}%。"

    if target in {"completed", "reconciled"}:
        if target == "completed":
            if financial.invoice_coverage_status == "over":
                return "发票分配金额超过账单金额，请先修正发票关联。"
            if financial.invoice_coverage_status != "complete":
                return "账单发票尚未完整覆盖，不能完成结算。"
            if financial.paid_amount > financial.bill_amount + 0.01:
                return f"{financial.payment_label}金额超过账单金额，请先处理超额资金。"
            if financial.payment_phase != "paid":
                return f"资金尚未结清，当前状态为“{financial.payment_label}”。"
        elif current not in {"completed", "settled"}:
            return "只有已完成或已结算的账单才能核销归档。"

    if target == "pending" and current in FINAL_STATUSES and user.role != "admin":
        return "最终状态账单仅管理员可以重新打开。"

    return None


def build_lifecycle_snapshot(db: Session, bill_type: str, bill, user: AuthUser) -> dict:
    current = normalize_status(getattr(bill, "status", None))
    financial = bill_financial_state(db, bill_type, bill)
    options = []
    for target in BASE_TRANSITIONS.get(current, ()):
        blocked_reason = _transition_guard(db, bill_type, bill, current, target, user)
        options.append(
            {
                "status": target,
                "label": transition_label(bill_type, current, target),
                "available": blocked_reason is None,
                "blocked_reason": blocked_reason,
                "requires_reason": _transition_requires_reason(current, target),
                "danger": target in {"cancelled", "pending"} and current not in {"draft", "pending"},
            }
        )
    return {
        "bill_type": bill_type,
        "bill_id": str(bill.id),
        "status": current,
        "status_label": status_label(current),
        "locked": is_financially_locked(current),
        "final": is_final_status(current),
        "payment_phase": financial.payment_phase,
        "payment_label": financial.payment_label,
        "bill_amount": financial.bill_amount,
        "paid_amount": financial.paid_amount,
        "invoice_coverage_status": financial.invoice_coverage_status,
        "invoice_coverage_percent": financial.invoice_coverage_percent,
        "invoice_allocated_amount": financial.invoice_allocated,
        "invoice_remaining_amount": financial.invoice_remaining,
        "transitions": options,
    }


def transition_label(bill_type: str, current: str, target: str) -> str:
    if target == "pending":
        return "重新打开" if current in FINAL_STATUSES or current in {"cancelled", "canceled"} else "退回待核对"
    if target == "confirmed":
        return "完成核对"
    if target == "invoiced":
        return "发票已收齐" if bill_type == "rd" else "发票已开齐"
    if target == "completed":
        return "确认结清"
    if target == "reconciled":
        return "核销归档"
    if target == "cancelled":
        return "取消账单"
    return status_label(target)


def transition_bill(
    db: Session,
    bill_type: str,
    bill,
    target_status: str,
    reason: str | None,
    user: AuthUser,
) -> dict:
    current = normalize_status(getattr(bill, "status", None))
    target = normalize_status(target_status)
    blocked_reason = _transition_guard(db, bill_type, bill, current, target, user)
    if blocked_reason:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "transition_blocked",
                "message": blocked_reason,
                "current_status": current,
                "target_status": target,
            },
        )

    normalized_reason = str(reason or "").strip()
    if _transition_requires_reason(current, target) and len(normalized_reason) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": "transition_reason_required",
                "message": "该状态流转需要填写原因。",
            },
        )

    bill.status = target
    if hasattr(bill, "updated_at"):
        bill.updated_at = datetime.now(timezone.utc)
    db.flush()

    # 状态 UPDATE 触发器已写入审计日志；把本次流转原因补到同一条最新状态日志中。
    if normalized_reason:
        latest = db.execute(
            select(OperationLog)
            .where(
                OperationLog.entity_type == bill_type,
                OperationLog.entity_id == str(bill.id),
                OperationLog.action == "status_change",
            )
            .order_by(OperationLog.created_at.desc())
            .limit(1)
        ).scalars().first()
        if latest is not None:
            metadata = dict(latest.metadata_json or {})
            metadata["reason"] = normalized_reason
            metadata["from_status"] = current
            metadata["to_status"] = target
            latest.metadata_json = metadata
            latest.summary = f"{status_label(current)} → {status_label(target)}"

    db.commit()
    db.refresh(bill)
    return build_lifecycle_snapshot(db, bill_type, bill, user)


def load_bill(db: Session, bill_type: str, bill_id: str):
    if bill_type == "rd":
        bill = db.get(ReconciliationRecord, bill_id)
    elif bill_type == "channel":
        bill = db.get(ChannelRecord, bill_id)
    else:
        raise HTTPException(status_code=422, detail={"error": "invalid_bill_type"})
    if bill is None:
        raise HTTPException(status_code=404, detail={"error": "bill_not_found", "id": bill_id})
    return bill
