"""Recommend channel-bill settlement fields from structured contract access items."""

from __future__ import annotations

from typing import Any

try:
    from .matcher import score_candidate
except ImportError:  # Vercel service-root import.
    from matcher import score_candidate

EPS = 0.01


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def _rule_fields(candidate: dict) -> dict:
    fee = _number(candidate.get("channel_fee_rate"))
    tax = _number(candidate.get("invoice_tax_rate"))
    if fee is None or fee <= EPS:
        rule_code = "share_only"
        fee_mode = "none"
        fee_value = 0.0
    elif abs(fee - 5.0) <= EPS:
        rule_code = "five_percent_gateway_share"
        fee_mode = "percent"
        fee_value = round(fee, 4)
    else:
        rule_code = "custom"
        fee_mode = "percent"
        fee_value = round(fee, 4)

    return {
        "settlement_rule_code": rule_code,
        "channel_fee_mode": fee_mode,
        "channel_fee_rate": fee_value,
        # invoice_tax_rate is an invoice attribute, not evidence that tax should
        # reduce settlement.  Record it on the line, but default calculation to
        # "not participating" unless the user explicitly changes the rule.
        "tax_mode": "none",
        "tax_rate": round(tax, 4) if tax is not None else None,
        "share_rate": _number(candidate.get("share_rate")),
        "validation_tolerance": 0.05,
    }


def recommend_channel_rules(
    partner_name: str,
    channel_name: str,
    lines: list[dict],
    candidates: list[dict],
) -> dict:
    """Return high-confidence contract recommendations for a draft channel bill.

    Header fields are auto-applicable only when every entered line has a unique
    high-confidence match and all matched access items agree on the settlement
    rule.  Per-line share/tax fields remain visible even when header rules are
    ambiguous so the UI can explain why it did not auto-apply.
    """
    results: list[dict] = []
    for index, raw in enumerate(lines or []):
        game_name = str(raw.get("game_name") or raw.get("gameName") or "").strip()
        cycle = str(raw.get("settlement_cycle") or raw.get("settlementCycle") or "").strip()
        if not game_name:
            continue
        bill = {
            "partner_name": partner_name,
            "channel_name": channel_name,
            "settlement_month": cycle,
        }
        line = {
            "line_id": str(raw.get("line_id") or raw.get("id") or f"draft-{index}"),
            "game_name": game_name,
            "settlement_cycle": cycle,
        }
        ranked: list[tuple[dict, dict]] = []
        for candidate in candidates:
            score = score_candidate(bill, line, candidate)
            if score.get("eligible"):
                ranked.append((candidate, score))
        ranked.sort(key=lambda item: float(item[1].get("score") or 0), reverse=True)
        if not ranked:
            results.append(
                {
                    "line_index": index,
                    "game_name": game_name,
                    "settlement_cycle": cycle,
                    "auto_apply": False,
                    "confidence": "none",
                    "score": 0,
                    "message": "未找到匹配的合同合作清单",
                    "match": None,
                    "recommended": None,
                }
            )
            continue

        candidate, scored = ranked[0]
        second_score = float(ranked[1][1].get("score") or 0) if len(ranked) > 1 else 0.0
        top_score = float(scored.get("score") or 0)
        margin = round(top_score - second_score, 1)
        auto_apply = (
            scored.get("confidence") == "high"
            and scored.get("authorization_status") == "covered"
            and margin >= 10
        )
        recommended = _rule_fields(candidate)
        results.append(
            {
                "line_index": index,
                "game_name": game_name,
                "settlement_cycle": cycle,
                "auto_apply": auto_apply,
                "confidence": scored.get("confidence"),
                "score": top_score,
                "ambiguity_margin": margin,
                "message": "合同匹配明确，可自动带入结算规则" if auto_apply else "已找到合同，但匹配仍需人工确认",
                "match": {
                    "contract_id": candidate.get("contract_id"),
                    "contract_name": candidate.get("contract_name"),
                    "contract_no": candidate.get("contract_no"),
                    "access_item_id": candidate.get("access_item_id"),
                    "product_name": candidate.get("product_name"),
                    "channel_name": candidate.get("channel_name"),
                    "authorization_start": candidate.get("authorization_start"),
                    "authorization_end": candidate.get("authorization_end"),
                    "share_rate": candidate.get("share_rate"),
                    "channel_fee_rate": candidate.get("channel_fee_rate"),
                    "invoice_tax_rate": candidate.get("invoice_tax_rate"),
                    "settlement_mode": candidate.get("settlement_mode"),
                    "settlement_basis": candidate.get("settlement_basis"),
                    "payment_terms": candidate.get("payment_terms"),
                    "reasons": scored.get("reasons") or [],
                },
                "recommended": recommended,
            }
        )

    matched = [item for item in results if item.get("recommended")]
    auto_lines = [item for item in results if item.get("auto_apply")]
    header = None
    overall_auto = bool(results) and len(auto_lines) == len(results)
    if overall_auto:
        signatures = {
            (
                item["recommended"]["settlement_rule_code"],
                item["recommended"]["channel_fee_mode"],
                item["recommended"]["channel_fee_rate"],
                item["recommended"]["tax_mode"],
            )
            for item in auto_lines
        }
        if len(signatures) == 1:
            first = auto_lines[0]["recommended"]
            header = {
                "settlement_rule_code": first["settlement_rule_code"],
                "channel_fee_mode": first["channel_fee_mode"],
                "channel_fee_rate": first["channel_fee_rate"],
                "tax_mode": first["tax_mode"],
                "validation_tolerance": first["validation_tolerance"],
            }
        else:
            overall_auto = False

    return {
        "version": "contract-channel-rule-v1",
        "auto_apply": bool(overall_auto and header),
        "matched_lines": len(matched),
        "total_lines": len(results),
        "header_recommendation": header,
        "lines": results,
        "message": (
            "合同规则已明确，可自动带入"
            if overall_auto and header
            else "合同规则存在歧义或资料不完整，请人工确认"
            if results
            else "请先填写游戏名称"
        ),
    }
