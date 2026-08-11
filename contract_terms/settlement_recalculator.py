"""Contract-driven standard settlement recomputation.

The calculator answers a narrow accounting question: given the raw values on a
bill line and the numeric terms on the matched contract access item, what would
the line settle to under the contract parameters?

It deliberately separates a *reference amount* from a *deterministic amount*.
Text-only refund/deduction clauses, unit-price contracts, fixed-fee contracts
without a structured fixed fee, and guarantee clauses are not silently guessed.
Those cases may still expose a useful reference amount, but they never produce a
blocking amount-difference failure.
"""

from __future__ import annotations

from typing import Any

EPS = 0.01
DEFAULT_TOLERANCE = 0.05


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


def _round2(value: Any) -> float:
    return round(_num(value), 2)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _pricing_mode(candidate: dict) -> str:
    text = " ".join(
        [
            _text(candidate.get("settlement_mode")),
            _text(candidate.get("settlement_basis")),
        ]
    ).lower()
    unit_price = _number(candidate.get("unit_price"))
    if unit_price is not None:
        return "unit_price"
    unit_tokens = (
        "cpa",
        "cpc",
        "cpi",
        "按量",
        "按个",
        "单价",
        "每个",
        "新增",
        "激活",
        "注册计费",
    )
    if any(token in text for token in unit_tokens):
        return "unit_price"
    fixed_tokens = ("固定结算", "固定金额", "一口价", "包月")
    if any(token in text for token in fixed_tokens):
        return "fixed_amount"
    return "revenue_share"


def _base_result(actual_amount: Any, tolerance: Any) -> dict:
    return {
        "status": "manual",
        "supported": False,
        "deterministic": False,
        "actual_amount": _round2(actual_amount),
        "expected_amount": None,
        "difference_amount": None,
        "variance_abs": None,
        "variance_direction": "unknown",
        "tolerance": max(0.0, _num(tolerance, DEFAULT_TOLERANCE)),
        "formula_code": "",
        "formula_label": "",
        "breakdown": {},
        "assumptions": [],
        "message": "合同结算规则暂不能自动重算。",
    }


def _finish(
    result: dict,
    *,
    expected: float,
    deterministic: bool,
    message: str,
) -> dict:
    expected = _round2(expected)
    actual = _round2(result.get("actual_amount"))
    difference = _round2(actual - expected)
    tolerance = max(0.0, _num(result.get("tolerance"), DEFAULT_TOLERANCE))
    if abs(difference) <= tolerance:
        direction = "equal"
    elif difference < 0:
        direction = "under"
    else:
        direction = "over"
    status = "manual" if not deterministic else "pass" if direction == "equal" else "fail"
    result.update(
        {
            "status": status,
            "supported": True,
            "deterministic": bool(deterministic),
            "expected_amount": expected,
            "difference_amount": difference,
            "variance_abs": _round2(abs(difference)),
            "variance_direction": direction,
            "message": message,
        }
    )
    return result


def _contract_testing_fee(line: dict, candidate: dict, assumptions: list[str]) -> tuple[float, bool]:
    contract_fee = _number(candidate.get("testing_fee"))
    bill_fee = _num(line.get("test_fee"))
    if contract_fee is not None:
        return max(0.0, contract_fee), True
    if abs(bill_fee) <= EPS:
        return 0.0, True
    assumptions.append("合同未结构化测试费，参考重算暂沿用账单测试费")
    return bill_fee, False


def _deduction_is_machine_verifiable(line: dict, candidate: dict, assumptions: list[str]) -> bool:
    deterministic = True
    refund = abs(_num(line.get("refund_amount")))
    other = abs(_num(line.get("other_deductions")))
    if refund > EPS:
        rule = _text(candidate.get("refund_rule"))
        assumptions.append("退款金额沿用账单实际值；合同退款规则仍需人工判断金额是否符合")
        deterministic = False
        if not rule:
            assumptions.append("合同未结构化退款规则")
    if other > EPS:
        rule = _text(candidate.get("deduction_rule"))
        assumptions.append("其他扣除沿用账单实际值；合同扣除规则仍需人工判断金额是否符合")
        deterministic = False
        if not rule:
            assumptions.append("合同未结构化其他扣除规则")
    return deterministic


