"""Production contract service V14: align Anjiu contract recommendation and verification.

V13 keeps contract-first matching plus game-registry fallback. V14 aligns the
Guangdong Anjiu / 游戏fan（安久） dedicated settlement rule across both draft
recommendation and confirmation-time contract verification.

No other partner/channel is modified, explicit bill-to-contract bindings remain
authoritative, and real authorization/contract differences are still blocked.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from fastapi import Request

try:
    from . import settlement_recalculator as _settlement_recalculator
    from . import v2_main as _v2
    from . import v13_main as _v13
    from .channel_rule_recommender import recommend_channel_rules
except ImportError:  # Vercel imports modules from the service root.
    import settlement_recalculator as _settlement_recalculator
    import v2_main as _v2
    import v13_main as _v13
    from channel_rule_recommender import recommend_channel_rules

app = _v13.app
_CHANNEL_RULE_PATH = _v13._CHANNEL_RULE_PATH
ANJIU_PRE_DISCOUNT_DEDUCTION_RULE = "anjiu_pre_discount_deduction"

_v3_module = _v13._v12._v11._v8._v3_module
_ORIGINAL_EVALUATE_LINE_V2 = _v2._evaluate_line_v2
_ORIGINAL_RAW_CHANNEL_BILL = _v3_module._raw_channel_bill
_ORIGINAL_CHANNEL_CONTRACT_AMOUNT = _settlement_recalculator.calculate_channel_contract_amount

_ANJIU_DEDUCTION_FIELDS = (
    "voucher_cost",
    "no_worry_cost",
    "refund_amount",
    "test_fee",
    "welfare_cost",
    "coin_cost",
)


def _compact(value: object) -> str:
    return str(value or "").strip().lower().replace(" ", "")


def _is_anjiu(partner_name: str, channel_name: str) -> bool:
    partner = _compact(partner_name)
    channel = _compact(channel_name)
    return (
        "广东安久科技有限公司" in partner
        or "游戏fan（安久）" in channel
        or "游戏fan(安久)" in channel
    )


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def align_anjiu_tax_mode(result: dict, *, partner_name: str, channel_name: str) -> dict:
    """Return a copy with Anjiu's dedicated tax-processing mode aligned.

    Share rate, tax rate, channel fee and every contract identity field remain
    untouched. Only ``tax_mode`` is changed from the generic record-only mode to
    ``share`` so the frontend does not mistake the dedicated channel formula for
    a manual contract override.
    """
    if not _is_anjiu(partner_name, channel_name):
        return result

    out = deepcopy(result or {})
    for item in out.get("lines") or []:
        recommended = item.get("recommended")
        if isinstance(recommended, dict):
            recommended["tax_mode"] = "share"

    header = out.get("header_recommendation")
    if isinstance(header, dict):
        header["tax_mode"] = "share"

    partner_recommendation = out.get("partner_recommendation")
    if isinstance(partner_recommendation, dict):
        partner_recommendation["tax_mode"] = "share"

    out["anjiu_formula_alignment"] = True
    return out


def _evaluate_channel_line_with_contract_rule_authority(
    bill: dict,
    line: dict,
    candidates: list[dict],
    binding: dict | None,
) -> dict:
    """Use the same contract-first candidate choice as the channel form.

    The old reconciliation matcher ignored access-item lifecycle state when two
    otherwise identical candidates tied on score. That could make the form apply
    the current active contract while confirmation compared against a disabled or
    stale duplicate and reported a false hard difference.

    Explicit manual/auto bindings stay authoritative. We only replace an
    *unbound* Anjiu candidate when the current channel-rule recommender says it is
    safe to auto-apply.
    """
    base = _ORIGINAL_EVALUATE_LINE_V2(bill, line, candidates, binding)
    if binding or bill.get("bill_type") != "channel":
        return base
    if not _is_anjiu(str(bill.get("partner_name") or ""), str(bill.get("channel_name") or "")):
        return base

    recommendation = recommend_channel_rules(
        str(bill.get("partner_name") or ""),
        str(bill.get("channel_name") or ""),
        [
            {
                "line_index": 0,
                "line_id": line.get("line_id"),
                "game_name": line.get("game_name"),
                "settlement_cycle": line.get("settlement_cycle") or bill.get("settlement_month"),
            }
        ],
        candidates,
    )
    recommended_line = (recommendation.get("lines") or [{}])[0]
    if not recommended_line.get("auto_apply"):
        return base

    recommended_match = recommended_line.get("match") or {}
    access_item_id = str(recommended_match.get("access_item_id") or "")
    if not access_item_id:
        return base

    current_access_item_id = str((base.get("match") or {}).get("access_item_id") or "")
    if current_access_item_id == access_item_id:
        return base

    candidate = next(
        (item for item in candidates if str(item.get("access_item_id") or "") == access_item_id),
        None,
    )
    if candidate is None:
        return base

    match = _v2.score_candidate(bill, line, candidate)
    checks = _v2.compare_bill_to_candidate(bill, line, candidate, match)
    failed = any(item.get("status") == "fail" for item in checks)
    needs_review = any(item.get("status") in {"missing", "manual"} for item in checks)
    status = "fail" if failed else "warning" if needs_review else "pass"

    updated = dict(base)
    updated["match"] = _v2._match_payload(candidate, match, None)
    updated["checks"] = checks
    updated["status"] = status
    updated["message"] = (
        "发现合同差异，请先核验。"
        if status == "fail"
        else "已按渠道账单同源合同规则锁定当前有效合同；仍有条款需要人工确认。"
        if status == "warning"
        else "已按渠道账单同源合同规则锁定当前有效合同，关键字段与账单一致。"
    )
    updated["contract_rule_authority"] = {
        "source": "channel_rule_recommendation",
        "replaced_access_item_id": current_access_item_id or None,
        "access_item_id": access_item_id,
    }
    return updated


def _raw_channel_bill_with_rule_snapshot(conn: Any, bill_id: str) -> tuple[dict, dict[str, dict]]:
    """Attach the saved line settlement-rule code to V3 amount verification."""
    bill, lines = _ORIGINAL_RAW_CHANNEL_BILL(conn, bill_id)

    header = conn.execute(
        """
        SELECT settlement_rule_code
        FROM channel_records
        WHERE id = %s
        """,
        [bill_id],
    ).fetchone()
    enriched_bill = dict(bill)
    if header and header.get("settlement_rule_code"):
        enriched_bill["settlement_rule_code"] = str(header["settlement_rule_code"])

    rows = conn.execute(
        """
        SELECT id, settlement_rule_code
        FROM channel_record_line_items
        WHERE channel_record_id = %s
        """,
        [bill_id],
    ).fetchall()
    rule_by_id = {str(row["id"]): row.get("settlement_rule_code") for row in rows}

    enriched_lines: dict[str, dict] = {}
    for line_id, source in lines.items():
        item = dict(source)
        rule_code = rule_by_id.get(str(line_id))
        if rule_code:
            item["settlement_rule_code"] = str(rule_code)
        enriched_lines[line_id] = item
    return enriched_bill, enriched_lines


def _calculate_channel_contract_amount_with_anjiu_order(
    bill: dict,
    line: dict,
    candidate: dict,
    *,
    tolerance: float = _settlement_recalculator.DEFAULT_TOLERANCE,
) -> dict:
    """Make contract-standard amount use Anjiu's saved deduction order."""
    rule_code = str(
        line.get("settlement_rule_code")
        or bill.get("settlement_rule_code")
        or ""
    ).strip()
    if rule_code != ANJIU_PRE_DISCOUNT_DEDUCTION_RULE:
        return _ORIGINAL_CHANNEL_CONTRACT_AMOUNT(
            bill,
            line,
            candidate,
            tolerance=tolerance,
        )

    discount = _number(line.get("discount_factor"))
    if discount is None or discount <= 0:
        discount = 1.0

    adjusted_line = dict(line)
    for key in _ANJIU_DEDUCTION_FIELDS:
        value = _number(adjusted_line.get(key))
        if value is not None:
            adjusted_line[key] = value * discount

    adjusted_candidate = dict(candidate)
    candidate_testing_fee = _number(candidate.get("testing_fee"))
    if candidate_testing_fee is not None:
        adjusted_candidate["testing_fee"] = candidate_testing_fee * discount

    result = _ORIGINAL_CHANNEL_CONTRACT_AMOUNT(
        bill,
        adjusted_line,
        adjusted_candidate,
        tolerance=tolerance,
    )
    if result.get("expected_amount") is None:
        return result

    updated = dict(result)
    updated["formula_code"] = ANJIU_PRE_DISCOUNT_DEDUCTION_RULE
    updated["formula_label"] = "广东安久 / 游戏fan：扣减后再折算"
    breakdown = dict(updated.get("breakdown") or {})

    raw_deduction_total = 0.0
    for key in _ANJIU_DEDUCTION_FIELDS:
        if key == "test_fee" and candidate_testing_fee is not None:
            raw_deduction_total += candidate_testing_fee
        else:
            raw_deduction_total += _number(line.get(key)) or 0.0
    breakdown.update(
        {
            "deduction_order": "before_discount",
            "anjiu_discount_factor": round(discount, 6),
            "pre_discount_deduction_total": round(raw_deduction_total, 2),
            "discounted_deduction_total": round(raw_deduction_total * discount, 2),
        }
    )
    updated["breakdown"] = breakdown
    return updated


