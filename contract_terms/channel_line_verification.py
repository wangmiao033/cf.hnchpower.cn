"""Compatibility guard for channel-bill contract verification.

Channel bills can contain different settlement rules per game line.  Older
contract verification compared every line against ``channel_records.channel_fee_rate``
(the bill header), which creates a false contract difference when one game is 0%
and another is 5%/6%.

This module corrects only the channel-fee field check before the final V8
confirmation policy runs.  Persisted line rules are authoritative.  For legacy
rows that do not yet have a line-rule snapshot, a deterministic passing contract
amount check is accepted as evidence that the header fee must not be used as the
line fee.
"""

from __future__ import annotations

from typing import Any

FEE_TOLERANCE = 0.01


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


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
    """Apply line-level channel-fee authority to a reconciliation result."""
    if bill_type != "channel":
        return result

    rows = conn.execute(
        """
        SELECT id, settlement_rule_code, channel_fee_mode, channel_fee_rate,
               tax_mode, validation_tolerance
        FROM channel_record_line_items
        WHERE channel_record_id = %s
        """,
        [bill_id],
    ).fetchall()
    rules = {str(row["id"]): dict(row) for row in rows}

    updated = dict(result)
    updated["lines"] = [
        normalize_channel_line_fee_check(line, rules.get(str(line.get("line_id") or "")))
        for line in (result.get("lines") or [])
    ]
    return updated
