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


def _alias_map(conn, normalized_names: list[str]) -> dict[str, str]:
    keys = sorted({key for key in normalized_names if key})
    if not keys or not _relation_exists(conn, "game_registry_games"):
        return {}

    result: dict[str, str] = {}
    rows = conn.execute(
        """
        SELECT normalized_name AS normalized_alias, id AS game_id
        FROM game_registry_games
        WHERE normalized_name = ANY(%s)
        """,
        [keys],
    ).fetchall()
    for row in rows:
        result[str(row["normalized_alias"])] = str(row["game_id"])

    if _relation_exists(conn, "game_registry_aliases"):
        rows = conn.execute(
            """
            SELECT normalized_alias, game_id
            FROM game_registry_aliases
            WHERE normalized_alias = ANY(%s)
            """,
            [keys],
        ).fetchall()
        for row in rows:
            result[str(row["normalized_alias"])] = str(row["game_id"])
    return result


def enrich_lines_with_game_ids(conn, lines: list[dict]) -> list[dict]:
    normalized = [normalize_registry_game(item.get("game_name") or item.get("gameName")) for item in lines]
    aliases = _alias_map(conn, normalized)
    enriched: list[dict] = []
    for item, key in zip(lines, normalized):
        row = dict(item)
        game_id = aliases.get(key)
        if game_id:
            row["game_id"] = game_id
            row["game_identity_source"] = "registry"
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

    normalized = [normalize_registry_game(item.get("product_name")) for item in candidates]
    aliases = _alias_map(conn, normalized)

    enriched: list[dict] = []
    for item, key in zip(candidates, normalized):
        row = dict(item)
        access_id = str(row.get("access_item_id") or "")
        if access_id in explicit_links:
            row["game_id"] = explicit_links[access_id]
            row["game_identity_source"] = "access_link"
        elif aliases.get(key):
            row["game_id"] = aliases[key]
            row["game_identity_source"] = "registry_alias"
        enriched.append(row)
    return enriched
