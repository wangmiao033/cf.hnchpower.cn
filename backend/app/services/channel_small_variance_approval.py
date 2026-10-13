"""Finance-only approval of an already documented small channel contract variance.

This validation does NOT create a new contract exception or rewrite any rate/amount.
It verifies a saved and explicitly approved exception (including historical line
IDs from legacy delete/reinsert saves), rejects authorization/identity failures,
and caps the total distinct-line monetary variance at 0.50 CNY.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from fastapi import HTTPException

MAX_VARIANCE_CENTS = 50
ALLOWABLE_FINANCIAL_CHECKS = frozenset({
    "share_rate", "channel_fee_rate", "tax_rate",
    "testing_fee", "contract_standard_settlement",
})


def _conflict(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=409, detail={"error": code, "message": message})


def _cents(value: Any) -> int:
    try:
        number = Decimal(str(value))
        if not number.is_finite():
            raise InvalidOperation
        return int((number.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) * 100).to_integral_value())
    except (TypeError, ValueError, InvalidOperation):
        raise _conflict("invalid_variance_amount", "结算金额无法安全核验，请检查账单原始数据") from None


def _line_key(game: Any, month: Any) -> tuple[str, str]:
    return ("".join(str(game or "").split()).lower(), str(month or "").strip())


def _snapshot_checks(case: dict) -> list[dict]:
    snapshot = case.get("source_snapshot_json")
    if not isinstance(snapshot, dict):
        return []
    checks = snapshot.get("checks")
    return checks if isinstance(checks, list) else []


def _approval_matches_line(case: dict, line: Any) -> bool:
    if (
        case.get("status") != "resolved"
        or case.get("handling_type") != "accept_difference"
        or case.get("reason_type") != "商务特殊约定"
        or not str(case.get("description") or "").strip()
    ):
        return False
    if _cents(case.get("actual_amount")) != _cents(line.settlement_amount):
        return False
    checks = _snapshot_checks(case)
    # Stale historical line IDs are acceptable ONLY if the stored economic
    # terms still match. Without check evidence, only an exact line ID is valid.
    if str(case.get("line_id")) != str(line.id) and not checks:
        return False
    for check in checks:
        if not isinstance(check, dict):
            return False
        if check.get("status") == "fail" and check.get("key") not in ALLOWABLE_FINANCIAL_CHECKS:
            return False
        if check.get("key") in {"share_rate", "channel_fee_rate", "tax_rate"}:
            stored = check.get("bill_value")
            if stored is None:
                continue
            if check.get("key") == "share_rate":
                latest = getattr(line, "share_rate", None)
            elif check.get("key") == "tax_rate":
                latest = getattr(line, "tax_rate", None)
            else:
                latest = getattr(line, "channel_fee_rate", None)
            if latest is None:
                if check.get("status") == "fail":
                    return False
                continue
            try:
                if abs(Decimal(str(stored)) - Decimal(str(latest))) > Decimal("0.0001"):
                    return False
            except InvalidOperation:
                return False
    snapshot = case.get("source_snapshot_json") or {}
    match = snapshot.get("match") if isinstance(snapshot, dict) else None
    if isinstance(match, dict) and str(match.get("authorization_status") or "").lower() in {
        "expired", "out_of_range", "invalid", "not_covered"
    }:
        return False
    return True


def assess_channel_small_variance_approval(
    bill_id: str,
    lines: list[Any],
    cases: list[dict],
) -> dict:
    """Return unique approved cases and cents; fail closed for stale/risky cases."""
    if not lines:
        raise _conflict("bill_lines_missing", "没有服务器保存的逐游戏明细，不能进行小额差异确认")
    if len(lines) > 100:
        raise _conflict("too_many_bill_lines", "账单明细过多，请使用常规合同核对流程")

    line_by_key: dict[tuple[str, str], Any] = {}
    for line in lines:
        key = _line_key(line.game_name, line.settlement_cycle)
        if not key[0] or not key[1] or key in line_by_key:
            raise _conflict("ambiguous_bill_lines", "游戏与账期无法唯一对应合同差异，请使用常规核对流程")
        line_by_key[key] = line

    relevant: dict[tuple[str, str], list[dict]] = {key: [] for key in line_by_key}
    for item in cases:
        if str(item.get("bill_id")) != str(bill_id) or item.get("bill_type") != "channel":
            raise _conflict("cross_bill_difference", "读取到其他账单的合同差异，已阻止跨账单确认")
        key = _line_key(item.get("game_name"), item.get("settlement_cycle"))
        if key in relevant:
            relevant[key].append(item)

    selected = []
    aggregate_cents = 0
    for key, line in line_by_key.items():
        line_cases = relevant[key]
        # A pending case for the currently saved line cannot be waived with an
        # unrelated old approval. It must first be explicitly accepted.
        if any(
            str(item.get("line_id")) == str(line.id)
            and item.get("status") in {"pending", "processing"}
            for item in line_cases
        ):
            raise _conflict(
                "difference_not_approved",
                "当前账单仍有待处理的合同差异，请先完成特殊结算确认并留痕",
            )

        valid = next(
            (case for case in line_cases if _approval_matches_line(case, line)),
            None,
        )
        if valid is None:
            # A line with only stale or unresolved exceptions must not silently
            # become approved. Clean lines with no case do not need an exception.
            if line_cases:
                raise _conflict(
                    "difference_evidence_stale",
                    "合同差异没有匹配当前分成、通道费与实际金额的人工批准记录，不能强制核对",
                )
            continue

        cents = abs(_cents(valid.get("expected_amount")) - _cents(valid.get("actual_amount")))
        if cents > MAX_VARIANCE_CENTS:
            raise _conflict(
                "variance_too_large",
                "存在单项合同金额差异超过0.50元，不能使用小额强制确认",
            )
        aggregate_cents += cents
        selected.append({
            "case_id": str(valid["id"]),
            "line_id": str(line.id),
            "game_name": str(line.game_name or ""),
            "settlement_cycle": str(line.settlement_cycle or ""),
            "expected_amount": float(valid["expected_amount"]),
            "actual_amount": float(valid["actual_amount"]),
            "variance_cents": cents,
        })

    if not selected:
        raise _conflict(
            "no_approved_variance",
            "当前账单没有可核验的已批准小额差异；请使用正常的“保存并确认核对”",
        )
    if aggregate_cents > MAX_VARIANCE_CENTS:
        raise _conflict(
            "variance_total_too_large",
            "多笔小额差异合计超过0.50元，请使用常规合同差异处理流程",
        )
    return {
        "difference_cents": aggregate_cents,
        "approved_lines": selected,
    }