def _guard_complex_contract(result: dict, candidate: dict) -> dict | None:
    pricing_mode = _pricing_mode(candidate)
    if pricing_mode == "unit_price":
        result.update(
            {
                "formula_code": "unit_price",
                "formula_label": "单价 / 按量结算",
                "message": "合同采用单价/按量计费，但账单没有结构化计费数量，暂不能计算合同标准结算金额。",
            }
        )
        return result
    if pricing_mode == "fixed_amount":
        result.update(
            {
                "formula_code": "fixed_amount",
                "formula_label": "固定金额结算",
                "message": "合同采用固定金额结算，当前合作清单未提供可直接用于本期重算的固定结算金额。",
            }
        )
        return result
    minimum_guarantee = _number(candidate.get("minimum_guarantee_amount"))
    if minimum_guarantee is not None and minimum_guarantee > EPS:
        result.update(
            {
                "formula_code": "minimum_guarantee",
                "formula_label": "含保底条款",
                "message": "合同存在保底金额，当前无法自动判断该保底属于单月、整期或差额补足，需人工复核。",
            }
        )
        return result
    return None


def calculate_rd_contract_amount(
    bill: dict,
    line: dict,
    candidate: dict,
    *,
    tolerance: float = DEFAULT_TOLERANCE,
) -> dict:
    result = _base_result(line.get("settlement_amount"), tolerance)
    guarded = _guard_complex_contract(result, candidate)
    if guarded is not None:
        return guarded

    share_rate = _number(candidate.get("share_rate"))
    if share_rate is None:
        result.update(
            {
                "formula_code": "rd_revenue_share",
                "formula_label": "研发流水分成",
                "message": "合同合作清单未维护分成比例，无法重算合同标准结算金额。",
            }
        )
        return result

    assumptions: list[str] = []
    deterministic = True
    contract_channel_fee = _number(candidate.get("channel_fee_rate"))
    bill_channel_fee = _num(bill.get("channel_fee_rate"))
    if contract_channel_fee is None:
        if abs(bill_channel_fee) <= EPS:
            contract_channel_fee = 0.0
            assumptions.append("合同未结构化通道费，因账单通道费为0，参考按0%重算")
            deterministic = False
        else:
            result.update(
                {
                    "formula_code": "rd_revenue_share",
                    "formula_label": "研发流水分成",
                    "message": "账单存在通道费，但合同合作清单未维护通道费率，无法可靠重算合同标准金额。",
                }
            )
            return result

    contract_tax = _number(candidate.get("invoice_tax_rate"))
    bill_tax = _num(line.get("tax_rate"))
    if contract_tax is None:
        if abs(bill_tax) <= EPS:
            contract_tax = 0.0
            assumptions.append("合同未结构化税率，因账单税率为0，参考按0%重算")
            deterministic = False
        else:
            result.update(
                {
                    "formula_code": "rd_revenue_share",
                    "formula_label": "研发流水分成",
                    "message": "账单税率参与研发结算，但合同未维护结构化税率，无法可靠重算合同标准金额。",
                }
            )
            return result

    testing_fee, testing_deterministic = _contract_testing_fee(line, candidate, assumptions)
    deterministic = deterministic and testing_deterministic
    deterministic = deterministic and _deduction_is_machine_verifiable(line, candidate, assumptions)

    revenue = _num(line.get("revenue"))
    discount = _num(line.get("discount_rate"), 1.0)
    effective_flow = revenue * discount
    coupon = _num(line.get("coupon_amount"))
    extra_fee = _num(line.get("extra_fee"))
    header_refund = _num(line.get("header_refund_amount"))
    billing_base = effective_flow - coupon - testing_fee - extra_fee - header_refund
    after_channel_fee = billing_base * (1 - contract_channel_fee / 100)
    after_tax = after_channel_fee * (1 - contract_tax / 100)
    expected = after_tax * share_rate / 100

    result.update(
        {
            "formula_code": "rd_revenue_share",
            "formula_label": "研发流水分成",
            "breakdown": {
                "raw_flow": _round2(revenue),
                "discount_rate": round(discount, 6),
                "effective_flow": _round2(effective_flow),
                "coupon_amount": _round2(coupon),
                "testing_fee": _round2(testing_fee),
                "extra_fee": _round2(extra_fee),
                "header_refund_amount": _round2(header_refund),
                "billing_base": _round2(billing_base),
                "contract_channel_fee_rate": round(contract_channel_fee, 4),
                "contract_tax_rate": round(contract_tax, 4),
                "contract_share_rate": round(share_rate, 4),
            },
            "assumptions": assumptions,
        }
    )
    message = (
        "按合同数字条款重算完成。"
        if deterministic
        else "已生成合同参考重算金额，但存在未结构化/文本型条款，金额仅作复核参考，不作为自动阻断依据。"
    )
    return _finish(result, expected=expected, deterministic=deterministic, message=message)


