"""发票归档：完整关联后移出日常工作区，财务事实与附件保持不变。"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.invoice import InvoiceRecord
from app.models.operation_log import OperationLog
from app.models.user import AuthUser

ACTIVE_ALLOCATION_STATUSES = ("suggested", "confirmed")
ARCHIVE_TOLERANCE = 0.01


def _invoice_gross(invoice: InvoiceRecord) -> float:
    gross = float(invoice.amount_with_tax or 0)
    if abs(gross) > ARCHIVE_TOLERANCE:
        return abs(gross)
    return abs(float(invoice.invoice_amount or 0) + float(invoice.tax_amount or 0))


def invoice_archive_eligibility_from_values(
    *,
    invoice_amount: float,
    allocated_amount: float,
    tax_status: str | None,
    display_status: str | None,
    red_adjustment_amount: float = 0,
) -> tuple[bool, str]:
    tax = str(tax_status or "normal").strip().lower()
    display = str(display_status or "").strip()
    amount = abs(float(invoice_amount or 0))
    allocated = max(0.0, float(allocated_amount or 0))
    red_amount = abs(float(red_adjustment_amount or 0))

    if tax != "normal" or display == "作废" or "红" in display:
        return False, "发票税务状态异常"
    if amount <= ARCHIVE_TOLERANCE:
        return False, "零金额发票不自动归档"
    if red_amount > ARCHIVE_TOLERANCE:
        return False, "存在红冲记录"
    if allocated > amount + ARCHIVE_TOLERANCE:
        return False, "账单关联金额超额"
    if allocated + ARCHIVE_TOLERANCE < amount:
        return False, "账单关联金额未完整覆盖"
    return True, "完整关联账单，可归档"


def _load_invoice(db: Session, invoice_id: str) -> InvoiceRecord:
    invoice = db.get(InvoiceRecord, invoice_id)
    if invoice is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "invoice_not_found", "message": "发票不存在"},
        )
    return invoice


def _state_row(db: Session, invoice_id: str):
    return db.execute(
        text(
            """
            SELECT invoice_id, is_archived, manual_hold, archive_source,
                   archived_at, unarchived_at, archived_by_user_id, archived_by_email
            FROM invoice_archive_states
            WHERE invoice_id = :invoice_id
            """
        ),
        {"invoice_id": invoice_id},
    ).mappings().first()


def is_invoice_archived(db: Session, invoice_id: str) -> bool:
    state = _state_row(db, invoice_id)
    return bool(state and state["is_archived"])


def _write_archive_log(
    db: Session,
    invoice: InvoiceRecord,
    *,
    action: str,
    source: str,
    reason: str,
    user: AuthUser | None,
) -> None:
    is_archive = action == "archive"
    number = invoice.digital_invoice_no or invoice.invoice_no or invoice.id
    db.add(
        OperationLog(
            id=str(uuid4()),
            entity_type="invoice",
            entity_id=str(invoice.id),
            entity_number=str(number or "") or None,
            action=action,
            summary=("系统自动归档发票" if source == "auto" else "发票已归档") if is_archive else (
                "系统因状态变化恢复发票" if source == "auto" else "发票已取消归档"
            ),
            actor_user_id=str(getattr(user, "id", None) or "") or None,
            actor_email=str(getattr(user, "email", None) or "") or None,
            changes={
                "archive_state": {
                    "before": "未归档" if is_archive else "已归档",
                    "after": "已归档" if is_archive else "未归档",
                }
            },
            metadata_json={
                "archive_source": source,
                "reason": reason,
            },
        )
    )


def _archive_state(
    db: Session,
    invoice: InvoiceRecord,
    *,
    source: str,
    reason: str,
    user: AuthUser | None,
) -> None:
    db.execute(
        text(
            """
            INSERT INTO invoice_archive_states (
              invoice_id, is_archived, manual_hold, archive_source,
              archived_at, unarchived_at, archived_by_user_id, archived_by_email, updated_at
            ) VALUES (
              :invoice_id, TRUE, FALSE, :source,
              NOW(), NULL, :user_id, :email, NOW()
            )
            ON CONFLICT (invoice_id) DO UPDATE SET
              is_archived = TRUE,
              manual_hold = FALSE,
              archive_source = EXCLUDED.archive_source,
              archived_at = NOW(),
              unarchived_at = NULL,
              archived_by_user_id = EXCLUDED.archived_by_user_id,
              archived_by_email = EXCLUDED.archived_by_email,
              updated_at = NOW()
            """
        ),
        {
            "invoice_id": str(invoice.id),
            "source": source,
            "user_id": str(getattr(user, "id", None) or "") or None,
            "email": str(getattr(user, "email", None) or "") or None,
        },
    )
    _write_archive_log(db, invoice, action="archive", source=source, reason=reason, user=user)


def _auto_reopen_state(db: Session, invoice: InvoiceRecord, *, reason: str) -> None:
    db.execute(
        text("DELETE FROM invoice_archive_states WHERE invoice_id = :invoice_id"),
        {"invoice_id": str(invoice.id)},
    )
    _write_archive_log(db, invoice, action="unarchive", source="auto", reason=reason, user=None)


def release_manual_archive_hold(db: Session, invoice_id: str) -> None:
    db.execute(
        text(
            """
            DELETE FROM invoice_archive_states
            WHERE invoice_id = :invoice_id
              AND is_archived = FALSE
              AND manual_hold = TRUE
            """
        ),
        {"invoice_id": invoice_id},
    )


def _archive_inputs(db: Session, invoices: list[InvoiceRecord]):
    ids = [str(invoice.id) for invoice in invoices]
    if not ids:
        return {}, {}

    allocations = {
        str(invoice_id): float(total or 0)
        for invoice_id, total in db.execute(
            select(
                BillInvoiceAllocation.invoice_id,
                func.coalesce(func.sum(BillInvoiceAllocation.allocated_gross_amount), 0),
            ).where(
                BillInvoiceAllocation.invoice_id.in_(ids),
                BillInvoiceAllocation.status.in_(ACTIVE_ALLOCATION_STATUSES),
            ).group_by(BillInvoiceAllocation.invoice_id)
        ).all()
    }
    red_totals = {
        str(original_id): float(total or 0)
        for original_id, total in db.execute(
            select(
                InvoiceRecord.original_invoice_id,
                func.coalesce(func.sum(func.abs(InvoiceRecord.amount_with_tax)), 0),
            ).where(
                InvoiceRecord.original_invoice_id.in_(ids),
                InvoiceRecord.tax_status == "red",
            ).group_by(InvoiceRecord.original_invoice_id)
        ).all()
        if original_id is not None
    }
    return allocations, red_totals


def sync_invoice_archive_states(
    db: Session,
    invoice_ids: list[str] | set[str] | tuple[str, ...] | None = None,
    *,
    user: AuthUser | None = None,
) -> dict:
    stmt = select(InvoiceRecord)
    normalized_ids = [str(value).strip() for value in (invoice_ids or []) if str(value).strip()]
    if invoice_ids is not None:
        if not normalized_ids:
            return {"scanned": 0, "auto_archived": 0, "auto_reopened": 0, "held": 0}
        stmt = stmt.where(InvoiceRecord.id.in_(normalized_ids))
    invoices = db.execute(stmt).scalars().all()
    if not invoices:
        return {"scanned": 0, "auto_archived": 0, "auto_reopened": 0, "held": 0}

    ids = [str(invoice.id) for invoice in invoices]
    state_rows = db.execute(
        text(
            """
            SELECT invoice_id, is_archived, manual_hold
            FROM invoice_archive_states
            WHERE invoice_id = ANY(:invoice_ids)
            """
        ),
        {"invoice_ids": ids},
    ).mappings().all()
    states = {str(row["invoice_id"]): row for row in state_rows}
    allocations, red_totals = _archive_inputs(db, invoices)

    auto_archived = 0
    auto_reopened = 0
    held = 0
    for invoice in invoices:
        invoice_id = str(invoice.id)
        eligible, reason = invoice_archive_eligibility_from_values(
            invoice_amount=_invoice_gross(invoice),
            allocated_amount=allocations.get(invoice_id, 0),
            tax_status=invoice.tax_status,
            display_status=invoice.status,
            red_adjustment_amount=red_totals.get(invoice_id, 0),
        )
        state = states.get(invoice_id)

        if eligible:
            if state and bool(state["is_archived"]):
                continue
            if state and bool(state["manual_hold"]):
                held += 1
                continue
            _archive_state(db, invoice, source="auto", reason=reason, user=user)
            auto_archived += 1
            continue

        if state and bool(state["is_archived"]):
            _auto_reopen_state(db, invoice, reason=reason)
            auto_reopened += 1
        elif state and bool(state["manual_hold"]):
            db.execute(
                text("DELETE FROM invoice_archive_states WHERE invoice_id = :invoice_id"),
                {"invoice_id": invoice_id},
            )

    return {
        "scanned": len(invoices),
        "auto_archived": auto_archived,
        "auto_reopened": auto_reopened,
        "held": held,
    }


def archive_invoice(
    db: Session,
    invoice_id: str,
    *,
    user: AuthUser | None,
    source: str = "manual",
) -> dict:
    invoice = _load_invoice(db, invoice_id)
    allocations, red_totals = _archive_inputs(db, [invoice])
    eligible, reason = invoice_archive_eligibility_from_values(
        invoice_amount=_invoice_gross(invoice),
        allocated_amount=allocations.get(invoice_id, 0),
        tax_status=invoice.tax_status,
        display_status=invoice.status,
        red_adjustment_amount=red_totals.get(invoice_id, 0),
    )
    if not eligible:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "invoice_archive_not_ready", "message": reason},
        )
    state = _state_row(db, invoice_id)
    if state and bool(state["is_archived"]):
        return {"invoice_id": invoice_id, "archived": True, "already_archived": True}
    _archive_state(db, invoice, source=source, reason=reason, user=user)
    db.commit()
    return {"invoice_id": invoice_id, "archived": True, "already_archived": False}


def unarchive_invoice(db: Session, invoice_id: str, *, user: AuthUser | None) -> dict:
    invoice = _load_invoice(db, invoice_id)
    state = _state_row(db, invoice_id)
    if not state or not bool(state["is_archived"]):
        return {"invoice_id": invoice_id, "archived": False, "already_unarchived": True}
    db.execute(
        text(
            """
            INSERT INTO invoice_archive_states (
              invoice_id, is_archived, manual_hold, archive_source,
              archived_at, unarchived_at, archived_by_user_id, archived_by_email, updated_at
            ) VALUES (
              :invoice_id, FALSE, TRUE, 'manual_hold',
              NULL, NOW(), :user_id, :email, NOW()
            )
            ON CONFLICT (invoice_id) DO UPDATE SET
              is_archived = FALSE,
              manual_hold = TRUE,
              archive_source = 'manual_hold',
              archived_at = NULL,
              unarchived_at = NOW(),
              archived_by_user_id = EXCLUDED.archived_by_user_id,
              archived_by_email = EXCLUDED.archived_by_email,
              updated_at = NOW()
            """
        ),
        {
            "invoice_id": invoice_id,
            "user_id": str(getattr(user, "id", None) or "") or None,
            "email": str(getattr(user, "email", None) or "") or None,
        },
    )
    _write_archive_log(
        db,
        invoice,
        action="unarchive",
        source="manual",
        reason="人工取消归档，等待修改或重新归档",
        user=user,
    )
    db.commit()
    return {"invoice_id": invoice_id, "archived": False, "already_unarchived": False}


def invoice_archive_snapshot(
    db: Session,
    *,
    run_auto: bool = True,
    user: AuthUser | None = None,
) -> dict:
    sync_result = sync_invoice_archive_states(db, user=user) if run_auto else {
        "scanned": 0,
        "auto_archived": 0,
        "auto_reopened": 0,
        "held": 0,
    }
    if run_auto:
        db.commit()

    rows = db.execute(
        text(
            """
            SELECT invoice_id, is_archived, manual_hold, archive_source,
                   archived_at, unarchived_at, archived_by_email
            FROM invoice_archive_states
            ORDER BY archived_at DESC NULLS LAST, updated_at DESC
            """
        )
    ).mappings().all()
    archived_ids = [str(row["invoice_id"]) for row in rows if bool(row["is_archived"])]
    held_ids = [str(row["invoice_id"]) for row in rows if bool(row["manual_hold"])]
    items = [
        {
            "invoice_id": str(row["invoice_id"]),
            "archived_at": row["archived_at"].isoformat() if row["archived_at"] else None,
            "archive_source": row["archive_source"],
            "archived_by_email": row["archived_by_email"],
        }
        for row in rows
        if bool(row["is_archived"])
    ]
    return {
        "archived_ids": archived_ids,
        "held_ids": held_ids,
        "archived_count": len(archived_ids),
        "held_count": len(held_ids),
        "items": items,
        **sync_result,
    }
