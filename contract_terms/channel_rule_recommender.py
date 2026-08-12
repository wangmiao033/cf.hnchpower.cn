"""Recommend channel-bill settlement fields from structured contract access items."""

from __future__ import annotations

from typing import Any

try:
    from .matcher import normalize_company, normalize_game, score_candidate
except ImportError:  # Vercel service-root import.
    from matcher import normalize_company, normalize_game, score_candidate

EPS = 0.01
EXPLICITLY_DISABLED_STATUSES = {
    "停用",
    "已停用",
    "禁用",
    "已禁用",
    "作废",
    "已作废",
    "终止",
    "已终止",
    "取消",
    "已取消",
    "失效",
    "已失效",
    "disabled",
    "inactive",
    "terminated",
    "cancelled",
    "canceled",
    "void",
    "voided",
}


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

    # P0: invoice_tax_rate is display/audit metadata. The channel settlement
    # engine defaults tax_mode to "none", so a missing invoice tax rate must not
    # suppress known contract share/channel-fee numbers. Only the fields that
    # actually determine the default settlement calculation are blocking here.
    fields_complete = fee is not None and share is not None

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

    # tax_mode="none" means invoice tax is record-only and never changes the
    # settlement result. The channel form persists tax_rate as a non-null number,
    # so use the neutral value 0 when the contract has no structured invoice tax.
    # Keep tax_rate_missing=True so the UI/audit layer can still tell users that
    # the contract metadata itself has not been structured yet.
    neutral_tax_rate = round(tax, 4) if tax is not None else (0.0 if fields_complete else None)

    return {
        "settlement_rule_code": rule_code,
        "channel_fee_mode": fee_mode,
        "channel_fee_rate": fee_value,
        # invoice_tax_rate is an invoice attribute, not evidence that tax should
        # reduce settlement. Record it on the line, but default calculation to
        # "not participating" unless the user explicitly changes the rule.
        "tax_mode": "none",
        "tax_rate": neutral_tax_rate,
        "share_rate": round(share, 4) if share is not None else None,
        "validation_tolerance": 0.05,
        "fields_complete": fields_complete,
        "tax_rate_missing": tax is None,
    }


def _status_key(value: Any) -> str:
    return str(value or "").strip().lower().replace(" ", "")


def _candidate_explicitly_disabled(candidate: dict) -> bool:
    """Ignore only explicit negative states; free-text positive states are not guessed.

    Contract/access status fields are free text in the current data model. We
    therefore never maintain an allow-list of "active" labels. Only explicit
    stop/void/disable values are excluded, which avoids making historical
    backdated bills impossible to inspect merely because wording differs.
    """
    for field in ("access_status", "performance_status"):
        if _status_key(candidate.get(field)) in EXPLICITLY_DISABLED_STATUSES:
            return True
    return False


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


def _exact_game_matches(game_name: str, candidate: dict) -> bool:
    target = normalize_game(game_name)
    product = normalize_game(candidate.get("product_name"))
    return bool(target and product and target == product)


def _rule_signature(rule: dict) -> tuple:
    return (
        rule.get("settlement_rule_code"),
        rule.get("channel_fee_mode"),
        rule.get("channel_fee_rate"),
        rule.get("tax_mode"),
        rule.get("tax_rate"),
        rule.get("share_rate"),
    )


def _public_rule(rule: dict) -> dict:
    public = dict(rule)
    public.pop("fields_complete", None)
    public.pop("tax_rate_missing", None)
    return public


def _rate_label(value: Any) -> str:
    number = _number(value)
    return "未录入" if number is None else f"{number:g}%"


