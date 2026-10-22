"""V3.0 settlement-basis guard for contract standard amount recomputation.

The product/version discount shown on a bill is not automatically a settlement
multiplier. Already-paid flow must not be discounted a second time, whereas
channel raw billing flow still needs its explicit conversion to paid flow.
Contract basis and input-flow representation are separate facts. Ambiguous contract bases are downgraded to manual review instead of
creating a false blocking variance.
"""

from __future__ import annotations

from typing import Any

try:
    from .settlement_recalculator import (
        DEFAULT_TOLERANCE,
        calculate_contract_standard_amount as _calculate_base,
    )
except ImportError:
    from settlement_recalculator import (
        DEFAULT_TOLERANCE,
        calculate_contract_standard_amount as _calculate_base,
    )


EPS = 0.000001
ACTUAL_PAID_TOKENS = (
    "按实付",
    "实付结算",
    "实际支付",
    "实收结算",
    "实收金额",
    "支付金额",
    "充值实付",
    "用户实付",
    "实际到账",
)
DISCOUNTED_FLOW_TOKENS = (
    "折后流水",
    "折扣后流水",
    "折后金额",
    "折扣后金额",
    "按折扣",
    "折算流水",
    "折算金额",
)


def _text(value: Any) -> str:
    return str(value or "").strip().lower()


