"""V4 游戏库只读验证 API。

第一阶段只读取历史渠道账单并生成候选游戏/规则区间；不回写历史账单，也不自动修改金额。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.game_registry import ChannelGameRule, GameRegistryGame
from app.services.game_registry import (
    build_history_preview,
    count_legacy_channel_records_without_lines,
    load_confirmed_history_rows,
)

router = APIRouter()


@router.get("/history-preview")
def history_preview(
    db: Session = Depends(get_db),
    partner_name: str | None = Query(None),
    channel_name: str | None = Query(None),
    confirmed_only: bool = Query(True),
) -> dict:
    rows = load_confirmed_history_rows(
        db,
        partner_name=partner_name,
        channel_name=channel_name,
        confirmed_only=confirmed_only,
    )
    preview = build_history_preview(rows)
    preview["summary"]["legacy_records_without_line_items"] = count_legacy_channel_records_without_lines(
        db, confirmed_only=confirmed_only
    )
    preview["filters"] = {
        "partner_name": partner_name,
        "channel_name": channel_name,
        "confirmed_only": confirmed_only,
    }
    return preview


@router.get("/games")
def list_games(db: Session = Depends(get_db)) -> dict:
    rows = db.execute(
        select(GameRegistryGame).order_by(GameRegistryGame.canonical_name.asc())
    ).scalars().all()
    return {
        "items": [
            {
                "id": row.id,
                "canonical_name": row.canonical_name,
                "normalized_name": row.normalized_name,
                "status": row.status,
                "source": row.source,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            }
            for row in rows
        ],
        "total": len(rows),
    }


@router.get("/rules")
def list_rules(
    db: Session = Depends(get_db),
    partner_name: str | None = Query(None),
    channel_name: str | None = Query(None),
    game_id: str | None = Query(None),
) -> dict:
    stmt = select(ChannelGameRule, GameRegistryGame).join(
        GameRegistryGame, GameRegistryGame.id == ChannelGameRule.game_id
    )
    if partner_name and partner_name.strip():
        stmt = stmt.where(ChannelGameRule.partner_name.ilike(f"%{partner_name.strip()}%"))
    if channel_name and channel_name.strip():
        stmt = stmt.where(ChannelGameRule.channel_name.ilike(f"%{channel_name.strip()}%"))
    if game_id and game_id.strip():
        stmt = stmt.where(ChannelGameRule.game_id == game_id.strip())
    rows = db.execute(
        stmt.order_by(
            ChannelGameRule.partner_name.asc(),
            ChannelGameRule.channel_name.asc(),
            GameRegistryGame.canonical_name.asc(),
            ChannelGameRule.start_month.asc(),
        )
    ).all()
    items = []
    for rule, game in rows:
        items.append(
            {
                "id": rule.id,
                "game_id": rule.game_id,
                "game_name": game.canonical_name,
                "partner_name": rule.partner_name,
                "channel_name": rule.channel_name,
                "start_month": rule.start_month,
                "end_month": rule.end_month,
                "share_rate": float(rule.share_rate) if rule.share_rate is not None else None,
                "tax_rate": float(rule.tax_rate) if rule.tax_rate is not None else None,
                "channel_fee_rate": float(rule.channel_fee_rate) if rule.channel_fee_rate is not None else None,
                "settlement_rule_code": rule.settlement_rule_code,
                "channel_fee_mode": rule.channel_fee_mode,
                "tax_mode": rule.tax_mode,
                "source": rule.source,
                "source_month_count": rule.source_month_count,
                "status": rule.status,
            }
        )
    return {"items": items, "total": len(items)}
