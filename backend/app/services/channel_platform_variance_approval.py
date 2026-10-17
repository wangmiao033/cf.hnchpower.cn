"""Audited confirmation for both small and evidence-backed platform variances.

This does not change how a channel bill is calculated or how platform figures
are stored. It checks persisted line amounts, caps the SUM of absolute
line discrepancies at ¥0.50, and returns evidence for one admin approval.
Contract reconciliation is a separate control and must remain satisfied.
Substantive differences require an attached source statement and admin approval.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from fastapi import HTTPException

from app.services.channel_settlement_engine import aggregate_validation, calculate_channel_line

MAX_PLATFORM_VARIANCE_CENTS = 50

ALLOWED_FINANCIAL_CHECKS = frozenset({
    "share_rate",
    "channel_fee_rate",
    "tax_rate",
    "testing_fee",
    "contract_standard_settlement",
})
_BLOCKED_AUTHORIZATION = frozenset({
    "expired", "out_of_range", "invalid", "not_covered",
})


def _conflict(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=409, detail={"error": code, "message": message})


def _cents(value: Any) -> int:
    try:
        if value is None or value == "":
            raise InvalidOperation
        amount = Decimal(str(value))
        if not amount.is_finite():
            raise InvalidOperation
        return int((amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) * 100).to_integral_value())
    except (TypeError, ValueError, InvalidOperation):
        raise _conflict("platform_variance_invalid_amount", "金额不是有效数字，请检查账单明细") from None


def _amounts_align_cents(expected: Any, actual: Any) -> bool:
    try:
        return _cents(expected) == _cents(actual)
    except HTTPException:
        return False


def _case_monetary_fields(case: dict) -> tuple[Any, Any, Any]:
    """Resolve amounts from persisted columns or the audit snapshot."""
    expected = case.get("expected_amount")
    actual = case.get("actual_amount")
    difference = case.get("difference_amount")
    snapshot = case.get("source_snapshot_json")
    if isinstance(snapshot, dict):
        amount = snapshot.get("contract_amount")
        if isinstance(amount, dict):
            if expected is None:
                expected = amount.get("expected_amount")
            if actual is None:
                actual = amount.get("actual_amount")
            if difference is None:
                difference = amount.get("difference_amount")
    return expected, actual, difference


def is_rate_only_contract_exception(case: dict) -> bool:
    """Money already matches; only share/fee/tax metadata still disagrees with contract."""
    if case.get("status") not in ("pending", "processing"):
        return False
    expected, actual, difference = _case_monetary_fields(case)
    if not _amounts_align_cents(expected, actual):
        return False
    snapshot = case.get("source_snapshot_json")
    if isinstance(snapshot, dict):
        match = snapshot.get("match")
        if isinstance(match, dict) and str(match.get("authorization_status") or "").lower() in _BLOCKED_AUTHORIZATION:
            return False
        checks = snapshot.get("checks") or []
        saw_financial_fail = False
        for check in checks:
            if not isinstance(check, dict) or check.get("status") != "fail":
                continue
            key = str(check.get("key") or "")
            if key not in ALLOWED_FINANCIAL_CHECKS:
                return False
            saw_financial_fail = True
        if checks:
            return saw_financial_fail
    try:
        if difference is not None and _cents(difference) != 0:
            return False
    except HTTPException:
        return False
    variance = case.get("variance_abs")
    if variance is not None:
        try:
            if _cents(variance) != 0:
                return False
        except HTTPException:
            return False
    return True


def assess_channel_platform_variance(
    bill: Any, lines: list[Any], *, allow_documented_variance: bool = False
) -> dict:
    """Recompute persisted figures without reclassifying or silently offsetting errors.

    The default call remains strictly limited to 50 cents. The documented
    path is only used by the API after an administrator has supplied a real
    platform attachment; it does not grant any automatic approval.
    """
    if str(getattr(bill, "validation_status", "") or "").lower() != "fail":
        raise _conflict("platform_variance_not_required", "这张账单没有待人工核准的平台差异，请使用正常核对")
    if not (1 <= len(lines) <= 100):
        raise _conflict("platform_variance_lines_invalid", "请保留完整的逐游戏明细（最多100行）")
    if abs(_cents(getattr(bill, "settlement_adjustment_amount", 0) or 0)) or getattr(bill, "settlement_final_override", None) is not None:
        raise _conflict("platform_variance_adjusted_bill", "账单存在独立结算调整，请先核实调整依据，不能同时按小额尾差放行")

    total_abs_cents = 0
    affected_lines: list[dict] = []
    seen = set()
    for item in lines:
        line_id = str(getattr(item, "id", "") or "")
        if not line_id or line_id in seen:
            raise _conflict("platform_variance_line_identity", "游戏明细编号缺失或重复，无法审计")
        seen.add(line_id)
        if getattr(item, "platform_settlement_amount", None) is None:
            raise _conflict("platform_variance_missing_platform", "存在尚未录入平台结算金额的游戏，请先补齐")
        if not str(getattr(item, "game_name", "") or "").strip() or not str(getattr(item, "settlement_cycle", "") or "").strip():
            raise _conflict("platform_variance_missing_identity", "游戏名称或结算月份缺失，请先补齐")
        computed = calculate_channel_line(item, bill)
        for field in ("system_settlement_amount", "platform_settlement_amount", "settlement_amount", "settlement_difference"):
            if _cents(getattr(item, field, None)) != _cents(computed[field]):
                raise _conflict("platform_variance_stale_line", "账单计算明细已发生变化，请重新保存或刷新后核对")
        if str(getattr(item, "validation_status", "") or "") != computed["validation_status"]:
            raise _conflict("platform_variance_stale_status", "账单校验状态与当前计算不一致，请重新保存账单")

        system = _cents(computed["system_settlement_amount"])
        platform = _cents(computed["platform_settlement_amount"])
        difference = system - platform
        total_abs_cents += abs(difference)
        if difference:
            affected_lines.append({
                "line_id": line_id,
                "game_name": str(item.game_name),
                "settlement_cycle": str(item.settlement_cycle),
                "system_amount": system / 100,
                "platform_amount": platform / 100,
                "difference_cents": difference,
            })

    if total_abs_cents <= 0:
        raise _conflict("platform_variance_not_required", "系统与平台金额已一致，不需要尾差确认")
    # SUM(abs(line variance)) prevents a ¥20.21 overstatement being concealed
    # by an offsetting -¥20.00 line, while net variance appears to be ¥0.21.
    if total_abs_cents > MAX_PLATFORM_VARIANCE_CENTS and not allow_documented_variance:
        raise _conflict("platform_variance_too_large", "逐游戏差异绝对值合计超过¥0.50，请上传平台原始账单、记录人工核对依据后确认")

    recomputed = aggregate_validation(lines, bill)
    if recomputed["validation_status"] != "fail":
        raise _conflict("platform_variance_stale_status", "当前逐游戏校验与账单状态不一致，请刷新核对")
    for stored, calculated in (
        (getattr(bill, "system_settlement_amount", None), recomputed["system_total"]),
        (getattr(bill, "platform_settlement_amount", None), recomputed["platform_total"]),
        (getattr(bill, "settlement_difference", None), recomputed["difference_total"]),
        (getattr(bill, "settlement_amount", None), recomputed["settlement_total"]),
    ):
        if stored is None or calculated is None or _cents(stored) != _cents(calculated):
            raise _conflict("platform_variance_stale_total", "账单总额与逐游戏明细不一致，请重新保存账单")

    system_cents = _cents(recomputed["system_total"])
    platform_cents = _cents(recomputed["platform_total"])
    settlement_cents = _cents(getattr(bill, "settlement_amount", None))
    signed_difference = system_cents - platform_cents
    # A large positive and negative deviation that almost cancels out needs a
    # real line-rule correction, not a bundled one-click financial approval.
    if (
        allow_documented_variance
        and total_abs_cents > MAX_PLATFORM_VARIANCE_CENTS
        and total_abs_cents - abs(signed_difference) > 2
    ):
        raise _conflict(
            "platform_variance_offsetting",
            "游戏明细存在相互抵消的重大差异，请逐游戏核对计算规则，不能直接按合计数确认",
        )
    if settlement_cents != platform_cents or settlement_cents < 0:
        raise _conflict("platform_variance_settlement_mismatch", "本期结算金额不是平台金额，不能作为纯尾差确认")
    if signed_difference == 0 or (
        abs(signed_difference) > MAX_PLATFORM_VARIANCE_CENTS and not allow_documented_variance
    ):
        raise _conflict("platform_variance_too_large", "系统与平台差额需要上传原始结算凭证，并由管理员人工核准")

    return {
        "review_kind": "documented" if total_abs_cents > MAX_PLATFORM_VARIANCE_CENTS else "small",
        "system_amount": system_cents / 100,
        "platform_amount": platform_cents / 100,
        "recorded_settlement_amount": settlement_cents / 100,
        "signed_difference_cents": signed_difference,
        "absolute_line_difference_cents": total_abs_cents,
        "affected_lines": affected_lines,
        "line_ids": sorted(seen),
    }


def assert_no_open_contract_exceptions(cases: list[dict], lines: list[Any]) -> None:
    """Never bypass an active contract approval/adjustment for the current bill."""
    current = {
        (str(getattr(line, "id", "") or ""), str(getattr(line, "game_name", "") or "").strip(), str(getattr(line, "settlement_cycle", "") or "").strip())
        for line in lines
    }
    current_ids = {item[0] for item in current}
    game_periods = {(item[1], item[2]) for item in current}
    for case in cases:
        related = str(case.get("line_id") or "") in current_ids or (
            str(case.get("game_name") or "").strip(), str(case.get("settlement_cycle") or "").strip()
        ) in game_periods
        if not related:
            continue
        if case.get("status") in ("pending", "processing"):
            if is_rate_only_contract_exception(case):
                # Platform-tail confirmation settles on the saved/platform amount.
                # A rate-only metadata mismatch does not change receivables here.
                continue
            raise _conflict("contract_difference_unresolved", "本账单仍有待处理的合同差异，请先完成相应审核")
        snapshot = case.get("source_snapshot_json")
        if not isinstance(snapshot, dict):
            continue
        match = snapshot.get("match")
        if isinstance(match, dict) and str(match.get("authorization_status") or "").lower() in _BLOCKED_AUTHORIZATION:
            raise _conflict("contract_authorization_failed", "合同授权范围存在问题，不能使用平台尾差确认")
        for check in snapshot.get("checks") or []:
            if (
                isinstance(check, dict)
                and check.get("status") == "fail"
                and check.get("key") not in ALLOWED_FINANCIAL_CHECKS
            ):
                raise _conflict("contract_identity_failed", "合同主体、授权或其他非金额核验存在问题，不能强制确认")
