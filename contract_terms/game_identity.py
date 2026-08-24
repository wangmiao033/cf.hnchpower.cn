"""Stable game identity bridge shared by contract recommendation flows.

The registry is intentionally exact: formatting aliases may collapse to one game_id,
while commercial/version suffixes remain part of the identity unless a user creates
an explicit alias/link. Historical financial fields are never mutated here.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any


def normalize_registry_game(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    text = text.replace("（", "(").replace("）", ")")
    return re.sub(r"\s+", "", text)


def _relation_exists(conn, name: str) -> bool:
    row = conn.execute("SELECT to_regclass(%s) AS name", [f"public.{name}"]).fetchone()
    return bool(row and row.get("name"))


def _identity_map(conn, normalized_names: list[str]) -> dict[str, dict[str, str]]:
    keys = sorted({key for key in normalized_names if key})
    if not keys or not _relation_exists(conn, "game_registry_games"):
        return {}

    result: dict[str, dict[str, str]] = {}
    rows = conn.execute(
        """
        SELECT normalized_name AS normalized_alias, id AS game_id, canonical_name
        FROM game_registry_games
        WHERE normalized_name = ANY(%s)
        """,
        [keys],
    ).fetchall()
    for row in rows:
        result[str(row["normalized_alias"])] = {
            "game_id": str(row["game_id"]),
            "canonical_name": str(row["canonical_name"] or ""),
        }

    if _relation_exists(conn, "game_registry_aliases"):
        rows = conn.execute(
            """
            SELECT alias.normalized_alias, alias.game_id, game.canonical_name
            FROM game_registry_aliases AS alias
            JOIN game_registry_games AS game ON game.id = alias.game_id
            WHERE alias.normalized_alias = ANY(%s)
            """,
            [keys],
        ).fetchall()
        for row in rows:
            result[str(row["normalized_alias"])] = {
                "game_id": str(row["game_id"]),
                "canonical_name": str(row["canonical_name"] or ""),
            }
    return result


def _games_by_id(conn, game_ids: list[str]) -> dict[str, str]:
    ids = sorted({str(value or "").strip() for value in game_ids if str(value or "").strip()})
    if not ids or not _relation_exists(conn, "game_registry_games"):
        return {}
    rows = conn.execute(
        """
        SELECT id, canonical_name
        FROM game_registry_games
        WHERE id = ANY(%s)
        """,
        [ids],
    ).fetchall()
    return {str(row["id"]): str(row["canonical_name"] or "") for row in rows}


def enrich_lines_with_game_ids(conn, lines: list[dict]) -> list[dict]:
    normalized = [normalize_registry_game(item.get("game_name") or item.get("gameName")) for item in lines]
    identities = _identity_map(conn, normalized)
    enriched: list[dict] = []
    for item, key in zip(lines, normalized):
        row = dict(item)
        identity = identities.get(key)
        if identity:
            original_name = str(row.get("game_name") or row.get("gameName") or "")
            row["input_game_name"] = original_name
            row["game_id"] = identity["game_id"]
            row["game_identity_source"] = "registry"
            if identity["canonical_name"]:
                row["game_name"] = identity["canonical_name"]
        enriched.append(row)
    return enriched


def enrich_candidates_with_game_ids(conn, candidates: list[dict]) -> list[dict]:
    if not candidates:
        return []

    access_ids = [str(item.get("access_item_id") or "") for item in candidates]
    access_ids = [item for item in access_ids if item]
    explicit_links: dict[str, str] = {}
    if access_ids and _relation_exists(conn, "contract_access_game_links"):
        rows = conn.execute(
            """
            SELECT access_item_id, game_id
            FROM contract_access_game_links
            WHERE access_item_id = ANY(%s)
            """,
            [access_ids],
        ).fetchall()
        explicit_links = {str(row["access_item_id"]): str(row["game_id"]) for row in rows}

    linked_names = _games_by_id(conn, list(explicit_links.values()))
    normalized = [normalize_registry_game(item.get("product_name")) for item in candidates]
    identities = _identity_map(conn, normalized)

    enriched: list[dict] = []
    for item, key in zip(candidates, normalized):
        row = dict(item)
        original_name = str(row.get("product_name") or "")
        access_id = str(row.get("access_item_id") or "")
        game_id = explicit_links.get(access_id)
        if game_id:
            row["original_product_name"] = original_name
            row["game_id"] = game_id
            row["game_identity_source"] = "access_link"
            canonical = linked_names.get(game_id)
            if canonical:
                row["product_name"] = canonical
        else:
            identity = identities.get(key)
            if identity:
                row["original_product_name"] = original_name
                row["game_id"] = identity["game_id"]
                row["game_identity_source"] = "registry_alias"
                if identity["canonical_name"]:
                    row["product_name"] = identity["canonical_name"]
        enriched.append(row)
    return enriched
