"""Compatibility guard for channel-bill contract verification.

Channel bills can contain different settlement rules per game line.  Older
contract verification compared every line against ``channel_records.channel_fee_rate``
(the bill header), which creates a false contract difference when one game is 0%
and another is 5%/6%.

This module corrects line-level channel-fee authority and the Guangdong Anjiu
pre-discount deduction formula before the final V8 confirmation policy runs.
Persisted line rules are authoritative.  For legacy rows that do not yet have a
line-rule snapshot, a deterministic passing contract amount check is accepted as
evidence that the header fee must not be used as the line fee.
"""

from __future__ import annotations

from typing import Any

FEE_TOLERANCE = 0.01
ANJIU_PRE_DISCOUNT_DEDUCTION_RULE = "anjiu_pre_discount_deduction"


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def _num(value: Any, fallback: float = 0.0) -> float:
    parsed = _number(value)
    return fallback if parsed is None else parsed


def _effective_line_fee(rule: dict | None) -> float | None:
    if not rule:
        return None
    mode = str(rule.get("channel_fee_mode") or "").strip().lower()
    code = str(rule.get("settlement_rule_code") or "").strip().lower()
    rate = _number(rule.get("channel_fee_rate"))

    # Explicit no-fee is authoritative even when the stored numeric value is 0.
    if mode == "none" or code == "share_only":
        return 0.0
    if mode == "percent":
        return rate
    # A fixed currency deduction is not comparable to a percentage fee field.
    return None


def _fee_check(line: dict) -> dict | None:
    for check in line.get("checks") or []:
        if check.get("key") == "channel_fee_rate":
            return check
    return None


def _recompute_line_status(line: dict) -> None:
    checks = line.get("checks") or []
    amount = line.get("contract_amount") or {}

    if amount.get("status") == "fail" or any(check.get("status") == "fail" for check in checks):
        line["status"] = "fail"
        return

    if amount.get("status") == "manual" or any(
        check.get("status") in {"missing", "manual"} for check in checks
    ):
        line["status"] = "warning"
        return

    match = line.get("match") or {}
    binding = line.get("binding") or {}
    if match.get("confidence") == "low" and not binding:
        line["status"] = "warning"
        return

    line["status"] = "pass"


def normalize_anjiu_contract_amount(line: dict, rule: dict | None) -> dict:
    """Correct the contract amount for Anjiu's deductions-before-discount rule.

    The generic contract recalculator historically used ``flow * discount -
    deductions``.  Anjiu/gamefan contracts use ``(flow - deductions) * discount``.
    Field-level contract checks still run independently, so this compatibility
    correction cannot hide a real share-rate, tax, fee, authorization or match
    difference.
    """
    if not rule or str(rule.get("settlement_rule_code") or "").strip().lower() != ANJIU_PRE_DISCOUNT_DEDUCTION_RULE:
        return line

    updated = dict(line)
    amount = dict(updated.get("contract_amount") or {})
    actual = _number(amount.get("actual_amount"))
    if actual is None:
        return updated

    raw_flow = _num(rule.get("billing_flow"))
    discount = _num(rule.get("discount_factor"), 1.0)
    if discount <= 0:
        discount = 1.0
    deductions = sum(
        _num(rule.get(field))
        for field in (
            "voucher_cost",
            "no_worry_cost",
            "refund_cost",
            "test_cost",
            "welfare_cost",
            "coin_cost",
        )
    )
    billing_base = (raw_flow - deductions) * discount
    share_amount = billing_base * _num(rule.get("share_rate")) / 100

    fee_mode = str(rule.get("channel_fee_mode") or "fixed").strip().lower()
    after_fee = share_amount
    if fee_mode == "percent":
        after_fee = share_amount * (1 - _num(rule.get("channel_fee_rate")) / 100)
    elif fee_mode == "fixed":
        after_fee = share_amount - _num(rule.get("gateway_cost"))

    tax_mode = str(rule.get("tax_mode") or "share").strip().lower()
    tax_rate = _num(rule.get("tax_rate")) / 100
    if tax_mode == "share":
        expected = after_fee - share_amount * tax_rate
    elif tax_mode == "after_fee":
        expected = after_fee * (1 - tax_rate)
    else:
        expected = after_fee

    expected = round(expected + 1e-12, 2)
    difference = round(actual - expected, 2)
    tolerance = max(0.0, _num(rule.get("validation_tolerance"), _num(amount.get("tolerance"), 0.05)))
    amount.update(
        {
            "status": "pass" if abs(difference) <= tolerance else "fail",
            "supported": True,
            "deterministic": True,
            "expected_amount": expected,
            "difference_amount": difference,
            "variance_abs": round(abs(difference), 2),
            "variance_direction": "equal" if abs(difference) <= tolerance else "under" if difference < 0 else "over",
            "tolerance": tolerance,
            "formula_code": "channel_anjiu_pre_discount_deduction",
            "formula_label": "广东安久 / 游戏fan：扣减后再折扣",
            "breakdown": {
                "raw_flow": round(raw_flow, 2),
                "deductions_before_discount": round(deductions, 2),
                "discount_factor": round(discount, 6),
                "billing_base": round(billing_base, 2),
                "share_amount": round(share_amount, 2),
                "channel_fee_mode": fee_mode,
                "channel_fee_rate": round(_num(rule.get("channel_fee_rate")), 4),
                "tax_mode": tax_mode,
                "tax_rate": round(_num(rule.get("tax_rate")), 4),
            },
            "message": "已按广东安久 / 游戏fan 专属口径重算：扣减项先从后台流水扣除，再乘折扣系数。",
        }
    )
    updated["contract_amount"] = amount
    _recompute_line_status(updated)
    return updated


