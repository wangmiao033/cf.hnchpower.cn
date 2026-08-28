"""Production contract service V17: persistent R&D game-name aliases.

V17 keeps bill-facing game names untouched while resolving contract matching through
stable game identities. Finance can map a new bill alias to an existing contract
access item once; later R&D recommendations reuse the stored game_id automatically.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import psycopg
from fastapi import HTTPException, Request
from psycopg.rows import dict_row

try:
    from . import v16_main as _v16
    from .extended_main import _candidate_rows
    from .game_identity import enrich_candidates_with_game_ids, enrich_lines_with_game_ids, normalize_registry_game
    from .matcher import commercial_game_variant
    from .rd_prepayment import enrich_prepayment_candidates
    from .rd_rule_recommender import recommend_rd_rules
    from .v4_main import _database_url, _require_permission
except ImportError:  # Vercel imports modules from the service root.
    import v16_main as _v16
    from extended_main import _candidate_rows
    from game_identity import enrich_candidates_with_game_ids, enrich_lines_with_game_ids, normalize_registry_game
    from matcher import commercial_game_variant
    from rd_prepayment import enrich_prepayment_candidates
    from rd_rule_recommender import recommend_rd_rules
    from v4_main import _database_url, _require_permission

app = _v16.app
_RD_RULE_PATH = "/api/contract-terms/rd-rule-recommendation"


def _text(value: Any, limit: int = 500) -> str:
    return str(value or "").strip()[:limit]


def _line_index(item: dict, fallback: int) -> int:
    try:
        return int(item.get("line_index", fallback))
    except (TypeError, ValueError):
        return fallback


def _find_game_for_name(conn: psycopg.Connection, name: str) -> dict | None:
    normalized = normalize_registry_game(name)
    if not normalized:
        return None
    row = conn.execute(
        """
        SELECT id, canonical_name, normalized_name
        FROM game_registry_games
        WHERE normalized_name = %s
        """,
        [normalized],
    ).fetchone()
    if row:
        return dict(row)
    row = conn.execute(
        """
        SELECT game.id, game.canonical_name, game.normalized_name
        FROM game_registry_aliases AS alias
        JOIN game_registry_games AS game ON game.id = alias.game_id
        WHERE alias.normalized_alias = %s
        """,
        [normalized],
    ).fetchone()
    return dict(row) if row else None


# V9 owns the original draft R&D recommendation route. Replace only that POST;
# every confirmation, snapshot and difference workflow from V16 remains intact.
app.router.routes[:] = [
    route
    for route in app.router.routes
    if not (
        getattr(route, "path", None) == _RD_RULE_PATH
        and "POST" in (getattr(route, "methods", None) or set())
    )
]


@app.post(_RD_RULE_PATH)
def registry_aware_rd_rule(request: Request, payload: dict) -> dict:
    _require_permission(request, "contracts.view")
    partner_name = _text(payload.get("partner_name"), 500)
    lines = [dict(item) for item in (payload.get("lines") or []) if isinstance(item, dict)]
    if not partner_name:
        raise HTTPException(status_code=422, detail="请先选择合作方，再自动匹配研发合同规则")
    if not lines:
        raise HTTPException(status_code=422, detail="请至少填写一条游戏明细")

    bill_id = _text(payload.get("bill_id"), 128)
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        resolved_lines = enrich_lines_with_game_ids(conn, lines)
        candidates = enrich_candidates_with_game_ids(
            conn,
            enrich_prepayment_candidates(
                conn,
                _candidate_rows(conn),
                exclude_bill_id=bill_id or None,
            ),
        )
        result = recommend_rd_rules(partner_name, resolved_lines, candidates)
        conn.commit()

    raw_by_index = {
        _line_index(item, position): _text(item.get("game_name") or item.get("gameName"), 500)
        for position, item in enumerate(lines)
    }
    resolved_by_index = {
        _line_index(item, position): item
        for position, item in enumerate(resolved_lines)
    }
    candidate_by_access = {
        str(item.get("access_item_id") or ""): item
        for item in candidates
        if item.get("access_item_id")
    }

    next_result_lines: list[dict] = []
    for position, source in enumerate(result.get("lines") or []):
        item = dict(source)
        index = _line_index(item, position)
        resolved = resolved_by_index.get(index) or {}
        input_name = raw_by_index.get(index) or _text(resolved.get("input_game_name") or item.get("game_name"), 500)
        canonical_name = _text(resolved.get("game_name"), 500) if resolved.get("game_id") else input_name
        item["input_game_name"] = input_name
        item["canonical_game_name"] = canonical_name
        item["game_id"] = resolved.get("game_id")
        item["game_identity_source"] = resolved.get("game_identity_source") or ""
        # Keep the visible bill name stable. Canonicalization is matching-only.
        item["game_name"] = input_name
        if isinstance(item.get("match"), dict):
            match = dict(item["match"])
            candidate = candidate_by_access.get(str(match.get("access_item_id") or "")) or {}
            match["game_id"] = candidate.get("game_id")
            match["original_product_name"] = candidate.get("original_product_name") or match.get("product_name")
            item["match"] = match
        next_result_lines.append(item)

    identity_resolved = sum(1 for item in resolved_lines if item.get("game_id"))
    return {
        **result,
        "lines": next_result_lines,
        "partner_name": partner_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "game_identity": {
            "resolved": identity_resolved,
            "total": len([item for item in lines if _text(item.get("game_name") or item.get("gameName"))]),
            "mode": "persistent-alias",
        },
    }


@app.post("/api/contract-terms/game-identities/resolve")
def resolve_game_identities(request: Request, payload: dict) -> dict:
    _require_permission(request, "contracts.view")
    names = [_text(value, 500) for value in (payload.get("names") or [])]
    names = list(dict.fromkeys(value for value in names if value))[:200]
    access_ids = [_text(value, 128) for value in (payload.get("access_item_ids") or [])]
    access_ids = list(dict.fromkeys(value for value in access_ids if value))[:300]

    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        name_rows = enrich_lines_with_game_ids(conn, [{"game_name": name} for name in names])
        access_rows: list[dict] = []
        if access_ids:
            rows = conn.execute(
                """
                SELECT id AS access_item_id, product_name
                FROM cf_contract_access_items
                WHERE id = ANY(%s)
                """,
                [access_ids],
            ).fetchall()
            by_id = {str(row["access_item_id"]): dict(row) for row in rows}
            ordered = [by_id[item] for item in access_ids if item in by_id]
            access_rows = enrich_candidates_with_game_ids(conn, ordered)

    return {
        "items": [
            {
                "input_name": name,
                "normalized_name": normalize_registry_game(name),
                "game_id": row.get("game_id"),
                "canonical_name": _text(row.get("game_name"), 500) if row.get("game_id") else "",
                "source": row.get("game_identity_source") or "unresolved",
            }
            for name, row in zip(names, name_rows)
        ],
        "access_items": [
            {
                "access_item_id": _text(row.get("access_item_id"), 128),
                "product_name": _text(row.get("original_product_name") or row.get("product_name"), 500),
                "game_id": row.get("game_id"),
                "canonical_name": _text(row.get("product_name"), 500) if row.get("game_id") else "",
                "source": row.get("game_identity_source") or "unresolved",
            }
            for row in access_rows
        ],
    }


@app.post("/api/contract-terms/game-identities/alias")
def save_game_identity_alias(request: Request, payload: dict) -> dict:
    actor = _require_permission(request, "contracts.manage")
    alias_name = _text(payload.get("alias_name"), 500)
    access_item_id = _text(payload.get("access_item_id"), 128)
    if not alias_name:
        raise HTTPException(status_code=422, detail="请输入需要映射的账单游戏名称")
    if not access_item_id:
        raise HTTPException(status_code=422, detail="请选择要映射到的合同合作游戏")

    alias_normalized = normalize_registry_game(alias_name)
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        access = conn.execute(
            """
            SELECT id, product_name
            FROM cf_contract_access_items
            WHERE id = %s
            """,
            [access_item_id],
        ).fetchone()
        if access is None:
            raise HTTPException(status_code=404, detail="所选合同合作游戏不存在，请重新读取合同")

        product_name = _text(access.get("product_name"), 500)
        alias_variant = commercial_game_variant(alias_name)
        product_variant = commercial_game_variant(product_name)
        if alias_variant and product_variant and alias_variant != product_variant:
            raise HTTPException(
                status_code=409,
                detail=f"商业折扣版本不同：账单为 {alias_variant}，合同为 {product_variant}，不能建立同一游戏映射。",
            )

        linked = conn.execute(
            """
            SELECT game.id, game.canonical_name, game.normalized_name
            FROM contract_access_game_links AS link
            JOIN game_registry_games AS game ON game.id = link.game_id
            WHERE link.access_item_id = %s
            """,
            [access_item_id],
        ).fetchone()
        game = dict(linked) if linked else _find_game_for_name(conn, product_name)
        if game is None:
            game = {
                "id": f"game-{uuid4().hex}",
                "canonical_name": product_name,
                "normalized_name": normalize_registry_game(product_name),
            }
            conn.execute(
                """
                INSERT INTO game_registry_games
                  (id, canonical_name, normalized_name, status, source, created_at, updated_at)
                VALUES (%s, %s, %s, 'active', 'rd-manual-map', NOW(), NOW())
                """,
                [game["id"], game["canonical_name"], game["normalized_name"]],
            )

        canonical_collision = conn.execute(
            """
            SELECT id, canonical_name
            FROM game_registry_games
            WHERE normalized_name = %s AND id <> %s
            """,
            [alias_normalized, game["id"]],
        ).fetchone()
        if canonical_collision:
            raise HTTPException(
                status_code=409,
                detail=f"“{alias_name}”已经是另一个标准游戏“{canonical_collision['canonical_name']}”，请先在游戏库处理合并关系。",
            )

        alias_collision = conn.execute(
            """
            SELECT alias.game_id, game.canonical_name
            FROM game_registry_aliases AS alias
            JOIN game_registry_games AS game ON game.id = alias.game_id
            WHERE alias.normalized_alias = %s
            """,
            [alias_normalized],
        ).fetchone()
        if alias_collision and str(alias_collision["game_id"]) != str(game["id"]):
            raise HTTPException(
                status_code=409,
                detail=f"“{alias_name}”已经映射到“{alias_collision['canonical_name']}”，为避免串账未自动改绑。",
            )

        if alias_normalized != str(game.get("normalized_name") or ""):
            conn.execute(
                """
                INSERT INTO game_registry_aliases
                  (id, game_id, alias_name, normalized_alias, source, created_at, updated_at)
                VALUES (%s, %s, %s, %s, 'rd-manual-map', NOW(), NOW())
                ON CONFLICT (normalized_alias)
                DO UPDATE SET
                  alias_name = EXCLUDED.alias_name,
                  source = 'rd-manual-map',
                  updated_at = NOW()
                """,
                [f"alias-{uuid4().hex}", game["id"], alias_name, alias_normalized],
            )

        conn.execute(
            """
            INSERT INTO contract_access_game_links
              (access_item_id, game_id, match_method, confirmed, confirmed_by, confirmed_at, created_at, updated_at)
            VALUES (%s, %s, 'manual_alias', TRUE, %s, NOW(), NOW(), NOW())
            ON CONFLICT (access_item_id)
            DO UPDATE SET
              game_id = EXCLUDED.game_id,
              match_method = 'manual_alias',
              confirmed = TRUE,
              confirmed_by = EXCLUDED.confirmed_by,
              confirmed_at = NOW(),
              updated_at = NOW()
            """,
            [access_item_id, game["id"], _text(actor, 200)],
        )
        conn.commit()

    return {
        "ok": True,
        "alias_name": alias_name,
        "game_id": str(game["id"]),
        "canonical_name": _text(game["canonical_name"], 500),
        "access_item_id": access_item_id,
        "contract_product_name": product_name,
        "message": f"已记住：{alias_name} → {game['canonical_name']}。以后自动按同一游戏识别。",
    }
