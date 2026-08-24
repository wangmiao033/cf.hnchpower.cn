"""Contract-first fallback to maintained game/channel/month rules.

The channel bill rule engine keeps structured contract access items as the first
source of truth. When no contract access item matches a precise game/month line,
an active rule from ``channel_game_rules`` may fill the settlement-driving fields.
This makes the V4 game registry useful without allowing historical/default values
to override an actual contract match.
"""

from __future__ import annotations

import re
from typing import Any

try:
    from .matcher import normalize_channel, normalize_company
except ImportError:  # Vercel service-root import.
    from matcher import normalize_channel, normalize_company

_BLOCKED_STATUSES = {
    "disabled",
    "inactive",
    "archived",
    "void",
    "voided",
    "cancelled",
    "canceled",
    "停用",
    "已停用",
    "禁用",
    "已禁用",
    "作废",
    "已作废",
    "取消",
    "已取消",
    "归档",
    "已归档",
}


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def _month_key(value: Any) -> str:
    match = re.search(r"(20\d{2})\D{0,3}(1[0-2]|0?[1-9])(?:\D|$)", str(value or "").strip())
    if not match:
        return ""
    return f"{match.group(1)}-{int(match.group(2)):02d}"


def _relation_exists(conn, name: str) -> bool:
    row = conn.execute("SELECT to_regclass(%s) AS name", [f"public.{name}"]).fetchone()
    return bool(row and row.get("name"))


def load_game_registry_rules(conn) -> list[dict]:
    """Load active V4 game rules if the registry tables exist."""
    if not _relation_exists(conn, "channel_game_rules") or not _relation_exists(conn, "game_registry_games"):
        return []
    rows = conn.execute(
        """
        SELECT
          rule.id,
          rule.game_id,
          game.canonical_name AS game_name,
          rule.partner_name,
          rule.channel_name,
          rule.start_month,
          rule.end_month,
          rule.share_rate,
          rule.tax_rate,
          rule.channel_fee_rate,
          rule.settlement_rule_code,
          rule.channel_fee_mode,
          rule.tax_mode,
          rule.source,
          rule.source_month_count,
          rule.status
        FROM channel_game_rules AS rule
        JOIN game_registry_games AS game ON game.id = rule.game_id
        ORDER BY rule.partner_name, rule.channel_name, game.canonical_name, rule.start_month DESC
        """
    ).fetchall()
    return [dict(row) for row in rows]


def _text_matches(left: Any, right: Any, normalizer, *, floor: int) -> bool:
    a = normalizer(left)
    b = normalizer(right)
    if not a or not b:
        return True
    if a == b:
        return True
    return min(len(a), len(b)) >= floor and (a in b or b in a)


def _rule_active(rule: dict) -> bool:
    return str(rule.get("status") or "active").strip().lower() not in _BLOCKED_STATUSES


def _rule_covers_month(rule: dict, month: str) -> bool:
    if not month:
        return False
    start = _month_key(rule.get("start_month"))
    end = _month_key(rule.get("end_month"))
    if start and month < start:
        return False
    if end and month > end:
        return False
    return bool(start or end)


def _rule_signature(rule: dict) -> tuple:
    return (
        _number(rule.get("share_rate")),
        _number(rule.get("tax_rate")),
        _number(rule.get("channel_fee_rate")),
        str(rule.get("settlement_rule_code") or "").strip(),
        str(rule.get("channel_fee_mode") or "").strip(),
        str(rule.get("tax_mode") or "").strip(),
    )


def _source_rank(rule: dict) -> int:
    source = str(rule.get("source") or "").strip().lower()
    if source == "manual":
        return 3
    if "confirm" in source:
        return 2
    if "history" in source:
        return 1
    return 0


def _recommended(rule: dict) -> dict | None:
    share = _number(rule.get("share_rate"))
    if share is None:
        return None
    fee = _number(rule.get("channel_fee_rate"))
    mode = str(rule.get("channel_fee_mode") or "").strip()
    if not mode:
        mode = "percent" if fee not in (None, 0) else "none"
    fee_value = 0.0 if mode == "none" and fee is None else fee
    tax = _number(rule.get("tax_rate"))
    tax_mode = str(rule.get("tax_mode") or "").strip() or "none"
    rule_code = str(rule.get("settlement_rule_code") or "").strip()
    if not rule_code:
        rule_code = "share_only" if mode == "none" else "custom"
    return {
        "settlement_rule_code": rule_code,
        "channel_fee_mode": mode,
        "channel_fee_rate": fee_value,
        "tax_mode": tax_mode,
        "tax_rate": 0.0 if tax is None else tax,
        "share_rate": share,
        "validation_tolerance": 0.05,
    }


