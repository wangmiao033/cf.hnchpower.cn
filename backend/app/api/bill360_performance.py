"""Bill360 read-optimized endpoints.

Keep these endpoints read-only.  They exist to collapse many small browser requests
into one database query without changing reconciliation or QuickSDK source facts.
"""

from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.quicksdk import QuickSdkFlow

router = APIRouter()


class Bill360QuickSdkKey(BaseModel):
    key: str = Field(min_length=1, max_length=300)
    settlement_month: str = Field(min_length=1, max_length=20)
    game_name: str = Field(min_length=1, max_length=300)


class Bill360QuickSdkRequest(BaseModel):
    keys: list[Bill360QuickSdkKey] = Field(default_factory=list, max_length=40)


def _num(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _normalize(value: object) -> str:
    return str(value or "").strip().lower()


@router.post("/bill360-quicksdk-summary")
def bill360_quicksdk_summary(
    payload: Bill360QuickSdkRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Return all QuickSDK game/month summaries for one Bill360 in one query."""
    keys = []
    seen = set()
    for raw in payload.keys[:40]:
        key = str(raw.key or "").strip()
        month = str(raw.settlement_month or "").strip()
        game = str(raw.game_name or "").strip()
        signature = (key, month, game)
        if not key or not month or not game or signature in seen:
            continue
        seen.add(signature)
        keys.append({"key": key, "month": month, "game": game, "game_norm": game.lower()})

    if not keys:
        return {"items": []}

    conditions = [
        and_(
            QuickSdkFlow.settlement_month == item["month"],
            QuickSdkFlow.game_name.ilike(f"%{item['game']}%"),
        )
        for item in keys
    ]
    rows = db.execute(
        select(
            QuickSdkFlow.settlement_month,
            QuickSdkFlow.game_name,
            QuickSdkFlow.channel_name,
            QuickSdkFlow.gross_flow,
        ).where(or_(*conditions))
    ).all()

    grouped = {
        item["key"]: {
            "key": item["key"],
            "settlement_month": item["month"],
            "game_name": item["game"],
            "row_count": 0,
            "total_flow": 0.0,
            "channels": defaultdict(float),
            "source_games": set(),
        }
        for item in keys
    }

    keys_by_month: dict[str, list[dict]] = defaultdict(list)
    for item in keys:
        keys_by_month[item["month"]].append(item)

    for month, source_game, channel_name, gross_flow in rows:
        source_text = str(source_game or "").strip()
        source_norm = _normalize(source_text)
        if not source_norm:
            continue
        for item in keys_by_month.get(str(month or ""), []):
            if item["game_norm"] not in source_norm:
                continue
            target = grouped[item["key"]]
            flow = _num(gross_flow)
            target["row_count"] += 1
            target["total_flow"] += flow
            target["source_games"].add(source_text)
            channel = str(channel_name or "").strip()
            if channel:
                target["channels"][channel] += flow

    items = []
    for item in keys:
        target = grouped[item["key"]]
        channel_totals = target["channels"]
        top_channel = None
        top_channel_flow = 0.0
        if channel_totals:
            top_channel, top_channel_flow = max(channel_totals.items(), key=lambda pair: pair[1])
        items.append(
            {
                "key": target["key"],
                "settlement_month": target["settlement_month"],
                "game_name": target["game_name"],
                "row_count": int(target["row_count"]),
                "channel_count": len(channel_totals),
                "source_game_count": len(target["source_games"]),
                "total_flow": round(float(target["total_flow"]), 2),
                "top_channel": top_channel,
                "top_channel_flow": round(float(top_channel_flow), 2),
            }
        )

    return {"items": items}
