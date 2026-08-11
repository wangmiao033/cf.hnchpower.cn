"""独立服务器成本台账 CRUD。"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.server_cost import ServerCost
from app.schemas.server_cost import (
    ServerCostCreate,
    ServerCostListResponse,
    ServerCostRead,
    ServerCostUpdate,
    ServerCostVoid,
)
from app.services.monthly_business_dashboard import month_key

router = APIRouter()

SERVER_COST_CATEGORIES = frozenset(
    {"cloud_server", "cdn", "database", "bandwidth", "domain", "other"}
)
SERVER_COST_STATUSES = frozenset({"active", "void"})


def _normalize_text(value: str | None) -> str | None:
    text = str(value or "").strip()
    return text or None


def _validate_month(raw: str | None) -> str:
    normalized = month_key(raw)
    if not normalized:
        raise HTTPException(status_code=422, detail="费用月份格式无效，请使用 YYYY-MM")
    return normalized


def _validate_category(raw: str | None) -> str:
    category = str(raw or "").strip().lower()
    if category not in SERVER_COST_CATEGORIES:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_server_cost_category", "allowed": sorted(SERVER_COST_CATEGORIES)},
        )
    return category


def _apply_filters(stmt, *, month: str | None, category: str | None, game_name: str | None, q: str | None, row_status: str | None):
    if month and month.strip():
        stmt = stmt.where(ServerCost.expense_month == _validate_month(month))
    if category and category.strip():
        stmt = stmt.where(ServerCost.category == _validate_category(category))
    if game_name and game_name.strip():
        stmt = stmt.where(ServerCost.game_name.ilike(f"%{game_name.strip()}%"))
    status_value = str(row_status or "active").strip().lower()
    if status_value != "all":
        if status_value not in SERVER_COST_STATUSES:
            raise HTTPException(status_code=422, detail="状态仅支持 active / void / all")
        stmt = stmt.where(ServerCost.status == status_value)
    if q and q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                ServerCost.game_name.ilike(term),
                ServerCost.provider_name.ilike(term),
                ServerCost.payer_entity.ilike(term),
                ServerCost.payer_partner_id.ilike(term),
                ServerCost.remark.ilike(term),
                ServerCost.category.ilike(term),
            )
        )
    return stmt


@router.get("", response_model=ServerCostListResponse)
def list_server_costs(
    db: Session = Depends(get_db),
    month: str | None = Query(None),
    category: str | None = Query(None),
    game_name: str | None = Query(None),
    q: str | None = Query(None),
    row_status: str | None = Query("active", alias="status"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> ServerCostListResponse:
    base = _apply_filters(
        select(ServerCost),
        month=month,
        category=category,
        game_name=game_name,
        q=q,
        row_status=row_status,
    )
    filtered = base.subquery()
    total = int(db.execute(select(func.count()).select_from(filtered)).scalar_one())
    amount_total = float(
        db.execute(select(func.coalesce(func.sum(filtered.c.amount), 0))).scalar_one() or 0
    )
    rows = (
        db.execute(
            base.order_by(ServerCost.expense_month.desc(), ServerCost.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )
    return ServerCostListResponse(
        items=[ServerCostRead.model_validate(row) for row in rows],
        total=total,
        amount_total=round(amount_total, 2),
    )


@router.post("", response_model=ServerCostRead, status_code=status.HTTP_201_CREATED)
def create_server_cost(payload: ServerCostCreate, db: Session = Depends(get_db)) -> ServerCostRead:
    data = payload.model_dump()
    data["expense_month"] = _validate_month(data.get("expense_month"))
    data["category"] = _validate_category(data.get("category"))
    for field in (
        "expense_date",
        "provider_name",
        "game_name",
        "payer_entity",
        "payer_partner_id",
        "remark",
    ):
        data[field] = _normalize_text(data.get(field))
    data["source"] = str(data.get("source") or "manual").strip() or "manual"
    row = ServerCost(id=str(uuid4()), status="active", **data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return ServerCostRead.model_validate(row)


@router.put("/{cost_id}", response_model=ServerCostRead)
def update_server_cost(cost_id: str, payload: ServerCostUpdate, db: Session = Depends(get_db)) -> ServerCostRead:
    row = db.get(ServerCost, cost_id)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "id": cost_id})
    if row.status == "void":
        raise HTTPException(status_code=409, detail="已作废的服务器成本请先恢复后再编辑")
    data = payload.model_dump(exclude_unset=True)
    if "expense_month" in data:
        data["expense_month"] = _validate_month(data.get("expense_month"))
    if "category" in data:
        data["category"] = _validate_category(data.get("category"))
    if "amount" in data and data.get("amount") is None:
        raise HTTPException(status_code=422, detail="服务器成本金额不能为空")
    if "source" in data:
        source = str(data.get("source") or "").strip()
        if not source:
            raise HTTPException(status_code=422, detail="费用来源不能为空")
        data["source"] = source
    for field in (
        "expense_date",
        "provider_name",
        "game_name",
        "payer_entity",
        "payer_partner_id",
        "remark",
    ):
        if field in data:
            data[field] = _normalize_text(data.get(field))
    for key, value in data.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return ServerCostRead.model_validate(row)


@router.post("/{cost_id}/void", response_model=ServerCostRead)
def void_server_cost(cost_id: str, payload: ServerCostVoid, db: Session = Depends(get_db)) -> ServerCostRead:
    row = db.get(ServerCost, cost_id)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "id": cost_id})
    if row.status != "void":
        row.status = "void"
        row.void_reason = _normalize_text(payload.reason)
        row.voided_at = datetime.now(timezone.utc)
        row.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(row)
    return ServerCostRead.model_validate(row)


@router.post("/{cost_id}/restore", response_model=ServerCostRead)
def restore_server_cost(cost_id: str, db: Session = Depends(get_db)) -> ServerCostRead:
    row = db.get(ServerCost, cost_id)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "id": cost_id})
    row.status = "active"
    row.void_reason = None
    row.voided_at = None
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return ServerCostRead.model_validate(row)
