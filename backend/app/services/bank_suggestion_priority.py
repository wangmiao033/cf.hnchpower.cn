"""Priority ordering for bank auto-reconciliation suggestions."""

from __future__ import annotations

from datetime import date
from typing import Any

CONFIDENCE_PRIORITY = {
    "high": 0,
    "medium": 1,
    "low": 2,
    "none": 3,
}


def _number(value: Any) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed == parsed else 0.0


def _date_ordinal(value: Any) -> int:
    raw = str(value or "").strip()[:10]
    if not raw:
        return 0
    try:
        return date.fromisoformat(raw).toordinal()
    except ValueError:
        return 0


def suggestion_priority_key(item: dict[str, Any]) -> tuple[Any, ...]:
    """Sort high-confidence, high-score suggestions first, then newer rows."""
    confidence = str(item.get("confidence_level") or "none").strip().lower()
    return (
        CONFIDENCE_PRIORITY.get(confidence, 4),
        -_number(item.get("top_score")),
        -_number(item.get("ambiguity_margin")),
        -int(bool(item.get("auto_ready"))),
        -_date_ordinal(item.get("trade_date")),
        str(item.get("transaction_id") or ""),
    )


def prioritize_bank_suggestions(result: dict[str, Any]) -> dict[str, Any]:
    """Return dashboard payload with the pending queue ordered by matching quality."""
    suggestions = list(result.get("suggestions") or [])
    suggestions.sort(key=suggestion_priority_key)
    result["suggestions"] = suggestions
    return result
