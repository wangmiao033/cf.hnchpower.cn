"""押金 / 保证金台账 CRUD。

这类资金是可收回资产，不进入 operating_expenses，因此不会冲减经营利润。
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.operating_deposit import OperatingDeposit
from app.schemas.operating_deposit import (
    OperatingDepositCreate,
    OperatingDepositListResponse,
    OperatingDepositRead,
    OperatingDepositUpdate,
)

router = APIRouter()

DEPOSIT_STATUSES = frozenset({"held", "refunded", "forfeited"})
DEPOSIT_TYPES = frozenset({"office", "service", "other"})


def _normalize_text(value: str | None) -> str | None:
    text = str(value or "").strip()
    return text or None


def _validate_status(raw: str | None) -> str:
    value = str(raw or "").strip().lower()
    if value not in DEPOSIT_STATUSES:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_deposit_status", "allowed": sorted(DEPOSIT_STATUSES)},
        )
    return value


def _validate_type(raw: str | None) -> str:
    value = str(raw or "").strip().lower()
    if value not in DEPOSIT_TYPES:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_deposit_type", "allowed": sorted(DEPOSIT_TYPES)},
        )
    return value


@router.get("", response_model=OperatingDepositListResponse)
def list_operating_deposits(
    db: Session = Depends(get_db),
    status_filter: str | None = Query(None, alias="status"),
    deposit_type: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> OperatingDepositListResponse:
    stmt = select(OperatingDeposit)
    if status_filter and status_filter.strip() and status_filter != "all":
        stmt = stmt.where(OperatingDeposit.status == _validate_status(status_filter))
    if deposit_type and deposit_type.strip() and deposit_type != "all":
        stmt = stmt.where(OperatingDeposit.deposit_type == _validate_type(deposit_type))
    if q and q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                OperatingDeposit.title.ilike(term),
                OperatingDeposit.counterparty.ilike(term),
                OperatingDeposit.remark.ilike(term),
            )
        )

    filtered = stmt.subquery()
    total = int(db.execute(select(func.count()).select_from(filtered)).scalar_one())
    amount_total = float(
        db.execute(select(func.coalesce(func.sum(filtered.c.amount), 0))).scalar_one() or 0
    )
    rows = (
        db.execute(
            stmt.order_by(
                OperatingDeposit.status.asc(),
                OperatingDeposit.created_at.desc(),
            ).limit(limit).offset(offset)
        )
        .scalars()
        .all()
    )
    return OperatingDepositListResponse(
        items=[OperatingDepositRead.model_validate(row) for row in rows],
        total=total,
        amount_total=round(amount_total, 2),
    )


@router.post("", response_model=OperatingDepositRead, status_code=status.HTTP_201_CREATED)
def create_operating_deposit(
    payload: OperatingDepositCreate,
    db: Session = Depends(get_db),
) -> OperatingDepositRead:
    data = payload.model_dump()
    data["deposit_type"] = _validate_type(data.get("deposit_type"))
    data["status"] = _validate_status(data.get("status"))
    data["title"] = str(data.get("title") or "").strip()
    for field in ("counterparty", "paid_date", "expected_refund_date", "refund_date", "remark"):
        data[field] = _normalize_text(data.get(field))
    if not data["title"]:
        raise HTTPException(status_code=422, detail="押金名称不能为空")
    row = OperatingDeposit(id=str(uuid4()), **data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return OperatingDepositRead.model_validate(row)


@router.put("/{deposit_id}", response_model=OperatingDepositRead)
def update_operating_deposit(
    deposit_id: str,
    payload: OperatingDepositUpdate,
    db: Session = Depends(get_db),
) -> OperatingDepositRead:
    row = db.get(OperatingDeposit, deposit_id)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "id": deposit_id})
    data = payload.model_dump(exclude_unset=True)
    if "deposit_type" in data:
        data["deposit_type"] = _validate_type(data.get("deposit_type"))
    if "status" in data:
        data["status"] = _validate_status(data.get("status"))
    if "amount" in data and data.get("amount") is None:
        raise HTTPException(status_code=422, detail="押金金额不能为空")
    if "title" in data:
        title = str(data.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=422, detail="押金名称不能为空")
        data["title"] = title
    for field in ("counterparty", "paid_date", "expected_refund_date", "refund_date", "remark"):
        if field in data:
            data[field] = _normalize_text(data.get(field))
    for key, value in data.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return OperatingDepositRead.model_validate(row)


@router.delete("/{deposit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_operating_deposit(deposit_id: str, db: Session = Depends(get_db)) -> None:
    row = db.get(OperatingDeposit, deposit_id)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "id": deposit_id})
    db.delete(row)
    db.commit()
