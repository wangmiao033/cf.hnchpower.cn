"""渠道结算规则引擎与平台账单金额校验。"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from app.services.channel_233_incomplete import CODE as INCOMPLETE_233, incomplete
from app.services.samsung_settlement import SAMSUNG_STATEMENT_FEE_RULE, is_samsung_identity, samsung_billing_base

XIAN_WEIZHEN_9917_RULE = "xian_weizhen_9917"
HONOR_UPFRONT_PERCENT_FEE_RULE = "honor_upfront_percent_fee"
ANJIU_PRE_DISCOUNT_DEDUCTION_RULE = "anjiu_pre_discount_deduction"
DAXIONG_NET_RECEIPT_RULE = "daxiong_net_receipt"
ROUNDING_TAIL = Decimal("0.01")
VALID_RULES = {
    INCOMPLETE_233,
    SAMSUNG_STATEMENT_FEE_RULE,
    "legacy_fixed_fee_tax",
    "xiaomi_percent_fee",
    "five_percent_gateway_share",
    "percent_fee_after_tax",
    "share_only",
    XIAN_WEIZHEN_9917_RULE,
    HONOR_UPFRONT_PERCENT_FEE_RULE,
    ANJIU_PRE_DISCOUNT_DEDUCTION_RULE,
    DAXIONG_NET_RECEIPT_RULE,
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


def voucher_cost_for_storage(item: Any, record: Any) -> Decimal:
    """Keep the existing voucher_cost ledger column compatible with older code.

    Explicit split vouchers are stored as the discount-equivalent deduction.
    The Anjiu pre-discount rule needs the corresponding *original* face value
    (including the pre-discount equivalent of direct deductions).
    A historical line (both fields NULL) keeps its persisted voucher_cost.
    """
    face = getattr(item, "voucher_face_value", None)
    direct = getattr(item, "voucher_direct_cost", None)
    if face is None and direct is None:
        return _money(_d(getattr(item, "voucher_cost", None)))
    discount = _d(getattr(item, "discount_factor", None), "1")
    if discount <= 0:
        discount = Decimal("1")
    if resolve_rule_settings(item, record)["rule_code"] == ANJIU_PRE_DISCOUNT_DEDUCTION_RULE:
        return _money(_d(face) + _d(direct) / discount)
    return _money(_d(face) * discount + _d(direct))


def apply_bill_adjustment(
    business_amount: Any,
    adjustment_amount: Any = 0,
    final_override: Any = None,
) -> dict[str, Decimal | None]:
    """Apply a documented bill-level adjustment without rewriting game lines.

    ``adjustment_amount`` is signed: negative = deduction/carry-over, positive = top-up.
    ``final_override`` is optional for a formally agreed final receivable.  Any
    difference between arithmetic and that final amount is kept as an explicit tail.
    """
    business = _money(_d(business_amount))
    adjustment = _money(_d(adjustment_amount))
    calculated = _money(business + adjustment)
    override = None if final_override in (None, "") else _money(_d(final_override))
    final = override if override is not None else calculated
    tail = _money(final - calculated)
    return {
        "business_amount": business,
        "adjustment_amount": adjustment,
        "calculated_amount": calculated,
        "final_override": override,
        "tail_amount": tail,
        "final_amount": final,
    }


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

    if code == SAMSUNG_STATEMENT_FEE_RULE:
        owner = fallback if fallback is not None else record
        if not is_samsung_identity(getattr(owner, "partner_name", None), getattr(owner, "channel_name", None)):
            raise ValueError("三星原账单规则仅限已确认的三星法人及渠道")
        fee_mode, tax_mode, fee_rate = "fixed", "none", Decimal("4")
    elif code == XIAN_WEIZHEN_9917_RULE:
        # 西安维真（客户 9917）平台账单口径：
        # 代金券、福利币仅记录，不从可分成金额扣减；
        # 其余原扣减项仍参与；分成后统一扣 5% 通道费；税率仅记录。
        fee_mode, tax_mode, fee_rate = "percent", "none", Decimal("5")
    elif code == HONOR_UPFRONT_PERCENT_FEE_RULE:
        # 荣耀账单手续费按原始总流水计提，代金券等扣减发生在通道费之后、分成之前。
        # 不在分成后再次扣通道费；仅显式选择本规则的荣耀账单使用。
        fee_mode, tax_mode = "percent", "none"
        if _value(record, "channel_fee_rate", fallback) in (None, ""):
            fee_rate = Decimal("5")
    elif code == ANJIU_PRE_DISCOUNT_DEDUCTION_RULE:
        # 广东安久 / 游戏fan：扣减项必须先从后台流水扣除，再乘折扣系数。
        # 该专属规则的税处理固定为“按分成额扣税”；渠道费模式/费率仍以合同明细为准。
        tax_mode = "share"
    elif code == DAXIONG_NET_RECEIPT_RULE:
        # 大熊游戏：系统结算 = 实收合计（net receipt），非（流水−扣减）×分成公式。
        # 通道费 0.9%（支付宝/微信），默认实收已扣除通道费，不再重复扣。
        # 分成比例仅台账记录，不参与计算。
        fee_mode, tax_mode, fee_rate = "none", "none", Decimal("0")
    elif code in {"xiaomi_percent_fee", "five_percent_gateway_share"}:
        fee_mode, tax_mode = "percent", "none"
        explicit_mode = str(_value(record, "channel_fee_mode", None) or "").strip()
        explicit_rate = _value(record, "channel_fee_rate", None)
        line_zero_fee = explicit_mode == "none" or (
            explicit_rate not in (None, "") and _d(explicit_rate) <= 0
        )
        if line_zero_fee:
            fee_mode, fee_rate = "none", Decimal("0")
        elif fee_rate <= 0:
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
    if incomplete(item, record):
        return settings, Decimal("0"), Decimal("0"), Decimal("0")
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
    face = getattr(item, "voucher_face_value", None)
    direct = getattr(item, "voucher_direct_cost", None)
    if face is None and direct is None:
        # Backwards-compatible: voucher_cost retains its historic meaning,
        # including the Anjiu pre-discount deduction.
        deduction_total = sum(
            (_d(getattr(item, field, None)) for field in deduction_fields),
            Decimal("0"),
        )
        if settings["rule_code"] == ANJIU_PRE_DISCOUNT_DEDUCTION_RULE:
            billing_amount = (flow - deduction_total) * discount
        elif settings["rule_code"] == HONOR_UPFRONT_PERCENT_FEE_RULE:
            billing_amount = effective_flow * (Decimal("1") - settings["fee_rate"] / Decimal("100")) - deduction_total
        else:
            billing_amount = effective_flow - deduction_total
    else:
        # Split vouchers: the face-value coupon is converted exactly once;
        # the direct coupon stays in actual yuan, even under Anjiu rules.
        other_deductions = sum(
            (_d(getattr(item, field, None)) for field in deduction_fields if field != "voucher_cost"),
            Decimal("0"),
        )
        converted = _d(face) * discount + _d(direct)
        if settings["rule_code"] == ANJIU_PRE_DISCOUNT_DEDUCTION_RULE:
            billing_amount = (flow - other_deductions - _d(face)) * discount - _d(direct)
        elif settings["rule_code"] == HONOR_UPFRONT_PERCENT_FEE_RULE:
            billing_amount = effective_flow * (Decimal("1") - settings["fee_rate"] / Decimal("100")) - other_deductions - converted
        elif settings["rule_code"] == XIAN_WEIZHEN_9917_RULE:
            # This targeted contract records vouchers, but does not deduct them.
            billing_amount = effective_flow - other_deductions
        else:
            billing_amount = effective_flow - other_deductions - converted

    if settings["rule_code"] == SAMSUNG_STATEMENT_FEE_RULE:
        billing_amount = samsung_billing_base(billing_amount, getattr(item, "gateway_cost", None))

    share_rate = _d(getattr(item, "share_rate", None)) / Decimal("100")
    share_amount = billing_amount * share_rate

    after_fee = share_amount
    if settings["fee_mode"] == "percent" and settings["rule_code"] != HONOR_UPFRONT_PERCENT_FEE_RULE:
        after_fee = share_amount * (Decimal("1") - settings["fee_rate"] / Decimal("100"))
    elif settings["fee_mode"] == "fixed" and settings["rule_code"] != SAMSUNG_STATEMENT_FEE_RULE:
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

    # 大熊游戏：系统结算 = 实收合计（net receipt），非（流水−扣减）×分成公式。
    # 竹B/月卡等实收=0的行：不参与结算汇总，仅记录。
    if settings["rule_code"] == DAXIONG_NET_RECEIPT_RULE:
        if platform_amount is not None:
            system_amount = platform_amount
            difference = Decimal("0")
            validation_status = "pass"
            final_amount = platform_amount
        else:
            difference = None
            validation_status = "unvalidated"
            final_amount = Decimal("0")
        return {
            "billing_amount": _money(billing_amount),
            "share_amount": _money(share_amount),
            "system_settlement_amount": system_amount,
            "platform_settlement_amount": platform_amount,
            "settlement_difference": difference,
            "validation_status": validation_status,
            "settlement_amount": final_amount,
        }

    if incomplete(item, record):
        difference, validation_status = None, "incomplete"
        final_amount = platform_amount if platform_amount is not None else Decimal("0")
    elif platform_amount is None:
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

    if incomplete(record) or any(incomplete(item) for item in items):
        platform = _money(sum((_d(getattr(item, "platform_settlement_amount", None)) for item in items), Decimal("0")))
        return {"system_total": Decimal("0"), "platform_total": platform, "difference_total": None,
                "validation_status": "incomplete", "settlement_total": platform, "rounding_tail_applied": False}

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
