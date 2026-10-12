"""Legal-entity identity resolution, separate from contract/settlement calculations.

Customer IDs remain stable. Payment identities are resolved by the *revenue month*,
not by the date the bank transfer happened. This module never writes a bill.
"""
from __future__ import annotations

import re
from calendar import monthrange
from datetime import date

from sqlalchemy import text

ROLES = ("contract", "payer", "invoice")
MONTH_PATTERN = re.compile(r"^[0-9]{4}-(0[1-9]|1[0-2])$")


def normalized_legal_name(value: object) -> str:
    """Normalize display punctuation without equating unrelated legal entities."""
    name = str(value or "").strip().lower().replace("（", "(").replace("）", ")")
    return re.sub(r"[\s\u3000]", "", name)


def normalized_bank_account(value: object) -> str:
    return re.sub(r"[^0-9a-zA-Z]", "", str(value or "")).lower()


def valid_month(value: object) -> str:
    month = str(value or "").strip()
    if not MONTH_PATTERN.fullmatch(month):
        raise ValueError("账期必须是 YYYY-MM")
    return month


def month_before(month: str) -> str:
    y, m = map(int, valid_month(month).split("-"))
    if y == 1 and m == 1:
        raise ValueError("无法再向前计算月份")
    return f"{y - 1:04d}-12" if m == 1 else f"{y:04d}-{m - 1:02d}"


def overlaps(a_start: str, a_end: str | None, b_start: str, b_end: str | None) -> bool:
    return (a_end is None or a_end >= b_start) and (b_end is None or b_end >= a_start)


def plan_period_insert(existing: list[dict], month: str, end_month: str | None) -> tuple[str | None, list[tuple[str, str]]]:
    """Return (effective end for new rule, updates to earlier open rules).

    Called with the owning customer row locked FOR UPDATE; concurrent overlapping
    rule creation for a customer is thus serialized at the database level.
    """
    month = valid_month(month)
    end_month = valid_month(end_month) if end_month else None
    if end_month and end_month < month:
        raise ValueError("结束账期不能早于开始账期")
    shorten: list[tuple[str, str]] = []
    for item in existing:
        start, end = valid_month(item["effective_month"]), item["end_month"]
        end = valid_month(end) if end else None
        if start == month:
            raise ValueError("该角色在这一生效月份已有规则，请检查现有配置")
        if start > month:
            if end_month is None:
                # Backfilling an earlier rule: end it before the next known switch.
                end_month = month_before(start)
            if end_month >= start:
                raise ValueError("所选生效区间与之后的主体规则重叠")
        elif (end is None or end >= month):
            # Switching from a preceding rule: retain its complete history.
            shorten.append((str(item["id"]), month_before(month)))
    return end_month, shorten


def entity_links(db, partner_id: str) -> list[dict]:
    return [dict(item) for item in db.execute(
        text("""
            SELECT link.id, link.partner_id, link.entity_id, link.role,
                   link.effective_month, link.end_month, link.note,
                   entity.legal_name, entity.tax_registration_no
              FROM cf_partner_legal_entity_links AS link
              JOIN cf_legal_entities AS entity ON entity.id = link.entity_id
             WHERE link.partner_id = :partner_id
             ORDER BY link.role, link.effective_month, entity.legal_name
        """), {"partner_id": partner_id},
    ).mappings().all()]


def role_at_month(links: list[dict], role: str, month: str) -> dict | None:
    valid_month(month)
    matching = [
        item for item in links
        if item["role"] == role
        and item["effective_month"] <= month
        and (not item["end_month"] or item["end_month"] >= month)
    ]
    if len(matching) > 1:
        raise ValueError("主体规则有重叠区间，请先修复客户主体配置")
    return matching[0] if matching else None


def resolve_months(links: list[dict], months: list[str]) -> dict:
    """Resolve each role only if every billed month has the same entity."""
    months = sorted({valid_month(month) for month in months if month})
    result = {}
    for role in ROLES:
        found = [role_at_month(links, role, month) for month in months]
        ids = {row["entity_id"] if row else None for row in found}
        result[role] = found[0] if len(ids) == 1 and found else None
        result[f"{role}_mixed"] = len(ids) > 1
    return result


def party_identity(db, partner_id: str, months: list[str]) -> dict:
    return resolve_months(entity_links(db, partner_id), months)
