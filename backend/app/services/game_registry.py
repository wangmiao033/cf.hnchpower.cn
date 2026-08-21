"""Build a read-only V4 game/rule preview from confirmed historical channel bills.

This module deliberately never mutates ChannelRecord or ChannelRecordLineItem. Historical
bills remain the financial source of truth; the preview is only used to propose canonical
games and channel/month rule periods for the new registry tables.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping
import re
import unicodedata

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.channel import ChannelRecord, ChannelRecordLineItem

_MONTH_RE = re.compile(r"^(20\d{2})[-年/.](0?[1-9]|1[0-2])")


def canonical_display_name(value: Any) -> str:
    """Normalize typography only; never strip edition/version suffixes."""
    text = unicodedata.normalize("NFKC", str(value or "")).strip()
    text = re.sub(r"\s+", " ", text)
    return text


def normalize_game_name(value: Any) -> str:
    """Stable exact-key normalization without semantic/fuzzy merging."""
    text = canonical_display_name(value).lower()
    text = text.replace("（", "(").replace("）", ")")
    return re.sub(r"\s+", "", text)


def normalize_month(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip()
    match = _MONTH_RE.match(text)
    if not match:
        return ""
    return f"{match.group(1)}-{int(match.group(2)):02d}"


def next_month(value: str) -> str:
    year, month = (int(part) for part in value.split("-", 1))
    if month == 12:
        return f"{year + 1:04d}-01"
    return f"{year:04d}-{month + 1:02d}"


def _decimal_text(value: Any) -> str | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return str(value).strip()
    normalized = decimal_value.quantize(Decimal("0.0001"))
    return format(normalized, "f")


def _rule_signature(row: Mapping[str, Any]) -> tuple[Any, ...]:
    return (
        _decimal_text(row.get("share_rate")),
        _decimal_text(row.get("tax_rate")),
        _decimal_text(row.get("channel_fee_rate")),
        str(row.get("settlement_rule_code") or "").strip() or None,
        str(row.get("channel_fee_mode") or "").strip() or None,
        str(row.get("tax_mode") or "").strip() or None,
    )


def _rule_payload(signature: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "share_rate": signature[0],
        "tax_rate": signature[1],
        "channel_fee_rate": signature[2],
        "settlement_rule_code": signature[3],
        "channel_fee_mode": signature[4],
        "tax_mode": signature[5],
    }


def _channel_identity(row: Mapping[str, Any]) -> tuple[str, str]:
    return (
        canonical_display_name(row.get("partner_name")),
        canonical_display_name(row.get("channel_name")),
    )


def build_history_preview(rows: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """Return proposed games/rule periods plus conflicts; input rows are never modified."""
    prepared: list[dict[str, Any]] = []
    game_display_candidates: dict[str, Counter[str]] = defaultdict(Counter)

    for raw in rows:
        game_display = canonical_display_name(raw.get("game_name"))
        game_key = normalize_game_name(game_display)
        month = normalize_month(raw.get("settlement_cycle") or raw.get("settlement_month"))
        if not game_key or not month:
            continue
        partner_name, channel_name = _channel_identity(raw)
        item = dict(raw)
        item.update(
            {
                "game_display": game_display,
                "game_key": game_key,
                "month": month,
                "partner_name": partner_name,
                "channel_name": channel_name,
            }
        )
        prepared.append(item)
        game_display_candidates[game_key][game_display] += 1

    game_meta: dict[str, dict[str, Any]] = {}
    for game_key, choices in game_display_candidates.items():
        # Most frequent exact display wins; ties are deterministic.
        canonical_name = sorted(choices.items(), key=lambda pair: (-pair[1], pair[0]))[0][0]
        game_meta[game_key] = {
            "canonical_name": canonical_name,
            "normalized_name": game_key,
            "occurrences": sum(choices.values()),
            "display_variants": [name for name, _ in sorted(choices.items(), key=lambda pair: (-pair[1], pair[0]))],
        }

    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in prepared:
        grouped[(row["partner_name"], row["channel_name"], row["game_key"])].append(row)

    rules: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    game_channels: dict[str, set[tuple[str, str]]] = defaultdict(set)

    for (partner_name, channel_name, game_key), group_rows in sorted(grouped.items()):
        game_channels[game_key].add((partner_name, channel_name))
        by_month: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in group_rows:
            by_month[row["month"]].append(row)

        monthly: list[dict[str, Any]] = []
        for month in sorted(by_month):
            month_rows = by_month[month]
            by_signature: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
            for row in month_rows:
                by_signature[_rule_signature(row)].append(row)

            if len(by_signature) > 1:
                variants = []
                for signature, variant_rows in sorted(by_signature.items(), key=lambda item: str(item[0])):
                    payload = _rule_payload(signature)
                    payload.update(
                        {
                            "count": len(variant_rows),
                            "bill_ids": sorted({str(row.get("bill_id") or "") for row in variant_rows if row.get("bill_id")}),
                        }
                    )
                    variants.append(payload)
                conflicts.append(
                    {
                        "partner_name": partner_name,
                        "channel_name": channel_name,
                        "game_name": game_meta[game_key]["canonical_name"],
                        "normalized_name": game_key,
                        "month": month,
                        "variants": variants,
                    }
                )
                continue

            signature, same_rule_rows = next(iter(by_signature.items()))
            bill_ids = sorted({str(row.get("bill_id") or "") for row in same_rule_rows if row.get("bill_id")})
            monthly.append(
                {
                    "month": month,
                    "signature": signature,
                    "bill_ids": bill_ids,
                    "source_count": len(same_rule_rows),
                }
            )

        current: dict[str, Any] | None = None
        for candidate in monthly:
            if (
                current is not None
                and candidate["signature"] == current["signature"]
                and candidate["month"] == next_month(current["end_month"])
            ):
                current["end_month"] = candidate["month"]
                current["source_months"].append(candidate["month"])
                current["source_count"] += candidate["source_count"]
                current["bill_ids"].update(candidate["bill_ids"])
                continue

            if current is not None:
                rules.append(_finalize_rule_period(current, partner_name, channel_name, game_key, game_meta))
            current = {
                "start_month": candidate["month"],
                "end_month": candidate["month"],
                "signature": candidate["signature"],
                "source_months": [candidate["month"]],
                "source_count": candidate["source_count"],
                "bill_ids": set(candidate["bill_ids"]),
            }

        if current is not None:
            rules.append(_finalize_rule_period(current, partner_name, channel_name, game_key, game_meta))

    games = []
    for game_key, meta in sorted(game_meta.items(), key=lambda item: item[1]["canonical_name"]):
        channels = sorted(game_channels.get(game_key, set()))
        games.append(
            {
                **meta,
                "channel_count": len(channels),
                "channels": [
                    {"partner_name": partner_name, "channel_name": channel_name}
                    for partner_name, channel_name in channels
                ],
            }
        )

    return {
        "summary": {
            "source_line_count": len(prepared),
            "game_count": len(games),
            "rule_period_count": len(rules),
            "conflict_count": len(conflicts),
        },
        "games": games,
        "rules": rules,
        "conflicts": conflicts,
        "safety": {
            "historical_bills_mutated": False,
            "history_is_source_of_truth": True,
            "rule_periods_only_merge_consecutive_months": True,
        },
    }


def _finalize_rule_period(
    current: dict[str, Any],
    partner_name: str,
    channel_name: str,
    game_key: str,
    game_meta: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    payload = _rule_payload(current["signature"])
    bill_ids = sorted(current["bill_ids"])
    payload.update(
        {
            "partner_name": partner_name,
            "channel_name": channel_name,
            "game_name": game_meta[game_key]["canonical_name"],
            "normalized_name": game_key,
            "start_month": current["start_month"],
            "end_month": current["end_month"],
            "source_months": list(current["source_months"]),
            "source_count": current["source_count"],
            "source_first_bill_id": bill_ids[0] if bill_ids else None,
            "source_last_bill_id": bill_ids[-1] if bill_ids else None,
        }
    )
    return payload


def load_confirmed_history_rows(
    db: Session,
    *,
    partner_name: str | None = None,
    channel_name: str | None = None,
    confirmed_only: bool = True,
) -> list[Mapping[str, Any]]:
    """Read history without touching any bill row."""
    stmt = (
        select(
            ChannelRecord.id.label("bill_id"),
            ChannelRecord.partner_name,
            ChannelRecord.channel_name,
            ChannelRecord.settlement_month,
            ChannelRecord.status.label("bill_status"),
            ChannelRecordLineItem.id.label("line_id"),
            ChannelRecordLineItem.settlement_cycle,
            ChannelRecordLineItem.game_name,
            ChannelRecordLineItem.share_rate,
            ChannelRecordLineItem.tax_rate,
            ChannelRecordLineItem.channel_fee_rate,
            ChannelRecordLineItem.settlement_rule_code,
            ChannelRecordLineItem.channel_fee_mode,
            ChannelRecordLineItem.tax_mode,
        )
        .join(ChannelRecordLineItem, ChannelRecordLineItem.channel_record_id == ChannelRecord.id)
        .where(func.coalesce(ChannelRecordLineItem.game_name, "") != "")
    )
    if confirmed_only:
        stmt = stmt.where(func.lower(func.coalesce(ChannelRecord.status, "")) == "confirmed")
    if partner_name and partner_name.strip():
        stmt = stmt.where(ChannelRecord.partner_name.ilike(f"%{partner_name.strip()}%"))
    if channel_name and channel_name.strip():
        stmt = stmt.where(ChannelRecord.channel_name.ilike(f"%{channel_name.strip()}%"))
    stmt = stmt.order_by(
        ChannelRecord.partner_name,
        ChannelRecord.channel_name,
        ChannelRecordLineItem.game_name,
        ChannelRecordLineItem.settlement_cycle,
        ChannelRecord.id,
    )
    return list(db.execute(stmt).mappings().all())


def count_legacy_channel_records_without_lines(db: Session, *, confirmed_only: bool = True) -> int:
    line_exists = select(ChannelRecordLineItem.id).where(ChannelRecordLineItem.channel_record_id == ChannelRecord.id).exists()
    stmt = select(func.count(ChannelRecord.id)).where(~line_exists, func.coalesce(ChannelRecord.game_name, "") != "")
    if confirmed_only:
        stmt = stmt.where(func.lower(func.coalesce(ChannelRecord.status, "")) == "confirmed")
    return int(db.execute(stmt).scalar_one() or 0)