def _synthetic_match(rule: dict) -> dict:
    return {
        "contract_id": None,
        "contract_name": "游戏库规则（合同未命中兜底）",
        "contract_no": None,
        "access_item_id": None,
        "product_name": rule.get("game_name") or "",
        "channel_name": rule.get("channel_name") or "",
        "authorization_start": rule.get("start_month"),
        "authorization_end": rule.get("end_month"),
        "share_rate": rule.get("share_rate"),
        "channel_fee_rate": rule.get("channel_fee_rate"),
        "invoice_tax_rate": rule.get("tax_rate"),
        "settlement_mode": None,
        "settlement_basis": None,
        "payment_terms": None,
        "access_status": rule.get("status") or "active",
        "performance_status": "game_registry",
        "reasons": [
            "具体合同合作清单未命中",
            "已按游戏库维护的游戏 + 渠道 + 账期规则兜底",
        ],
    }


def _matching_registry_rules(
    partner_name: str,
    channel_name: str,
    line: dict,
    rules: list[dict],
) -> list[dict]:
    game_id = str(line.get("game_id") or "").strip()
    month = _month_key(line.get("settlement_cycle") or line.get("settlementCycle"))
    if not game_id or not month:
        return []
    matched = []
    for rule in rules:
        if str(rule.get("game_id") or "").strip() != game_id:
            continue
        if not _rule_active(rule) or not _rule_covers_month(rule, month):
            continue
        if not _text_matches(partner_name, rule.get("partner_name"), normalize_company, floor=5):
            continue
        if not _text_matches(channel_name, rule.get("channel_name"), normalize_channel, floor=3):
            continue
        matched.append(rule)
    matched.sort(
        key=lambda rule: (
            _source_rank(rule),
            _month_key(rule.get("start_month")),
            int(rule.get("source_month_count") or 0),
        ),
        reverse=True,
    )
    return matched


def _preferred_registry_rules(candidates: list[dict]) -> list[dict]:
    """Prefer explicit/manual and later-effective rules before checking conflicts.

    A manual rule entered for a newer period must not be treated as a conflict
    with an older history-derived open interval that also happens to cover the
    same month. Only rules at the highest authority and latest effective start
    are compared for financial consensus.
    """
    if not candidates:
        return []
    max_source = max(_source_rank(rule) for rule in candidates)
    source_pool = [rule for rule in candidates if _source_rank(rule) == max_source]
    latest_start = max((_month_key(rule.get("start_month")) for rule in source_pool), default="")
    if not latest_start:
        return source_pool
    latest_pool = [rule for rule in source_pool if _month_key(rule.get("start_month")) == latest_start]
    return latest_pool or source_pool


def _rebuild_header(result: dict) -> None:
    rows = list(result.get("lines") or [])
    recommended_rows = [item for item in rows if item.get("recommended")]
    auto_rows = [item for item in rows if item.get("auto_apply") and item.get("recommended")]
    result["matched_lines"] = len(recommended_rows)
    result["total_lines"] = len(rows)
    result["header_recommendation"] = None
    result["auto_apply"] = False
    if not rows or len(auto_rows) != len(rows):
        return
    signatures = {
        (
            item["recommended"].get("settlement_rule_code"),
            item["recommended"].get("channel_fee_mode"),
            item["recommended"].get("channel_fee_rate"),
            item["recommended"].get("tax_mode"),
        )
        for item in auto_rows
    }
    if len(signatures) != 1:
        return
    first = auto_rows[0]["recommended"]
    result["header_recommendation"] = {
        "settlement_rule_code": first.get("settlement_rule_code") or "custom",
        "channel_fee_mode": first.get("channel_fee_mode") or "none",
        "channel_fee_rate": first.get("channel_fee_rate"),
        "tax_mode": first.get("tax_mode") or "none",
        "validation_tolerance": first.get("validation_tolerance", 0.05),
    }
    result["auto_apply"] = True