# Apply confirmation-time compatibility before V4/V8 reconciliation runs. This
# changes only unbound Anjiu selection and the Anjiu saved formula; every other
# bill keeps the existing reconciliation implementation.
_v2._evaluate_line_v2 = _evaluate_channel_line_with_contract_rule_authority
_v3_module._raw_channel_bill = _raw_channel_bill_with_rule_snapshot
_settlement_recalculator.calculate_channel_contract_amount = (
    _calculate_channel_contract_amount_with_anjiu_order
)


# V13 already owns this POST route. Replace only that route; every other
# V13/V12 reconciliation, audit and database-safety behavior remains unchanged.
app.router.routes[:] = [
    route
    for route in app.router.routes
    if not (
        getattr(route, "path", None) == _CHANNEL_RULE_PATH
        and "POST" in (getattr(route, "methods", None) or set())
    )
]


@app.post(_CHANNEL_RULE_PATH)
def anjiu_aligned_channel_rule(request: Request, payload: dict) -> dict:
    result = _v13.contract_first_registry_fallback_channel_rule(request, payload)
    partner_name = str(payload.get("partner_name") or "").strip()
    channel_name = str(payload.get("channel_name") or "").strip()
    return align_anjiu_tax_mode(
        result,
        partner_name=partner_name,
        channel_name=channel_name,
    )