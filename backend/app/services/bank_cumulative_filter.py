"""Remove cumulative-deferred channel bills from bank matching suggestions."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.channel import ChannelRecord
from app.services.channel_cumulative_policy import deferred_bill_ids


def _confidence(score: float, margin: float, has_candidate: bool) -> str:
    if not has_candidate:
        return "none"
    if score >= 80 and margin >= 10:
        return "high"
    if score >= 60:
        return "medium"
    return "low"


def filter_cumulative_bank_suggestions(db: Session, dashboard: dict) -> dict:
    suggestions = list(dashboard.get("suggestions") or [])
    if not suggestions:
        return dashboard
    rows = list(db.execute(select(ChannelRecord).where(ChannelRecord.status == "confirmed")).scalars().all())
    deferred = deferred_bill_ids(db, rows)
    if not deferred:
        return dashboard

    for suggestion in suggestions:
        if str(suggestion.get("direction") or "") != "collection":
            continue
        candidates = [
            item for item in (suggestion.get("candidates") or [])
            if str(item.get("bill_id") or "") not in deferred
        ]
        candidates.sort(key=lambda item: float(item.get("score") or 0), reverse=True)
        suggestion["candidates"] = candidates
        top_score = float(candidates[0].get("score") or 0) if candidates else 0.0
        second_score = float(candidates[1].get("score") or 0) if len(candidates) > 1 else 0.0
        margin = top_score - second_score
        level = _confidence(top_score, margin, bool(candidates))
        suggestion["top_score"] = round(top_score, 2)
        suggestion["ambiguity_margin"] = round(margin, 2)
        suggestion["confidence_level"] = level
        if "auto_ready" in suggestion:
            suggestion["auto_ready"] = level == "high"
        if not candidates:
            suggestion["blocked_reason"] = "暂未找到可结算账单；累计结算中的账单已自动排除。"
        elif level == "low":
            suggestion["blocked_reason"] = "匹配证据不足，请人工选择已进入结算阶段的账单。"
        else:
            suggestion["blocked_reason"] = None

    stats = dashboard.get("stats") or {}
    if "high_confidence" in stats:
        stats["high_confidence"] = sum(1 for item in suggestions if item.get("confidence_level") == "high")
        stats["medium_confidence"] = sum(1 for item in suggestions if item.get("confidence_level") == "medium")
        stats["unmatched"] = sum(1 for item in suggestions if item.get("confidence_level") in {"low", "none"})
    dashboard["stats"] = stats
    dashboard["suggestions"] = suggestions
    return dashboard