def apply_game_registry_fallback(
    result: dict,
    *,
    partner_name: str,
    channel_name: str,
    lines: list[dict],
    registry_rules: list[dict],
) -> dict:
    """Fill only lines that have no contract match at all.

    Contract ambiguity, incomplete contract fields, and out-of-period contract
    matches remain review items and are never overwritten by the game registry.
    """
    out = dict(result or {})
    by_index: dict[int, dict] = {}
    for index, raw in enumerate(lines or []):
        source_index = raw.get("line_index", index)
        try:
            source_index = int(source_index)
        except (TypeError, ValueError):
            source_index = index
        by_index[source_index] = raw

    fallback_count = 0
    conflict_count = 0
    diagnostics: list[str] = []
    next_rows: list[dict] = []

    for original in list(out.get("lines") or []):
        item = dict(original)
        game_name = str(item.get("game_name") or "").strip() or "未命名游戏"
        if item.get("auto_apply") and item.get("recommended"):
            item.setdefault("rule_source", "contract")
            diagnostics.append(f"{game_name}：合同规则已应用")
            next_rows.append(item)
            continue
        # A real contract candidate exists: keep contract authority and require review.
        if item.get("match"):
            diagnostics.append(f"{game_name}：{item.get('message') or '合同候选需确认'}")
            next_rows.append(item)
            continue

        source_line = by_index.get(int(item.get("line_index") or 0), {})
        candidates = _preferred_registry_rules(
            _matching_registry_rules(partner_name, channel_name, source_line, registry_rules)
        )
        if not candidates:
            reason = "游戏库也未找到同一游戏/渠道/账期的有效规则"
            if not str(source_line.get("game_id") or "").strip():
                reason = "游戏名称尚未关联到游戏库身份/别名"
            item["message"] = f"{item.get('message') or '合同未命中'}；{reason}"
            diagnostics.append(f"{game_name}：{reason}")
            next_rows.append(item)
            continue

        signatures = {_rule_signature(rule) for rule in candidates if _recommended(rule) is not None}
        if len(signatures) != 1:
            conflict_count += 1
            item["message"] = "合同未命中；游戏库存在多个同优先级、同生效月份且结算数字不同的规则，需要先整理规则"
            diagnostics.append(f"{game_name}：游戏库规则冲突，需整理")
            next_rows.append(item)
            continue

        chosen = next((rule for rule in candidates if _recommended(rule) is not None), None)
        recommendation = _recommended(chosen or {})
        if chosen is None or recommendation is None:
            item["message"] = "合同未命中；游戏库已找到规则，但分成比例为空"
            diagnostics.append(f"{game_name}：游戏库分成比例为空")
            next_rows.append(item)
            continue

        fallback_count += 1
        item.update(
            {
                "auto_apply": True,
                "confidence": "high",
                "score": max(float(item.get("score") or 0), 90.0),
                "authorization_status": "covered",
                "authorization_warning": False,
                "tax_rate_warning": chosen.get("tax_rate") in (None, ""),
                "rule_fields_complete": True,
                "financially_unambiguous": True,
                "contract_identity_unambiguous": False,
                "rule_consensus": True,
                "message": (
                    "具体合同合作清单未命中；已使用游戏库中维护的游戏 + 渠道 + 账期规则自动带入"
                    f"（分成 {recommendation['share_rate']:g}%）"
                ),
                "match": _synthetic_match(chosen),
                "recommended": recommendation,
                "rule_source": "game_registry",
                "registry_rule": {
                    "id": chosen.get("id"),
                    "source": chosen.get("source"),
                    "start_month": chosen.get("start_month"),
                    "end_month": chosen.get("end_month"),
                    "game_id": chosen.get("game_id"),
                },
            }
        )
        diagnostics.append(f"{game_name}：游戏库规则已应用，分成 {recommendation['share_rate']:g}%")
        next_rows.append(item)

    out["lines"] = next_rows
    out["registry_fallback_count"] = fallback_count
    out["registry_conflict_count"] = conflict_count
    out["line_diagnostics"] = diagnostics
    if fallback_count:
        out["version"] = "contract-channel-rule-v3.0"
        if out.get("partner_rule_status") == "none":
            out["partner_rule_status"] = "registry"
        out["message"] = "合同优先；合同未命中的明细已继续检查游戏库。" + "；".join(diagnostics)
    elif diagnostics and next_rows:
        out["message"] = f"{out.get('message') or '合同规则未完全匹配'}；" + "；".join(diagnostics)
    _rebuild_header(out)
    return out
