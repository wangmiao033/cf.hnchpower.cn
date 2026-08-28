"""V4 游戏库、稳定游戏身份与名称映射 API。"""

from __future__ import annotations

import re
import unicodedata
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import select, text as sql_text
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.game_registry import ChannelGameRule, GameRegistryGame
from app.services.game_registry import (
    build_history_preview,
    count_legacy_channel_records_without_lines,
    load_confirmed_history_rows,
)

router = APIRouter()


def _normalize_game(value: object) -> str:
    raw = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    raw = raw.replace("（", "(").replace("）", ")")
    return re.sub(r"\s+", "", raw)


def _resolve_identity(db: Session, raw_name: str) -> dict | None:
    name = str(raw_name or "").strip()
    normalized = _normalize_game(name)
    if not normalized:
        return None

    game = db.execute(
        select(GameRegistryGame).where(GameRegistryGame.normalized_name == normalized)
    ).scalars().first()
    if game is not None:
        return {
            "input_name": name,
            "normalized_name": normalized,
            "game_id": game.id,
            "canonical_name": game.canonical_name,
            "source": "canonical",
        }

    row = db.execute(
        sql_text(
            """
            SELECT alias.game_id, game.canonical_name, alias.alias_name
            FROM game_registry_aliases AS alias
            JOIN game_registry_games AS game ON game.id = alias.game_id
            WHERE alias.normalized_alias = :normalized
            LIMIT 1
            """
        ),
        {"normalized": normalized},
    ).mappings().first()
    if row is None:
        return None
    return {
        "input_name": name,
        "normalized_name": normalized,
        "game_id": str(row["game_id"]),
        "canonical_name": str(row["canonical_name"] or ""),
        "source": "alias",
    }


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


@router.post("/resolve")
def resolve_game_names(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
) -> dict:
    names = payload.get("names") if isinstance(payload, dict) else None
    if not isinstance(names, list):
        raise HTTPException(status_code=422, detail="names 必须是游戏名称数组")
    unique_names = list(dict.fromkeys(str(item or "").strip() for item in names if str(item or "").strip()))
    items = []
    for name in unique_names[:200]:
        resolved = _resolve_identity(db, name)
        items.append(
            resolved
            or {
                "input_name": name,
                "normalized_name": _normalize_game(name),
                "game_id": None,
                "canonical_name": None,
                "source": "unmapped",
            }
        )
    return {"items": items, "total": len(items)}


@router.post("/aliases/map")
def map_game_alias(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
) -> dict:
    alias_name = str(payload.get("alias_name") or "").strip()
    target_name = str(payload.get("target_name") or "").strip()
    target_game_id = str(payload.get("target_game_id") or "").strip()
    access_item_id = str(payload.get("access_item_id") or "").strip()
    if not alias_name:
        raise HTTPException(status_code=422, detail="请输入需要映射的游戏名称")

    target_game = None
    if target_game_id:
        target_game = db.get(GameRegistryGame, target_game_id)
    if target_game is None and target_name:
        target_identity = _resolve_identity(db, target_name)
        if target_identity:
            target_game = db.get(GameRegistryGame, target_identity["game_id"])
    if target_game is None:
        raise HTTPException(status_code=422, detail="目标标准游戏不存在，请先从合同合作游戏中选择")

    normalized_alias = _normalize_game(alias_name)
    if not normalized_alias:
        raise HTTPException(status_code=422, detail="游戏名称不能为空")

    canonical_owner = db.execute(
        select(GameRegistryGame).where(GameRegistryGame.normalized_name == normalized_alias)
    ).scalars().first()
    if canonical_owner is not None and canonical_owner.id != target_game.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"「{alias_name}」已经是标准游戏「{canonical_owner.canonical_name}」，不能映射到其他游戏",
        )

    existing = db.execute(
        sql_text(
            """
            SELECT alias.game_id, game.canonical_name
            FROM game_registry_aliases AS alias
            JOIN game_registry_games AS game ON game.id = alias.game_id
            WHERE alias.normalized_alias = :normalized
            LIMIT 1
            """
        ),
        {"normalized": normalized_alias},
    ).mappings().first()
    if existing is not None and str(existing["game_id"]) != str(target_game.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"「{alias_name}」已映射到「{existing['canonical_name']}」，请先检查原映射",
        )

    if canonical_owner is None and existing is None:
        db.execute(
            sql_text(
                """
                INSERT INTO game_registry_aliases
                    (id, game_id, alias_name, normalized_alias, source, created_at, updated_at)
                VALUES
                    (:id, :game_id, :alias_name, :normalized_alias, 'manual-rd-map', NOW(), NOW())
                """
            ),
            {
                "id": f"alias-{uuid4().hex}",
                "game_id": target_game.id,
                "alias_name": alias_name,
                "normalized_alias": normalized_alias,
            },
        )

    if access_item_id:
        db.execute(
            sql_text(
                """
                INSERT INTO contract_access_game_links
                    (access_item_id, game_id, match_method, confirmed, confirmed_by, confirmed_at, created_at, updated_at)
                VALUES
                    (:access_item_id, :game_id, 'manual_alias_map', TRUE, 'rd-bill-ui', NOW(), NOW(), NOW())
                ON CONFLICT (access_item_id) DO UPDATE SET
                    game_id = EXCLUDED.game_id,
                    match_method = EXCLUDED.match_method,
                    confirmed = TRUE,
                    confirmed_by = EXCLUDED.confirmed_by,
                    confirmed_at = NOW(),
                    updated_at = NOW()
                """
            ),
            {"access_item_id": access_item_id, "game_id": target_game.id},
        )

    db.commit()
    return {
        "ok": True,
        "alias_name": alias_name,
        "normalized_alias": normalized_alias,
        "game_id": target_game.id,
        "canonical_name": target_game.canonical_name,
        "already_mapped": existing is not None or canonical_owner is not None,
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
