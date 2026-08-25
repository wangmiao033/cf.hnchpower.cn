"""渠道结算规则引擎与平台账单金额校验。"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

XIAN_WEIZHEN_9917_RULE = "xian_weizhen_9917"
ANJIU_PRE_DISCOUNT_DEDUCTION_RULE = "anjiu_pre_discount_deduction"
ROUNDING_TAIL = Decimal("0.01")
VALID_RULES = {
    "legacy_fixed_fee_tax",
    "xiaomi_percent_fee",
    "five_percent_gateway_share",
    "percent_fee_after_tax",
    "share_only",
    XIAN_WEIZHEN_9917_RULE,
    ANJIU_PRE_DISCOUNT_DEDUCTION_RULE,
    "custom",
}
VALID_FEE_MODES = {"none", "percent", "fixed"}
VALID_TAX_MODES = {"none", "share", "after_fee"}
DEFAULT_DEDUCTION_FIELDS = (
    "voucher_cost",
    "no_worry_cost",
    "refund_cost",
    "test_cost",
    "welfare_cost",
    "coin_cost",
)
XIAN_WEIZHEN_9917_DEDUCTION_FIELDS = (
    "no_worry_cost",
    "refund_cost",
    "test_cost",
    "coin_cost",
)


def _d(value: Any, default: str = "0") -> Decimal:
    try:
        return Decimal(str(value if value not in (None, "") else default))
    except Exception:
        return Decimal(default)


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _value(record: Any, field: str, fallback: Any = None) -> Any:
    value = getattr(record, field, None)
    if value not in (None, ""):
        return value
    return getattr(fallback, field, None) if fallback is not None else None


def resolve_rule_settings(record: Any, fallback: Any = None) -> dict[str, Any]:
    """Resolve one rule source, optionally inheriting missing fields from a parent.

    Channel bill lines can now persist their exact contract rule.  When a line
    has no stored override (legacy data), the parent bill remains the fallback.
    An explicit zero is never treated as missing.
    """
    code = str(_value(record, "settlement_rule_code", fallback) or "legacy_fixed_fee_tax").strip()
    if code not in VALID_RULES:
        code = "custom"
    fee_mode = str(_value(record, "channel_fee_mode", fallback) or "fixed").strip()
    tax_mode = str(_value(record, "tax_mode", fallback) or "share").strip()
    fee_rate = _d(_value(record, "channel_fee_rate", fallback))
    tolerance = max(Decimal("0"), _d(_value(record, "validation_tolerance", fallback), "0.05"))

    if code == XIAN_WEIZHEN_9917_RULE:
        # 西安维真（客户 9917）平台账单口径：
        # 代金券、福利币仅记录，不从可分成金额扣减；
        # 其余原扣减项仍参与；分成后统一扣 5% 通道费；税率仅记录。
        fee_mode, tax_mode, fee_rate = "percent", "none", Decimal("5")
    elif code == ANJIU_PRE_DISCOUNT_DEDUCTION_RULE:
        # 广东安久 / 游戏fan：扣减项必须先从后台流水扣除，再乘折扣系数。
        # 该专属规则的税处理固定为“按分成额扣税”；渠道费模式/费率仍以合同明细为准。
        tax_mode = "share"
    elif code in {"xiaomi_percent_fee", "five_percent_gateway_share"}:
        fee_mode, tax_mode = "percent", "none"
        if fee_rate <= 0:
            fee_rate = Decimal("5")
    elif code == "percent_fee_after_tax":
        fee_mode, tax_mode = "percent", "after_fee"
    elif code == "legacy_fixed_fee_tax":
        fee_mode, tax_mode = "fixed", "share"
    elif code == "share_only":
        fee_mode, tax_mode = "none", "none"

    if fee_mode not in VALID_FEE_MODES:
        fee_mode = "fixed"
    if tax_mode not in VALID_TAX_MODES:
        tax_mode = "share"
    return {"rule_code": code, "fee_mode": fee_mode, "tax_mode": tax_mode, "fee_rate": fee_rate, "tolerance": tolerance}


def _calculate_channel_line_raw(item: Any, record: Any) -> tuple[dict[str, Any], Decimal, Decimal, Decimal]:
    """Return rule settings plus unrounded billing/share/system amounts.

    Line display values are still rounded to cents, but bill-level aggregation can
    now add the unrounded system amounts first. This matches spreadsheets that
    calculate each row at full precision and round only the final total.
    """
    settings = resolve_rule_settings(item, record)
    flow = _d(getattr(item, "billing_flow", None))
    discount = _d(getattr(item, "discount_factor", None), "1")
    if discount <= 0:
        discount = Decimal("1")
    effective_flow = _money(flow * discount)
    deduction_fields = (
        XIAN_WEIZHEN_9917_DEDUCTION_FIELDS
        if settings["rule_code"] == XIAN_WEIZHEN_9917_RULE
        else DEFAULT_DEDUCTION_FIELDS
    )
    deduction_total = sum(
        (_d(getattr(item, field, None)) for field in deduction_fields),
        Decimal("0"),
    )
    if settings["rule_code"] == ANJIU_PRE_DISCOUNT_DEDUCTION_RULE:
        billing_amount = (flow - deduction_total) * discount
    else:
        billing_amount = effective_flow - deduction_total

    share_rate = _d(getattr(item, "share_rate", None)) / Decimal("100")
    share_amount = billing_amount * share_rate

    after_fee = share_amount
    if settings["fee_mode"] == "percent":
        after_fee = share_amount * (Decimal("1") - settings["fee_rate"] / Decimal("100"))
    elif settings["fee_mode"] == "fixed":
        after_fee = share_amount - _d(getattr(item, "gateway_cost", None))

    tax_rate = _d(getattr(item, "tax_rate", None)) / Decimal("100")
    if settings["tax_mode"] == "share":
        system_amount = after_fee - share_amount * tax_rate
    elif settings["tax_mode"] == "after_fee":
        system_amount = after_fee * (Decimal("1") - tax_rate)
    else:
        system_amount = after_fee

    return settings, billing_amount, share_amount, system_amount


def calculate_channel_line(item: Any, record: Any) -> dict[str, Any]:
    # P0: contract rules belong to the game line, not only to the bill header.
    # Legacy rows with null line-rule columns still fall back to the parent.
    settings, billing_amount, share_amount, system_raw = _calculate_channel_line_raw(item, record)
    system_amount = _money(system_raw)
    platform_raw = getattr(item, "platform_settlement_amount", None)
    platform_amount = None if platform_raw in (None, "") else _money(_d(platform_raw))
    if platform_amount is None:
        difference = None
        validation_status = "unvalidated"
        final_amount = system_amount
    else:
        difference = _money(system_amount - platform_amount)
        validation_status = "pass" if abs(difference) <= settings["tolerance"] else "fail"
        final_amount = platform_amount

    return {
        "billing_amount": _money(billing_amount),
        "share_amount": _money(share_amount),
        "system_settlement_amount": system_amount,
        "platform_settlement_amount": platform_amount,
        "settlement_difference": difference,
        "validation_status": validation_status,
        "settlement_amount": final_amount,
    }


def aggregate_validation(items: list[Any], record: Any = None) -> dict[str, Any]:
    if not items:
        return {
            "system_total": Decimal("0"),
            "platform_total": None,
            "difference_total": None,
            "validation_status": "unvalidated",
            "settlement_total": Decimal("0"),
            "rounding_tail_applied": False,
        }

    rounded_line_system_total = _money(
        sum((_d(getattr(item, "system_settlement_amount", None)) for item in items), Decimal("0"))
    )
    precision_system_total = rounded_line_system_total
    if record is not None:
        precision_system_total = _money(
            sum((_calculate_channel_line_raw(item, record)[3] for item in items), Decimal("0"))
        )

    provided = [item for item in items if getattr(item, "platform_settlement_amount", None) is not None]
    platform_total = _money(
        sum((_d(getattr(item, "platform_settlement_amount", None)) for item in provided), Decimal("0"))
    ) if provided else None

    every_line_matches_rounded_platform = (
        bool(items)
        and len(provided) == len(items)
        and all(
            getattr(item, "settlement_difference", None) is not None
            and _money(_d(getattr(item, "settlement_difference", None))) == Decimal("0.00")
            for item in items
        )
    )
    rounding_tail_applied = (
        every_line_matches_rounded_platform
        and platform_total is not None
        and platform_total == rounded_line_system_total
        and abs(precision_system_total - rounded_line_system_total) == ROUNDING_TAIL
    )

    system_total = precision_system_total if rounding_tail_applied else rounded_line_system_total
    difference_total = _money(system_total - platform_total) if platform_total is not None else None
    line_settlement_total = _money(
        sum((_d(getattr(item, "settlement_amount", None)) for item in items), Decimal("0"))
    )
    settlement_total = precision_system_total if rounding_tail_applied else line_settlement_total

    statuses = [str(getattr(item, "validation_status", None) or "unvalidated") for item in items]
    if "fail" in statuses:
        status = "fail"
    elif all(value == "pass" for value in statuses):
        status = "pass"
    elif any(value == "pass" for value in statuses):
        status = "partial"
    else:
        status = "unvalidated"

    return {
        "system_total": system_total,
        "platform_total": platform_total,
        "difference_total": difference_total,
        "validation_status": status,
        "settlement_total": settlement_total,
        "rounding_tail_applied": rounding_tail_applied,
    }
