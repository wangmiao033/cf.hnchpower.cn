"""Persist customer-library links for research reconciliation records.

The schema is provisioned by versioned migration 052. Runtime API requests must
remain schema-DDL-free; all structural changes belong in versioned migrations.
"""

from __future__ import annotations

from collections.abc import Iterable

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session


def _name_key(value: object) -> str:
    return (
        str(value or "")
        .strip()
        .lower()
        .replace("（", "(")
        .replace("）", ")")
        .replace(" ", "")
    )


def resolve_partner(
    db: Session,
    *,
    partner_id: str | None = None,
    partner_name: str | None = None,
) -> dict | None:
    requested_id = str(partner_id or "").strip()
    if requested_id:
        row = (
            db.execute(
                text(
                    """
                    SELECT id, name, short_name
                    FROM cf_partner_records
                    WHERE id = :partner_id
                    """
                ),
                {"partner_id": requested_id},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    key = _name_key(partner_name)
    if not key:
        return None
    row = (
        db.execute(
            text(
                """
                SELECT id, name, short_name
                FROM cf_partner_records
                WHERE normalized_name = :name_key
                """
            ),
            {"name_key": key},
        )
        .mappings()
        .first()
    )
    if row:
        return dict(row)

    rows = (
        db.execute(
            text(
                """
                SELECT id, name, short_name
                FROM cf_partner_records
                WHERE short_name <> ''
                """
            )
        )
        .mappings()
        .all()
    )
    matches = [dict(item) for item in rows if _name_key(item["short_name"]) == key]
    return matches[0] if len(matches) == 1 else None


def save_partner_link(
    db: Session,
    *,
    reconciliation_id: str,
    partner_id: str | None,
    partner_name: str | None,
) -> dict | None:
    selected = resolve_partner(
        db,
        partner_id=partner_id,
        partner_name=None if partner_id else partner_name,
    )
    if partner_id and selected is None:
        raise HTTPException(status_code=422, detail="所选客户不存在，请刷新客户库后重试")
    if selected is None:
        db.execute(
            text(
                """
                DELETE FROM cf_reconciliation_partner_links
                WHERE reconciliation_id = :reconciliation_id
                """
            ),
            {"reconciliation_id": reconciliation_id},
        )
        return None

    db.execute(
        text(
            """
            INSERT INTO cf_reconciliation_partner_links (
              reconciliation_id, partner_id, partner_name_snapshot, match_method
            )
            VALUES (:reconciliation_id, :partner_id, :snapshot, :match_method)
            ON CONFLICT (reconciliation_id) DO UPDATE SET
              partner_id = EXCLUDED.partner_id,
              partner_name_snapshot = EXCLUDED.partner_name_snapshot,
              match_method = EXCLUDED.match_method,
              updated_at = NOW()
            """
        ),
        {
            "reconciliation_id": reconciliation_id,
            "partner_id": selected["id"],
            "snapshot": str(partner_name or selected["name"]).strip(),
            "match_method": "selected" if partner_id else "exact_name",
        },
    )
    return selected


def load_partner_links(db: Session, record_ids: Iterable[str]) -> dict[str, dict]:
    ids = [str(item) for item in record_ids if item]
    if not ids:
        return {}
    rows = (
        db.execute(
            text(
                """
                SELECT
                  link.reconciliation_id,
                  link.partner_id,
                  link.partner_name_snapshot,
                  link.match_method,
                  partner.name,
                  partner.short_name
                FROM cf_reconciliation_partner_links AS link
                JOIN cf_partner_records AS partner ON partner.id = link.partner_id
                WHERE link.reconciliation_id = ANY(:record_ids)
                """
            ),
            {"record_ids": ids},
        )
        .mappings()
        .all()
    )
    return {str(row["reconciliation_id"]): dict(row) for row in rows}


def delete_partner_link(db: Session, reconciliation_id: str) -> None:
    db.execute(
        text(
            """
            DELETE FROM cf_reconciliation_partner_links
            WHERE reconciliation_id = :reconciliation_id
            """
        ),
        {"reconciliation_id": reconciliation_id},
    )