def _partner_rule_summary(partner_name: str, candidates: list[dict]) -> dict:
    all_matched = [candidate for candidate in candidates if _partner_matches(partner_name, candidate)]
    disabled_count = sum(1 for candidate in all_matched if _candidate_explicitly_disabled(candidate))
    matched = [candidate for candidate in all_matched if not _candidate_explicitly_disabled(candidate)]
    contracts = sorted({str(item.get("contract_name") or "").strip() for item in matched if item.get("contract_name")})
    if not matched:
        return {
            "status": "none",
            "auto_apply": False,
            "recommendation": None,
            "contract_count": 0,
            "contracts": [],
            "ignored_incomplete_count": 0,
            "ignored_disabled_count": disabled_count,
            "message": "当前合作方未找到可用于结算匹配的合同合作清单，保留现有人工/渠道规则。",
        }

    pairs = [(candidate, _rule_fields(candidate)) for candidate in matched]
    complete_pairs = [(candidate, rule) for candidate, rule in pairs if rule.get("fields_complete")]
    incomplete_count = len(pairs) - len(complete_pairs)
    if not complete_pairs:
        return {
            "status": "incomplete",
            "auto_apply": False,
            "recommendation": None,
            "contract_count": len(matched),
            "contracts": contracts,
            "ignored_incomplete_count": incomplete_count,
            "ignored_disabled_count": disabled_count,
            "message": "当前合作方可用合同合作清单的分成或通道费尚未完整结构化；请选择具体游戏和账期后按对应合同核对。",
        }

    signatures = {_rule_signature(rule) for _, rule in complete_pairs}
    if len(signatures) != 1:
        suffix = f"；另有 {incomplete_count} 条结算字段不完整记录不参与默认规则判断" if incomplete_count else ""
        return {
            "status": "ambiguous",
            "auto_apply": False,
            "recommendation": None,
            "contract_count": len(matched),
            "contracts": contracts,
            "ignored_incomplete_count": incomplete_count,
            "ignored_disabled_count": disabled_count,
            "message": f"该合作方存在多套合同结算规则，请选择游戏和账期后按具体合同合作清单自动确认{suffix}。",
        }

    recommendation = _public_rule(complete_pairs[0][1])
    ignored_bits: list[str] = []
    if incomplete_count:
        ignored_bits.append(f"{incomplete_count} 条结算字段不完整历史/辅助记录")
    if disabled_count:
        ignored_bits.append(f"{disabled_count} 条停用/作废记录")
    ignored_text = f"；已忽略{'、'.join(ignored_bits)}" if ignored_bits else ""
    return {
        "status": "uniform",
        "auto_apply": True,
        "recommendation": recommendation,
        "contract_count": len(matched),
        "contracts": contracts,
        "ignored_incomplete_count": incomplete_count,
        "ignored_disabled_count": disabled_count,
        "message": (
            "已读取合作方合同清单统一规则："
            f"分成 {_rate_label(recommendation['share_rate'])} / "
            f"通道费 {_rate_label(recommendation['channel_fee_rate'])} / "
            f"发票税率 {_rate_label(recommendation['tax_rate'])}"
            f"{ignored_text}"
        ),
    }


def _rank_candidates(bill: dict, line: dict, candidates: list[dict]) -> list[tuple[dict, dict, dict]]:
    ranked: list[tuple[dict, dict, dict]] = []
    for candidate in candidates:
        if _candidate_explicitly_disabled(candidate):
            continue
        score = score_candidate(bill, line, candidate)
        if score.get("eligible"):
            ranked.append((candidate, score, _rule_fields(candidate)))
    ranked.sort(
        key=lambda item: (
            float(item[1].get("score") or 0),
            1 if item[2].get("fields_complete") else 0,
        ),
        reverse=True,
    )
    return ranked


def _selection_pool(ranked: list[tuple[dict, dict, dict]], game_name: str) -> list[tuple[dict, dict, dict]]:
    if not ranked:
        return []

    # Contract identity outranks data completeness. If an exact game access item
    # exists, never substitute another game's complete rule just because the
    # exact row is missing a field; expose the missing field for review instead.
    exact_game = [item for item in ranked if _exact_game_matches(game_name, item[0])]
    identity_pool = exact_game or ranked

    # If any candidate within that identity pool is not explicitly out of range,
    # an old/expired candidate must not beat it just because fields are complete.
    in_range = [item for item in identity_pool if item[1].get("authorization_status") != "out_of_range"]
    pool = in_range or identity_pool

    # Within the same relevant identity/time pool, complete settlement-driving
    # rules may win over stale/auxiliary duplicates. Missing invoice tax is not
    # blocking because tax is record-only under the default channel calculation.
    complete = [item for item in pool if item[2].get("fields_complete")]
    return complete or pool


