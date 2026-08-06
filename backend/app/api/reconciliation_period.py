"""Read-only settlement-period metadata for research bills.

The bill master remains one record. Monthly views consume line-item periods from
this endpoint so a multi-period bill is never duplicated at the master level.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.deps import get_db
from app.models.reconciliation import ReconciliationLineItem, ReconciliationRecord

router = APIRouter()

_PERIOD_RE = re.compile(r"^(\d{4})(?:-|年)\s*(\d{1,2})(?:月)?$")


def normalize_settlement_period(raw: object) -> str | None:
    """Normalize supported year-month inputs to `YYYY年M月`."""
    text = str(raw or "").strip()
    if not text:
        return None
    match = _PERIOD_RE.match(text)
    if not match:
        return text
    year = int(match.group(1))
    month = min(max(int(match.group(2)), 1), 12)
    return f"{year}年{month}月"


def settlement_period_sort_key(raw: object) -> tuple[int, int, str]:
    normalized = normalize_settlement_period(raw) or ""
    match = re.match(r"^(\d{4})年(\d{1,2})月$", normalized)
    if not match:
        return (9999, 99, normalized)
    return (int(match.group(1)), int(match.group(2)), normalized)


def unique_settlement_periods(values: Iterable[object]) -> list[str]:
    normalized = {
        period
        for value in values
        if (period := normalize_settlement_period(value))
    }
    return sorted(normalized, key=settlement_period_sort_key)


def format_settlement_period_label(periods: Iterable[object]) -> str:
    """Format one period, a continuous range, or a non-continuous list."""
    normalized = unique_settlement_periods(periods)
    if not normalized:
        return ""
    if len(normalized) == 1:
        return normalized[0]

    parsed: list[tuple[int, int]] = []
    for period in normalized:
        match = re.match(r"^(\d{4})年(\d{1,2})月$", period)
        if not match:
            return "、".join(normalized)
        parsed.append((int(match.group(1)), int(match.group(2))))

    indexes = [year * 12 + month for year, month in parsed]
    continuous = all(right - left == 1 for left, right in zip(indexes, indexes[1:]))
    return f"{normalized[0]}—{normalized[-1]}" if continuous else "、".join(normalized)


def line_period(line: ReconciliationLineItem, fallback: object) -> str:
    return normalize_settlement_period(line.settlement_cycle or fallback) or ""


def record_periods(row: ReconciliationRecord) -> list[str]:
    fallback = normalize_settlement_period(row.settlement_month)
    periods = [line_period(line, fallback) for line in row.line_items]
    if not any(periods) and fallback:
        periods.append(fallback)
    return unique_settlement_periods(periods)


def line_payload(line: ReconciliationLineItem, fallback: object) -> dict:
    return {
        "id": str(line.id),
        "reconciliation_id": str(line.reconciliation_id),
        "settlement_cycle": line_period(line, fallback) or None,
        "game_name": line.game_name,
        "revenue": float(line.revenue or 0),
        "discount_rate": float(line.discount_rate or 1),
        "net_revenue": float(line.net_revenue or 0),
        "coupon_amount": float(line.coupon_amount or 0),
        "test_fee": float(line.test_fee or 0),
        "extra_fee": float(line.extra_fee or 0),
        "share_ratio": float(line.share_ratio or 0),
        "tax_rate": float(line.tax_rate or 0),
        "share_amount": float(line.share_amount or 0),
        "settlement_amount": float(line.settlement_amount or 0),
        "sort_order": int(line.sort_order or 0),
    }


@router.get("")
def list_reconciliation_periods(
    ids: str | None = Query(None, description="Optional comma-separated bill IDs"),
    db: Session = Depends(get_db),
) -> dict:
    requested_ids = [item.strip() for item in str(ids or "").split(",") if item.strip()]
    statement = select(ReconciliationRecord).options(
        selectinload(ReconciliationRecord.line_items)
    )
    if requested_ids:
        statement = statement.where(ReconciliationRecord.id.in_(requested_ids))

    rows = db.execute(
        statement.order_by(ReconciliationRecord.created_at.desc())
    ).scalars().all()

    items = []
    for row in rows:
        periods = record_periods(row)
        sorted_lines = sorted(row.line_items, key=lambda line: (line.sort_order, line.id))
        items.append(
            {
                "bill_id": str(row.id),
                "periods": periods,
                "period_label": format_settlement_period_label(periods),
                "items": [line_payload(line, row.settlement_month) for line in sorted_lines],
            }
        )
    return {"items": items, "total": len(items)}