def calculate_channel_contract_amount(
    bill: dict,
    line: dict,
    candidate: dict,
    *,
    tolerance: float = DEFAULT_TOLERANCE,
) -> dict:
    result = _base_result(line.get("settlement_amount"), tolerance)
    guarded = _guard_complex_contract(result, candidate)
    if guarded is not None:
        return guarded

    share_rate = _number(candidate.get("share_rate"))
    if share_rate is None:
        result.update(
            {
                "formula_code": "channel_revenue_share",
                "formula_label": "渠道流水分成",
                "message": "合同合作清单未维护分成比例，无法重算合同标准结算金额。",
            }
        )
        return result

    assumptions: list[str] = []
    deterministic = True
    contract_channel_fee = _number(candidate.get("channel_fee_rate"))
    bill_fee_mode = _text(bill.get("channel_fee_mode")) or "fixed"
    bill_fee_rate = _num(bill.get("channel_fee_rate"))

    if contract_channel_fee is not None:
        fee_mode = "percent" if abs(contract_channel_fee) > EPS else "none"
    elif bill_fee_mode == "none" and abs(bill_fee_rate) <= EPS and abs(_num(line.get("gateway_cost"))) <= EPS:
        contract_channel_fee = 0.0
        fee_mode = "none"
        assumptions.append("合同未结构化通道费，因账单当前无通道费，参考按0%重算")
        deterministic = False
    elif bill_fee_mode == "fixed":
        result.update(
            {
                "formula_code": "channel_fixed_gateway_fee",
                "formula_label": "渠道分成 + 固定通道费",
                "message": "账单采用固定通道费，但合同合作清单没有结构化固定费金额，暂不能可靠重算合同标准金额。",
            }
        )
        return result
    else:
        result.update(
            {
                "formula_code": "channel_revenue_share",
                "formula_label": "渠道流水分成",
                "message": "账单存在通道费规则，但合同合作清单未维护通道费率，暂不能可靠重算合同标准金额。",
            }
        )
        return result

    tax_mode = _text(bill.get("tax_mode")) or "share"
    contract_tax = _number(candidate.get("invoice_tax_rate"))
    if tax_mode in {"share", "after_fee"} and contract_tax is None:
        result.update(
            {
                "formula_code": "channel_revenue_share",
                "formula_label": "渠道流水分成",
                "message": "当前渠道规则会扣税，但合同未维护结构化税率，暂不能可靠重算合同标准金额。",
            }
        )
        return result
    if tax_mode == "none":
        effective_tax = 0.0
    else:
        effective_tax = _num(contract_tax)

    testing_fee, testing_deterministic = _contract_testing_fee(line, candidate, assumptions)
    deterministic = deterministic and testing_deterministic
    deterministic = deterministic and _deduction_is_machine_verifiable(line, candidate, assumptions)

    raw_flow = _num(line.get("billing_flow"))
    discount = _num(line.get("discount_factor"), 1.0)
    effective_flow = raw_flow * discount
    voucher = _num(line.get("voucher_cost"))
    no_worry = _num(line.get("no_worry_cost"))
    refund = _num(line.get("refund_amount"))
    welfare = _num(line.get("welfare_cost"))
    coin = _num(line.get("coin_cost"))
    billing_base = effective_flow - voucher - no_worry - refund - testing_fee - welfare - coin
    share_amount = billing_base * share_rate / 100
    after_fee = share_amount
    if fee_mode == "percent":
        after_fee = share_amount * (1 - _num(contract_channel_fee) / 100)

    if tax_mode == "share":
        expected = after_fee - share_amount * effective_tax / 100
    elif tax_mode == "after_fee":
        expected = after_fee * (1 - effective_tax / 100)
    else:
        expected = after_fee

    result.update(
        {
            "formula_code": "channel_revenue_share",
            "formula_label": "渠道流水分成",
            "breakdown": {
                "raw_flow": _round2(raw_flow),
                "discount_factor": round(discount, 6),
                "effective_flow": _round2(effective_flow),
                "voucher_cost": _round2(voucher),
                "no_worry_cost": _round2(no_worry),
                "refund_cost": _round2(refund),
                "testing_fee": _round2(testing_fee),
                "welfare_cost": _round2(welfare),
                "coin_cost": _round2(coin),
                "billing_base": _round2(billing_base),
                "contract_share_rate": round(share_rate, 4),
                "fee_mode": fee_mode,
                "contract_channel_fee_rate": round(_num(contract_channel_fee), 4),
                "tax_mode": tax_mode,
                "contract_tax_rate": round(effective_tax, 4),
            },
            "assumptions": assumptions,
        }
    )
    message = (
        "按合同数字条款重算完成。"
        if deterministic
        else "已生成合同参考重算金额，但存在未结构化/文本型条款，金额仅作复核参考，不作为自动阻断依据。"
    )
    return _finish(result, expected=expected, deterministic=deterministic, message=message)


