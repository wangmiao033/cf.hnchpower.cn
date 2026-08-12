"""Recommend channel-bill settlement fields from structured contract access items."""

from __future__ import annotations

from typing import Any

try:
    from .matcher import normalize_company, score_candidate
except ImportError:  # Vercel service-root import.
    from matcher import normalize_company, score_candidate

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
    share = _number(candidate.get("share_rate"))
    fields_complete = fee is not None and tax is not None and share is not None

    if fee is None:
        rule_code = "custom"
        fee_mode = "none"
        fee_value = None
    elif fee <= EPS:
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
        # reduce settlement. Record it on the line, but default calculation to
        # "not participating" unless the user explicitly changes the rule.
        "tax_mode": "none",
        "tax_rate": round(tax, 4) if tax is not None else None,
        "share_rate": round(share, 4) if share is not None else None,
        "validation_tolerance": 0.05,
        "fields_complete": fields_complete,
    }


def _partner_matches(partner_name: str, candidate: dict) -> bool:
    target = normalize_company(partner_name)
    if not target:
        return False
    for field in ("partner_name", "partner_short_name", "counterparty"):
        value = normalize_company(candidate.get(field))
        if not value:
            continue
        if value == target:
            return True
        if min(len(value), len(target)) >= 5 and (value in target or target in value):
            return True
    return False


def _rule_signature(rule: dict) -> tuple:
    return (
        rule.get("settlement_rule_code"),
        rule.get("channel_fee_mode"),
        rule.get("channel_fee_rate"),
        rule.get("tax_mode"),
        rule.get("tax_rate"),
        rule.get("share_rate"),
    )


def _partner_rule_summary(partner_name: str, candidates: list[dict]) -> dict:
    matched = [candidate for candidate in candidates if _partner_matches(partner_name, candidate)]
    contracts = sorted({str(item.get("contract_name") or "").strip() for item in matched if item.get("contract_name")})
    if not matched:
        return {
            "status": "none",
            "auto_apply": False,
            "recommendation": None,
            "contract_count": 0,
            "contracts": [],
            "message": "当前合作方未找到合同合作清单，保留现有人工/渠道规则。",
        }

    rules = [_rule_fields(candidate) for candidate in matched]
    if any(not rule.get("fields_complete") for rule in rules):
        return {
            "status": "incomplete",
            "auto_apply": False,
            "recommendation": None,
            "contract_count": len(matched),
            "contracts": contracts,
            "message": "合同合作清单存在未结构化的分成、通道费或税率，不能用旧默认值代替，请完善合同或按具体游戏人工确认。",
        }

    signatures = {_rule_signature(rule) for rule in rules}
    if len(signatures) != 1:
        return {
            "status": "ambiguous",
            "auto_apply": False,
            "recommendation": None,
            "contract_count": len(matched),
            "contracts": contracts,
            "message": "该合作方存在多套合同结算规则，请选择游戏和账期后按具体合同合作清单自动确认。",
        }

    recommendation = dict(rules[0])
    recommendation.pop("fields_complete", None)
    return {
        "status": "uniform",
        "auto_apply": True,
        "recommendation": recommendation,
        "contract_count": len(matched),
        "contracts": contracts,
        "message": (
            "已读取合作方合同清单统一规则："
            f"分成 {recommendation['share_rate']:g}% / "
            f"通道费 {recommendation['channel_fee_rate']:g}% / "
            f"税率 {recommendation['tax_rate']:g}%"
        ),
    }


def recommend_channel_rules(
    partner_name: str,
    channel_name: str,
    lines: list[dict],
    candidates: list[dict],
) -> dict:
    """Return contract-authoritative recommendations for a draft channel bill.

    Two stages are intentionally separated:
    1) partner-level baseline: if every access item for the partner carries the
       same complete rule, it can be shown immediately after selecting partner;
    2) line-level match: game + settlement month locks the exact access item.

    A legacy 30%/5% UI default is never treated as contract evidence.
    """
    partner_summary = _partner_rule_summary(partner_name, candidates)
    results: list[dict] = []

    for index, raw in enumerate(lines or []):
        source_index = raw.get("line_index", index)
        try:
            source_index = int(source_index)
        except (TypeError, ValueError):
            source_index = index
        game_name = str(raw.get("game_name") or raw.get("gameName") or "").strip()
        cycle = str(raw.get("settlement_cycle") or raw.get("settlementCycle") or "").strip()
        # A blank placeholder is allowed so the frontend can ask for the
        # partner-level contract baseline before game/month are entered.
        if not game_name:
            continue

        bill = {
            "partner_name": partner_name,
            "channel_name": channel_name,
            "settlement_month": cycle,
        }
        line = {
            "line_id": str(raw.get("line_id") or raw.get("id") or f"draft-{source_index}"),
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
                    "line_index": source_index,
                    "game_name": game_name,
                    "settlement_cycle": cycle,
                    "auto_apply": False,
                    "confidence": "none",
                    "score": 0,
                    "message": "该游戏/账期未找到匹配的合同合作清单",
                    "match": None,
                    "recommended": None,
                }
            )
            continue

        candidate, scored = ranked[0]
        second_score = float(ranked[1][1].get("score") or 0) if len(ranked) > 1 else 0.0
        top_score = float(scored.get("score") or 0)
        margin = round(top_score - second_score, 1)
        recommended = _rule_fields(candidate)
        auto_apply = (
            scored.get("confidence") == "high"
            and scored.get("authorization_status") == "covered"
            and margin >= 10
            and bool(recommended.get("fields_complete"))
        )
        public_recommended = dict(recommended)
        public_recommended.pop("fields_complete", None)
        results.append(
            {
                "line_index": source_index,
                "game_name": game_name,
                "settlement_cycle": cycle,
                "auto_apply": auto_apply,
                "confidence": scored.get("confidence"),
                "score": top_score,
                "ambiguity_margin": margin,
                "message": (
                    "合同匹配明确，可自动带入结算规则"
                    if auto_apply
                    else "已找到合同，但匹配有歧义、授权期不覆盖或合同数字字段不完整"
                ),
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
                "recommended": public_recommended,
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

    if overall_auto and header:
        message = "当前游戏与账期的合同规则已明确，可自动带入"
    elif partner_summary["auto_apply"]:
        message = partner_summary["message"]
    elif results:
        message = "合同规则存在歧义或资料不完整，请按具体游戏/账期确认"
    else:
        message = partner_summary["message"]

    return {
        "version": "contract-channel-rule-v2",
        "auto_apply": bool(overall_auto and header),
        "matched_lines": len(matched),
        "total_lines": len(results),
        "header_recommendation": header,
        "lines": results,
        "partner_rule_status": partner_summary["status"],
        "partner_auto_apply": partner_summary["auto_apply"],
        "partner_recommendation": partner_summary["recommendation"],
        "partner_contract_count": partner_summary["contract_count"],
        "partner_contracts": partner_summary["contracts"],
        "partner_rule_message": partner_summary["message"],
        "message": message,
    }
