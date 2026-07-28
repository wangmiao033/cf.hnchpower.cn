"""Standalone QuickSDK game/ProductCode source registry API."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.quicksdk import QuickSdkProductSource
from app.schemas.product_source import (
    ProductSourceImportRequest,
    ProductSourceImportResponse,
    ProductSourceListResponse,
    ProductSourceRead,
)

router = APIRouter()


def _normalize_code(value: str) -> str:
    return str(value or "").strip().lstrip("'")


@router.get("", response_model=ProductSourceListResponse)
def list_product_sources(
    db: Session = Depends(get_db),
    q: str | None = Query(None),
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
) -> ProductSourceListResponse:
    stmt = select(QuickSdkProductSource)
    count_stmt = select(func.count(QuickSdkProductSource.id))
    keyword = str(q or "").strip()
    if keyword:
        pattern = f"%{keyword}%"
        condition = or_(
            QuickSdkProductSource.game_name.ilike(pattern),
            QuickSdkProductSource.product_code.ilike(pattern),
        )
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    total = int(db.execute(count_stmt).scalar_one())
    rows = (
        db.execute(
            stmt.order_by(
                QuickSdkProductSource.game_name.asc(),
                QuickSdkProductSource.product_code.asc(),
            )
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )
    latest_import_at = db.execute(
        select(func.max(QuickSdkProductSource.updated_at))
    ).scalar_one_or_none()
    return ProductSourceListResponse(
        items=[ProductSourceRead.model_validate(row) for row in rows],
        total=total,
        latest_import_at=latest_import_at,
    )


@router.post("/import", response_model=ProductSourceImportResponse)
def import_product_sources(
    payload: ProductSourceImportRequest,
    db: Session = Depends(get_db),
) -> ProductSourceImportResponse:
    source_file = str(payload.source_file or "").strip() or None
    inserted = 0
    updated = 0
    skipped = 0
    seen: set[str] = set()

    for item in payload.rows:
        game_name = str(item.game_name or "").strip()
        product_code = _normalize_code(item.product_code)
        if not game_name or not product_code or product_code in seen:
            skipped += 1
            continue
        seen.add(product_code)

        existing = db.execute(
            select(QuickSdkProductSource).where(
                QuickSdkProductSource.product_code == product_code
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(
                QuickSdkProductSource(
                    id=str(uuid.uuid4()),
                    game_name=game_name,
                    product_code=product_code,
                    source_file=source_file,
                )
            )
            inserted += 1
        else:
            existing.game_name = game_name
            existing.source_file = source_file
            existing.updated_at = datetime.now(timezone.utc)
            updated += 1

    db.commit()
    total = int(db.execute(select(func.count(QuickSdkProductSource.id))).scalar_one())
    return ProductSourceImportResponse(
        inserted=inserted,
        updated=updated,
        skipped=skipped,
        total=total,
    )