def recommend_channel_rules(
    partner_name: str,
    channel_name: str,
    lines: list[dict],
    candidates: list[dict],
) -> dict:
    """Return contract-authoritative recommendations for a draft channel bill.

    Two stages are intentionally separated:
    1) partner-level baseline: usable access items define the baseline;
    2) line-level match: game + settlement month locks the exact access item.

    A legacy 30%/5% UI default is never treated as contract evidence. Missing
    non-settlement metadata (for example invoice tax) is a warning only and must
    never erase known share/channel-fee values from the contract list.
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
        ranked = _rank_candidates(bill, line, candidates)
        pool = _selection_pool(ranked, game_name)
        if not pool:
            results.append(
                {
                    "line_index": source_index,
                    "game_name": game_name,
                    "settlement_cycle": cycle,
                    "auto_apply": False,
                    "confidence": "none",
                    "score": 0,
                    "authorization_status": "unknown",
                    "authorization_warning": False,
                    "tax_rate_warning": False,
                    "rule_fields_complete": False,
                    "financially_unambiguous": False,
                    "message": "该游戏/账期未找到匹配的可用合同合作清单",
                    "match": None,
                    "recommended": None,
                }
            )
            continue

        pool.sort(key=lambda item: float(item[1].get("score") or 0), reverse=True)
        candidate, scored, recommended = pool[0]
        second_score = float(pool[1][1].get("score") or 0) if len(pool) > 1 else 0.0
        top_score = float(scored.get("score") or 0)
        margin = round(top_score - second_score, 1)
        # The margin represents contract-identity certainty, not merely whether
        # two contracts happen to carry equal money fields. Preserve the safety
        # boundary that equal-score duplicate contracts require human review.
        financially_unambiguous = margin >= 10
        authorization_status = scored.get("authorization_status")
        exact_identity = _partner_matches(partner_name, candidate) and _exact_game_matches(game_name, candidate)
        identity_confident = scored.get("confidence") == "high" or exact_identity
        authorization_allowed = authorization_status != "out_of_range"
        auto_apply = (
            identity_confident
            and authorization_allowed
            and financially_unambiguous
            and bool(recommended.get("fields_complete"))
        )
        tax_rate_warning = bool(recommended.get("tax_rate_missing"))
        public_recommended = _public_rule(recommended)

        if auto_apply and authorization_status == "unknown" and tax_rate_warning:
            line_message = "合同合作项匹配明确，分成/通道费已带入；授权期与发票税率未结构化，按0记录且不参与结算"
        elif auto_apply and authorization_status == "unknown":
            line_message = "合同合作项匹配明确，授权期未结构化；已带入合同结算数字，授权期单独待确认"
        elif auto_apply and tax_rate_warning:
            line_message = "合同匹配明确，分成/通道费已带入；发票税率未结构化，按0记录且不参与结算"
        elif auto_apply:
            line_message = "合同匹配明确，可自动带入结算规则"
        elif authorization_status == "out_of_range":
            line_message = "已找到合同，但当前账期明确不在授权期内，不能自动带入"
        elif not recommended.get("fields_complete"):
            line_message = "已找到具体合同，但该合作项的分成或通道费结构化字段不完整"
        elif not financially_unambiguous:
            line_message = "当前游戏/账期仍有多个有效合同候选，需要先确认合同归属"
        else:
            line_message = "已找到合同，但候选身份仍需人工确认"

        results.append(
            {
                "line_index": source_index,
                "game_name": game_name,
                "settlement_cycle": cycle,
                "auto_apply": auto_apply,
                "confidence": scored.get("confidence"),
                "score": top_score,
                "ambiguity_margin": margin,
                "authorization_status": authorization_status,
                "authorization_warning": authorization_status == "unknown",
                "tax_rate_warning": tax_rate_warning,
                "rule_fields_complete": bool(recommended.get("fields_complete")),
                "financially_unambiguous": financially_unambiguous,
                "candidate_count": len(ranked),
                "usable_candidate_count": len(pool),
                "message": line_message,
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
                    "access_status": candidate.get("access_status"),
                    "performance_status": candidate.get("performance_status"),
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

    # A partner-level baseline is useful only before precise game rows exist, or
    # after every precise row has independently resolved. If any entered game is
    # unmatched/ambiguous/incomplete/out-of-range, returning a baseline would let
    # the UI silently overwrite that row with another game's rule.
    precise_rows_fully_resolved = not results or len(auto_lines) == len(results)
    safe_partner_auto_apply = bool(partner_summary["auto_apply"] and precise_rows_fully_resolved)
    safe_partner_recommendation = partner_summary["recommendation"] if safe_partner_auto_apply else None

    if overall_auto and header:
        warning_bits: list[str] = []
        if any(item.get("authorization_warning") for item in auto_lines):
            warning_bits.append("授权期未结构化")
        if any(item.get("tax_rate_warning") for item in auto_lines):
            warning_bits.append("发票税率未结构化（按0记录，不参与结算）")
        if warning_bits:
            message = f"当前游戏与合同匹配已明确；{'、'.join(warning_bits)}，不影响已知结算数字带入"
        else:
            message = "当前游戏与账期的合同匹配已明确，可自动带入"
    elif safe_partner_auto_apply:
        message = partner_summary["message"]
    elif results:
        message = "合同规则存在歧义或结算字段不完整，请按具体游戏/账期确认"
    else:
        message = partner_summary["message"]

    return {
        "version": "contract-channel-rule-v2.7",
        "auto_apply": bool(overall_auto and header),
        "matched_lines": len(matched),
        "total_lines": len(results),
        "header_recommendation": header,
        "lines": results,
        "partner_rule_status": partner_summary["status"],
        "partner_auto_apply": safe_partner_auto_apply,
        "partner_recommendation": safe_partner_recommendation,
        "partner_contract_count": partner_summary["contract_count"],
        "partner_contracts": partner_summary["contracts"],
        "partner_ignored_incomplete_count": partner_summary["ignored_incomplete_count"],
        "partner_ignored_disabled_count": partner_summary["ignored_disabled_count"],
        "partner_rule_message": partner_summary["message"],
        "message": message,
    }
