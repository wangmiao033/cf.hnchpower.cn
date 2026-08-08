"""发票台账 CRUD API。"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.invoice import InvoiceRecord
from app.models.invoice_payment_link import InvoicePaymentLink
from app.schemas.invoice import (
    InvoiceRecordCreate,
    InvoiceRecordImportRequest,
    InvoiceRecordImportResponse,
    InvoiceRecordListResponse,
    InvoiceRecordRead,
    InvoiceRecordUpdate,
)

router = APIRouter()


def _identity_key(data: dict) -> str | None:
    digital = str(data.get("digital_invoice_no") or "").strip()
    if digital:
        return f"digital:{digital}"
    code = str(data.get("invoice_code") or "").strip()
    number = str(data.get("invoice_no") or "").strip()
    if code and number:
        return f"legacy:{code}:{number}"
    return None


def _normalize_invoice_amounts(data: dict) -> None:
    net = float(data.get("invoice_amount") or 0)
    tax = float(data.get("tax_amount") or 0)
    gross = float(data.get("amount_with_tax") or 0)
    if gross == 0 and (net != 0 or tax != 0):
        data["amount_with_tax"] = round(net + tax, 2)
    if not data.get("invoice_identity_key"):
        data["invoice_identity_key"] = _identity_key(data)


def _normalize_tax_status(data: dict) -> None:
    """Keep the legacy Chinese display status and the tax status in sync."""
    display_status = str(data.get("status") or "").strip()
    if not display_status:
        if "tax_status" in data and not data.get("tax_status"):
            data["tax_status"] = "normal"
        return
    if display_status == "作废":
        data["tax_status"] = "void"
    elif "红" in display_status:
        data["tax_status"] = "red"
    elif not data.get("tax_status"):
        data["tax_status"] = "normal"


def _normalize_verified_ids(raw: list | None) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    for x in raw:
        if x is None:
            continue
        out.append(str(x))
    return out


def _ensure_unique_identity(db: Session, identity_key: str | None, *, exclude_id: str | None = None) -> None:
    if not identity_key:
        return
    stmt = select(InvoiceRecord.id).where(InvoiceRecord.invoice_identity_key == identity_key)
    if exclude_id:
        stmt = stmt.where(InvoiceRecord.id != exclude_id)
    if db.execute(stmt.limit(1)).scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "duplicate_invoice", "identity_key": identity_key},
        )


def _apply_filters(stmt, *, search: str | None, status: str | None):
    if search and search.strip():
        term = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                InvoiceRecord.title.ilike(term),
                InvoiceRecord.tax_no.ilike(term),
                InvoiceRecord.remark.ilike(term),
                InvoiceRecord.invoice_date.ilike(term),
            )
        )
    if status and status.strip():
        stmt = stmt.where(InvoiceRecord.status == status.strip())
    return stmt


@router.get("", response_model=InvoiceRecordListResponse)
def list_invoice_records(
    db: Session = Depends(get_db),
    search: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> InvoiceRecordListResponse:
    base = select(InvoiceRecord)
    base = _apply_filters(base, search=search, status=status)
    count_stmt = select(func.count(InvoiceRecord.id))
    count_stmt = _apply_filters(count_stmt, search=search, status=status)
    total = int(db.execute(count_stmt).scalar_one())
    rows = (
        db.execute(base.order_by(InvoiceRecord.created_at.desc()).limit(limit).offset(offset))
        .scalars()
        .all()
    )
    return InvoiceRecordListResponse(
        items=[InvoiceRecordRead.model_validate(r) for r in rows],
        total=total,
    )


@router.post("/import", response_model=InvoiceRecordImportResponse)
def import_invoice_records(
    payload: InvoiceRecordImportRequest, db: Session = Depends(get_db)
) -> InvoiceRecordImportResponse:
    """Idempotently import invoice rows by the normalized invoice identity key."""
    prepared: list[dict] = []
    skipped = 0
    for item in payload.items:
        data = item.model_dump()
        _normalize_invoice_amounts(data)
        _normalize_tax_status(data)
        identity = data.get("invoice_identity_key")
        if not identity:
            skipped += 1
            continue
        data["verified_record_ids"] = _normalize_verified_ids(data.get("verified_record_ids"))
        prepared.append(data)

    identities = list({str(item["invoice_identity_key"]) for item in prepared})
    existing_rows = (
        db.execute(select(InvoiceRecord).where(InvoiceRecord.invoice_identity_key.in_(identities)))
        .scalars()
        .all()
        if identities
        else []
    )
    existing_by_identity = {str(row.invoice_identity_key): row for row in existing_rows}
    created = 0
    updated = 0
    preserved_fields = {"verified", "verified_amount", "verified_record_ids"}

    for data in prepared:
        identity = str(data["invoice_identity_key"])
        row = existing_by_identity.get(identity)
        if row is None:
            row = InvoiceRecord(id=str(uuid4()), **data)
            db.add(row)
            existing_by_identity[identity] = row
            created += 1
            continue

        for key, value in data.items():
            if key in preserved_fields:
                continue
            if key == "original_invoice_id" and value is None:
                continue
            setattr(row, key, value)
        row.updated_at = datetime.now(timezone.utc)
        updated += 1

    db.commit()
    return InvoiceRecordImportResponse(
        created=created,
        updated=updated,
        skipped=skipped,
        total=created + updated,
    )


@router.get("/{record_id}", response_model=InvoiceRecordRead)
def get_invoice_record(record_id: str, db: Session = Depends(get_db)) -> InvoiceRecordRead:
    row = db.get(InvoiceRecord, record_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "id": record_id},
        )
    return InvoiceRecordRead.model_validate(row)


@router.post("", response_model=InvoiceRecordRead, status_code=status.HTTP_201_CREATED)
def create_invoice_record(
    payload: InvoiceRecordCreate, db: Session = Depends(get_db)
) -> InvoiceRecordRead:
    data = payload.model_dump()
    _normalize_invoice_amounts(data)
    _normalize_tax_status(data)
    _ensure_unique_identity(db, data.get("invoice_identity_key"))
    data["verified_record_ids"] = _normalize_verified_ids(data.get("verified_record_ids"))
    row = InvoiceRecord(id=str(uuid4()), **data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return InvoiceRecordRead.model_validate(row)


@router.put("/{record_id}", response_model=InvoiceRecordRead)
def update_invoice_record(
    record_id: str, payload: InvoiceRecordUpdate, db: Session = Depends(get_db)
) -> InvoiceRecordRead:
    row = db.get(InvoiceRecord, record_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "id": record_id},
        )
    patch = payload.model_dump(exclude_unset=True)
    _normalize_tax_status(patch)
    merged_for_identity = {
        "digital_invoice_no": patch.get("digital_invoice_no", row.digital_invoice_no),
        "invoice_code": patch.get("invoice_code", row.invoice_code),
        "invoice_no": patch.get("invoice_no", row.invoice_no),
        "invoice_amount": patch.get("invoice_amount", row.invoice_amount),
        "tax_amount": patch.get("tax_amount", row.tax_amount),
        "amount_with_tax": patch.get("amount_with_tax", row.amount_with_tax),
        "invoice_identity_key": patch.get("invoice_identity_key", row.invoice_identity_key),
    }
    _normalize_invoice_amounts(merged_for_identity)
    _ensure_unique_identity(db, merged_for_identity.get("invoice_identity_key"), exclude_id=record_id)
    if "amount_with_tax" not in patch and float(row.amount_with_tax or 0) == 0:
        patch["amount_with_tax"] = merged_for_identity["amount_with_tax"]
    patch["invoice_identity_key"] = merged_for_identity["invoice_identity_key"]
    if "verified_record_ids" in patch and patch["verified_record_ids"] is not None:
        patch["verified_record_ids"] = _normalize_verified_ids(patch["verified_record_ids"])
    for key, value in patch.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return InvoiceRecordRead.model_validate(row)


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice_record(record_id: str, db: Session = Depends(get_db)) -> None:
    row = db.get(InvoiceRecord, record_id)
    if row is None:
        # DELETE is idempotent: stale browser/cache rows are already in the desired state.
        return

    active_allocation = db.execute(
        select(BillInvoiceAllocation.id).where(
            BillInvoiceAllocation.invoice_id == record_id,
            BillInvoiceAllocation.status.in_(("suggested", "confirmed")),
        ).limit(1)
    ).scalar_one_or_none()
    if active_allocation is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "invoice_has_active_allocations"},
        )

    try:
        # Old rejected/cancelled allocation rows may still carry a DB foreign key even though
        # the invoice is shown as unlinked in the UI. Remove only those stale rows here.
        db.execute(
            delete(BillInvoiceAllocation).where(
                BillInvoiceAllocation.invoice_id == record_id
            )
        )
        # This legacy relation has no DB foreign key, so clean it explicitly to avoid orphans.
        db.execute(
            delete(InvoicePaymentLink).where(
                InvoicePaymentLink.invoice_id == record_id
            )
        )
        db.delete(row)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "invoice_has_linked_records"},
        ) from exc