def calculate_contract_standard_amount(
    bill_type: str,
    bill: dict,
    line: dict,
    candidate: dict,
    *,
    tolerance: float = DEFAULT_TOLERANCE,
) -> dict:
    if bill_type == "rd":
        return calculate_rd_contract_amount(bill, line, candidate, tolerance=tolerance)
    if bill_type == "channel":
        return calculate_channel_contract_amount(bill, line, candidate, tolerance=tolerance)
    result = _base_result(line.get("settlement_amount"), tolerance)
    result["message"] = "不支持的账单类型。"
    return result


def summarize_contract_amounts(lines: list[dict]) -> dict:
    amount_rows = [line.get("contract_amount") or {} for line in lines]
    comparable = [row for row in amount_rows if row.get("expected_amount") is not None]
    deterministic = [row for row in comparable if row.get("deterministic")]
    blocking = [row for row in deterministic if row.get("status") == "fail"]
    actual_total = _round2(sum(_num(row.get("actual_amount")) for row in comparable))
    expected_total = _round2(sum(_num(row.get("expected_amount")) for row in comparable))
    difference_total = _round2(actual_total - expected_total) if comparable else None
    total_lines = len(lines)
    deterministic_complete = bool(total_lines) and len(deterministic) == total_lines
    comparable_complete = bool(total_lines) and len(comparable) == total_lines
    if blocking:
        status = "fail"
    elif deterministic_complete:
        status = "pass"
    else:
        status = "warning"
    return {
        "status": status,
        "total_lines": total_lines,
        "comparable_lines": len(comparable),
        "deterministic_lines": len(deterministic),
        "blocking_difference_lines": len(blocking),
        "comparable_complete": comparable_complete,
        "deterministic_complete": deterministic_complete,
        "actual_amount": actual_total if comparable else None,
        "expected_amount": expected_total if comparable else None,
        "difference_amount": difference_total,
        "variance_abs": _round2(abs(difference_total)) if difference_total is not None else None,
        "variance_direction": (
            "equal"
            if difference_total is not None and abs(difference_total) <= DEFAULT_TOLERANCE
            else "under"
            if difference_total is not None and difference_total < 0
            else "over"
            if difference_total is not None
            else "unknown"
        ),
    }