def _number(value: Any, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number == number else fallback


def _basis_text(candidate: dict) -> str:
    return " ".join(
        [
            _text(candidate.get("settlement_mode")),
            _text(candidate.get("settlement_basis")),
        ]
    )


def _basis_mode(candidate: dict) -> str:
    text = _basis_text(candidate)
    if any(token in text for token in ACTUAL_PAID_TOKENS):
        return "actual_paid"
    if any(token in text for token in DISCOUNTED_FLOW_TOKENS):
        return "discounted_flow"
    return "ambiguous"


def _with_assumption(result: dict, message: str) -> dict:
    updated = dict(result)
    assumptions = list(updated.get("assumptions") or [])
    if message not in assumptions:
        assumptions.append(message)
    updated["assumptions"] = assumptions
    return updated


def _calculate_channel_amount(
    bill: dict, line: dict, candidate: dict, *, tolerance: float
) -> dict:
    """Keep storage representation separate from the contract settlement basis.

    The caller supplies billing_flow_basis from the data source, never from a
    product name: raw line items need conversion; actual_paid aggregates do not.
    A contract saying "actual paid" alone cannot establish that representation.
    """
    basis_mode = _basis_mode(candidate)
    explicit_basis = _text(line.get("revenue_basis"))
    flow_basis = {
        "pre_discount": "raw", "post_discount": "actual_paid",
    }.get(explicit_basis, _text(line.get("billing_flow_basis")))
    discount = _number(line.get("discount_factor"), 1.0)
    guarded_line = dict(line)
    representation_known = flow_basis in {"raw", "actual_paid"}
    if (flow_basis == "actual_paid" and explicit_basis != "post_discount") or not representation_known:
        guarded_line["discount_factor"] = 1.0

    result = _calculate_base(
        "channel", bill, guarded_line, candidate, tolerance=tolerance
    )
    breakdown = dict(result.get("breakdown") or {})
    breakdown["bill_discount_reference"] = discount
    breakdown["billing_flow_basis"] = flow_basis if representation_known else "unknown"
    if explicit_basis in {"pre_discount", "post_discount"}:
        breakdown["revenue_basis"] = explicit_basis
    breakdown["contract_settlement_basis"] = basis_mode
    result["breakdown"] = breakdown
    if flow_basis == "raw" and abs(discount - 1.0) > EPS:
        result = _with_assumption(
            result,
            f"渠道原始流水按账单转换系数 {discount:g} 折算一次为结算流水，合同实付口径不取消该转换",
        )
    elif flow_basis == "actual_paid" and abs(discount - 1.0) > EPS:
        result = _with_assumption(
            result,
            f"渠道流水已为实付/折后金额，账单折扣系数 {discount:g} 不重复乘入结算流水",
        )

    unknown_representation = not representation_known and abs(discount - 1.0) > EPS
    if result.get("expected_amount") is not None and (
        basis_mode == "ambiguous" or unknown_representation
    ):
        result["status"] = "manual"
        result["deterministic"] = False
        if unknown_representation:
            result["message"] = (
                "渠道账单存在折扣系数，但未明确流水是原始流水还是已折算实付金额；"
                "当前金额仅作参考，必须人工确认后才能形成合同差异。"
            )
        else:
            result["message"] = (
                "合同未明确结算基数；当前仅按账单流水口径生成参考金额，"
                "必须人工确认后才能形成合同差异。"
            )
        if basis_mode == "ambiguous":
            result["breakdown"]["contract_settlement_basis"] = "ambiguous_manual_review"
    return result


def calculate_contract_standard_amount_v4(
    bill_type: str,
    bill: dict,
    line: dict,
    candidate: dict,
    *,
    tolerance: float = DEFAULT_TOLERANCE,
) -> dict:
    if bill_type == "channel":
        return _calculate_channel_amount(bill, line, candidate, tolerance=tolerance)

    basis_mode = _basis_mode(candidate)
    guarded_line = dict(line)
    discount_key = "discount_rate" if bill_type == "rd" else "discount_factor"
    bill_discount = _number(guarded_line.get(discount_key), 1.0)

    if basis_mode == "actual_paid":
        guarded_line[discount_key] = 1.0
        result = _calculate_base(
            bill_type,
            bill,
            guarded_line,
            candidate,
            tolerance=tolerance,
        )
        if abs(bill_discount - 1.0) > EPS:
            result = _with_assumption(
                result,
                f"合同明确按实付/实收口径结算，账单中的折扣系数 {bill_discount:g} 仅作为产品/版本信息，不二次乘入结算流水",
            )
            breakdown = dict(result.get("breakdown") or {})
            breakdown["bill_discount_reference"] = bill_discount
            breakdown["contract_settlement_basis"] = "actual_paid"
            result["breakdown"] = breakdown
        return result

    if basis_mode == "discounted_flow":
        result = _calculate_base(
            bill_type,
            bill,
            guarded_line,
            candidate,
            tolerance=tolerance,
        )
        breakdown = dict(result.get("breakdown") or {})
        breakdown["contract_settlement_basis"] = "discounted_flow"
        result["breakdown"] = breakdown
        return result

    if abs(bill_discount - 1.0) <= EPS:
        return _calculate_base(
            bill_type,
            bill,
            guarded_line,
            candidate,
            tolerance=tolerance,
        )

    # A non-1 bill discount with no explicit contractual settlement basis is
    # dangerous: using it can understate the contractual expected amount by
    # 90%/95% on 0.1/0.05 products. Produce a useful reference using raw paid
    # flow, but never create a blocking difference from that assumption.
    guarded_line[discount_key] = 1.0
    result = _calculate_base(
        bill_type,
        bill,
        guarded_line,
        candidate,
        tolerance=tolerance,
    )
    if result.get("expected_amount") is not None:
        result = dict(result)
        result["status"] = "manual"
        result["deterministic"] = False
        result["message"] = (
            "账单存在折扣系数，但合同未明确“按实付”还是“按折后流水”作为结算基数；"
            "当前仅按原始实付流水生成参考金额，必须人工确认后才能形成合同差异。"
        )
        result = _with_assumption(
            result,
            f"账单折扣系数 {bill_discount:g} 未获得合同结算基数条款支持，因此不自动参与合同标准金额",
        )
        breakdown = dict(result.get("breakdown") or {})
        breakdown["bill_discount_reference"] = bill_discount
        breakdown["contract_settlement_basis"] = "ambiguous_manual_review"
        result["breakdown"] = breakdown
    return result
