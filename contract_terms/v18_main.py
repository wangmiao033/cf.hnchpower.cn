"""Production contract service V18: safe explicit alias reassignment.

History bootstrap may already have created a standalone game identity for a spelling
that finance now confirms is an alias of an existing contract game. V18 lets that
explicit confirmation override bootstrap aliases without rewriting historical bill
names or financial amounts, while protecting aliases that were already manually set.
"""

from __future__ import annotations

from uuid import uuid4

import psycopg
from fastapi import HTTPException, Request
from psycopg.rows import dict_row

try:
    from . import v17_main as _v17
    from .game_identity import normalize_registry_game
    from .matcher import commercial_game_variant
    from .v4_main import _database_url, _require_permission
except ImportError:  # Vercel imports modules from the service root.
    import v17_main as _v17
    from game_identity import normalize_registry_game
    from matcher import commercial_game_variant
    from v4_main import _database_url, _require_permission

app = _v17.app
_ALIAS_PATH = "/api/contract-terms/game-identities/alias"

app.router.routes[:] = [
    route
    for route in app.router.routes
    if not (
        getattr(route, "path", None) == _ALIAS_PATH
        and "POST" in (getattr(route, "methods", None) or set())
    )
]


@app.post(_ALIAS_PATH)
def save_game_identity_alias_v18(request: Request, payload: dict) -> dict:
    actor = _require_permission(request, "contracts.manage")
    alias_name = _v17._text(payload.get("alias_name"), 500)
    access_item_id = _v17._text(payload.get("access_item_id"), 128)
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

        product_name = _v17._text(access.get("product_name"), 500)
        if not product_name:
            raise HTTPException(status_code=422, detail="所选合同合作清单没有游戏名称，暂不能建立映射")

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
        game = dict(linked) if linked else _v17._find_game_for_name(conn, product_name)
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

        existing_alias = conn.execute(
            """
            SELECT alias.game_id, alias.source, game.canonical_name
            FROM game_registry_aliases AS alias
            JOIN game_registry_games AS game ON game.id = alias.game_id
            WHERE alias.normalized_alias = %s
            """,
            [alias_normalized],
        ).fetchone()
        if existing_alias and str(existing_alias["game_id"]) != str(game["id"]):
            source = str(existing_alias.get("source") or "")
            if source in {"manual", "rd-manual-map"}:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"“{alias_name}”已经人工映射到“{existing_alias['canonical_name']}”。"
                        "为避免串账，本次没有覆盖；如确需合并请在游戏库统一处理。"
                    ),
                )

        # Always persist the alias row. If history-bootstrap created a standalone
        # canonical identity with the same normalized spelling, _identity_map reads
        # aliases after canonical names, so this explicit manual alias becomes the
        # authoritative matching identity without mutating historical text.
        conn.execute(
            """
            INSERT INTO game_registry_aliases
              (id, game_id, alias_name, normalized_alias, source, created_at, updated_at)
            VALUES (%s, %s, %s, %s, 'rd-manual-map', NOW(), NOW())
            ON CONFLICT (normalized_alias)
            DO UPDATE SET
              game_id = EXCLUDED.game_id,
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
            [access_item_id, game["id"], _v17._text(actor, 200)],
        )
        conn.commit()

    return {
        "ok": True,
        "alias_name": alias_name,
        "game_id": str(game["id"]),
        "canonical_name": _v17._text(game["canonical_name"], 500),
        "access_item_id": access_item_id,
        "contract_product_name": product_name,
        "message": f"已记住：{alias_name} → {game['canonical_name']}。以后自动按同一游戏识别。",
    }