def normalize_channel_line_fee_check(line: dict, rule: dict | None) -> dict:
    """Return one line with a header-fee false positive removed when justified."""
    updated = dict(line)
    updated["checks"] = [dict(check) for check in (line.get("checks") or [])]
    check = _fee_check(updated)
    if check is None:
        return updated

    contract_fee = _number(check.get("contract_value"))
    if contract_fee is None:
        return updated

    line_fee = _effective_line_fee(rule)
    if line_fee is not None:
        difference = round(line_fee - contract_fee, 4)
        check["bill_value"] = line_fee
        check["difference"] = difference
        if abs(difference) <= FEE_TOLERANCE:
            check["status"] = "pass"
            check["message"] = "通道费率与该游戏明细保存的合同结算规则一致。"
        else:
            check["status"] = "fail"
            check["message"] = (
                f"该游戏明细通道费率 {line_fee:g}% 与合同 {contract_fee:g}% 不一致。"
            )
        _recompute_line_status(updated)
        return updated

    # Legacy bills created before line-rule persistence can have no line fee at
    # all.  If V3 has deterministically recalculated the line using the matched
    # contract and the expected amount equals the bill actual amount, the parent
    # header fee is not valid evidence of a line-level difference.
    amount = updated.get("contract_amount") or {}
    deterministic_amount_pass = (
        amount.get("status") == "pass"
        and bool(amount.get("supported", True))
        and bool(amount.get("deterministic", True))
        and amount.get("expected_amount") is not None
        and amount.get("actual_amount") is not None
    )
    if check.get("status") == "fail" and deterministic_amount_pass:
        check["status"] = "pass"
        check["bill_value"] = contract_fee
        check["difference"] = 0.0
        check["message"] = (
            "该历史明细尚无独立通道费快照；合同标准金额与账单实际结算一致，"
            "因此不再用账单头统一通道费判定该游戏差异。"
        )
        _recompute_line_status(updated)

    return updated


def apply_channel_line_fee_authority(
    conn: Any,
    bill_type: str,
    bill_id: str,
    result: dict,
) -> dict:
    """Apply line-level channel rule authority to a reconciliation result."""
    if bill_type != "channel":
        return result

    rows = conn.execute(
        """
        SELECT id, settlement_rule_code, channel_fee_mode, channel_fee_rate,
               tax_mode, validation_tolerance,
               billing_flow, discount_factor, voucher_cost, no_worry_cost,
               refund_cost, test_cost, welfare_cost, coin_cost,
               share_rate, tax_rate, gateway_cost, settlement_amount
        FROM channel_record_line_items
        WHERE channel_record_id = %s
        """,
        [bill_id],
    ).fetchall()
    rules = {str(row["id"]): dict(row) for row in rows}

    normalized_lines = []
    for source in result.get("lines") or []:
        rule = rules.get(str(source.get("line_id") or ""))
        line = normalize_anjiu_contract_amount(source, rule)
        line = normalize_channel_line_fee_check(line, rule)
        normalized_lines.append(line)

    updated = dict(result)
    updated["lines"] = normalized_lines
    return updated
