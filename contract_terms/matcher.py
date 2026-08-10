"""Deterministic contract matching and bill-vs-contract checks.

This module intentionally keeps matching/comparison logic pure so it can be
unit-tested without a database.  It never blocks a bill by itself; callers can
use the returned status as a preflight signal and still require human review.
"""

from __future__ import annotations

import calendar
import re
import unicodedata
from datetime import date
from typing import Any

EPS = 0.01


def _number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def _money(value: Any) -> float:
    parsed = _number(value)
    return round(parsed or 0.0, 2)


def normalize_company(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    text = re.sub(r"[\s()（）·,，.。\-_/\\]", "", text)
    for suffix in ("股份有限公司", "有限责任公司", "有限公司"):
        if text.endswith(suffix):
            text = text[: -len(suffix)]
            break
    return text


def normalize_game(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    # Marketing/version suffixes are often carried in parentheses in bill data
    # while the contract uses the base product name.  Remove only bracketed
    # suffixes; containment matching below remains conservative.
    text = re.sub(r"[（(][^（）()]{0,40}[）)]", "", text)
    text = re.sub(r"[\s·,，.。\-_/\\:：]", "", text)
    return text


def normalize_channel(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    return re.sub(r"[\s·,，.。\-_/\\:：]", "", text)


def _similarity(left: str, right: str, *, containment_floor: int = 4) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    shorter = min(len(left), len(right))
    if shorter >= containment_floor and (left in right or right in left):
        return 0.84
    return 0.0


def month_bounds(value: Any) -> tuple[date, date] | None:
    raw = str(value or "").strip()
    match = re.search(r"(20\d{2})\D{0,3}(1[0-2]|0?[1-9])(?:\D|$)", raw)
    if not match:
        compact = re.fullmatch(r"(20\d{2})(1[0-2]|0[1-9])", raw)
        if not compact:
            return None
        year, month = int(compact.group(1)), int(compact.group(2))
    else:
        year, month = int(match.group(1)), int(match.group(2))
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def _as_date(value: Any) -> date | None:
    raw = str(value or "").strip()[:10]
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def authorization_relation(month: Any, start: Any, end: Any) -> str:
    bounds = month_bounds(month)
    start_date = _as_date(start)
    end_date = _as_date(end)
    if bounds is None:
        return "unknown"
    if start_date is None and end_date is None:
        return "unknown"
    month_start, month_end = bounds
    if start_date is not None and start_date > month_end:
        return "out_of_range"
    if end_date is not None and end_date < month_start:
        return "out_of_range"
    return "covered"


def score_candidate(bill: dict, line: dict, candidate: dict) -> dict:
    bill_partner = normalize_company(bill.get("partner_name"))
    candidate_partners = [
        normalize_company(candidate.get("partner_name")),
        normalize_company(candidate.get("partner_short_name")),
        normalize_company(candidate.get("counterparty")),
    ]
    partner_similarity = max((_similarity(bill_partner, item, containment_floor=5) for item in candidate_partners), default=0.0)

    game_similarity = _similarity(
        normalize_game(line.get("game_name")),
        normalize_game(candidate.get("product_name")),
        containment_floor=4,
    )
    channel_similarity = _similarity(
        normalize_channel(bill.get("channel_name")),
        normalize_channel(candidate.get("channel_name")),
        containment_floor=3,
    )
    auth_relation = authorization_relation(
        line.get("settlement_cycle") or bill.get("settlement_month"),
        candidate.get("authorization_start"),
        candidate.get("authorization_end"),
    )

    # Product identity is the minimum requirement for a specific access-item
    # match.  Partner identity is expected too, but a missing bill partner must
    # not make otherwise exact legacy data impossible to inspect.
    eligible = game_similarity > 0 and (partner_similarity > 0 or not bill_partner)
    score = 0.0
    reasons: list[str] = []
    if eligible:
        score += 35 * (partner_similarity if bill_partner else 0.45)
        score += 40 * game_similarity
        if game_similarity == 1:
            reasons.append("游戏名称一致")
        else:
            reasons.append("游戏名称高度相似")
        if partner_similarity == 1:
            reasons.append("合作方一致")
        elif partner_similarity > 0:
            reasons.append("合作方名称相似")

        if auth_relation == "covered":
            score += 18
            reasons.append("账期在授权期内")
        elif auth_relation == "unknown":
            score += 6
            reasons.append("授权期信息不完整")
        else:
            score -= 30
            reasons.append("账期不在授权期内")

        bill_channel = normalize_channel(bill.get("channel_name"))
        candidate_channel = normalize_channel(candidate.get("channel_name"))
        if bill_channel and candidate_channel:
            if channel_similarity == 1:
                score += 7
                reasons.append("渠道一致")
            elif channel_similarity > 0:
                score += 4
                reasons.append("渠道名称相似")
            else:
                score -= 3
                reasons.append("渠道名称不同")
        elif candidate_channel:
            score += 2

    score = max(0.0, min(100.0, round(score, 1)))
    confidence = "high" if score >= 82 else "medium" if score >= 65 else "low"
    return {
        "eligible": eligible,
        "score": score,
        "confidence": confidence,
        "authorization_status": auth_relation,
        "reasons": reasons,
    }


def _check(
    key: str,
    label: str,
    status: str,
    *,
    bill_value: Any = None,
    contract_value: Any = None,
    message: str = "",
    difference: float | None = None,
) -> dict:
    return {
        "key": key,
        "label": label,
        "status": status,
        "bill_value": bill_value,
        "contract_value": contract_value,
        "difference": difference,
        "message": message,
    }


def _compare_rate(key: str, label: str, bill_value: Any, contract_value: Any) -> dict:
    bill_rate = _number(bill_value)
    contract_rate = _number(contract_value)
    if contract_rate is None:
        return _check(
            key,
            label,
            "missing",
            bill_value=bill_rate,
            contract_value=None,
            message=f"合同清单未维护{label}，暂不能自动核验。",
        )
    if bill_rate is None:
        return _check(
            key,
            label,
            "manual",
            bill_value=None,
            contract_value=contract_rate,
            message=f"账单没有可比较的{label}字段，请人工确认。",
        )
    difference = round(bill_rate - contract_rate, 4)
    if abs(difference) <= EPS:
        return _check(
            key,
            label,
            "pass",
            bill_value=bill_rate,
            contract_value=contract_rate,
            difference=difference,
            message=f"账单{label}与合同一致。",
        )
    return _check(
        key,
        label,
        "fail",
        bill_value=bill_rate,
        contract_value=contract_rate,
        difference=difference,
        message=f"账单{label}与合同相差 {abs(difference):g} 个百分点。",
    )


def compare_bill_to_candidate(bill: dict, line: dict, candidate: dict, match: dict) -> list[dict]:
    checks: list[dict] = []
    if match.get("authorization_status") == "out_of_range":
        checks.append(
            _check(
                "authorization",
                "授权期",
                "fail",
                bill_value=line.get("settlement_cycle") or bill.get("settlement_month"),
                contract_value="%s ~ %s" % (
                    candidate.get("authorization_start") or "-",
                    candidate.get("authorization_end") or "-",
                ),
                message="该账期不在合同合作清单的授权期限内。",
            )
        )
    elif match.get("authorization_status") == "unknown":
        checks.append(
            _check(
                "authorization",
                "授权期",
                "missing",
                bill_value=line.get("settlement_cycle") or bill.get("settlement_month"),
                contract_value=None,
                message="授权期信息不完整，无法自动确认账期覆盖。",
            )
        )
    else:
        checks.append(
            _check(
                "authorization",
                "授权期",
                "pass",
                bill_value=line.get("settlement_cycle") or bill.get("settlement_month"),
                contract_value="%s ~ %s" % (
                    candidate.get("authorization_start") or "-",
                    candidate.get("authorization_end") or "-",
                ),
                message="账期处于合同授权期内。",
            )
        )

    checks.append(_compare_rate("share_rate", "分成比例", line.get("share_rate"), candidate.get("share_rate")))
    checks.append(_compare_rate("tax_rate", "税率", line.get("tax_rate"), candidate.get("invoice_tax_rate")))

    bill_channel_fee_rate = _number(bill.get("channel_fee_rate"))
    contract_channel_fee_rate = _number(candidate.get("channel_fee_rate"))
    if bill_channel_fee_rate is not None or contract_channel_fee_rate is not None:
        # Ignore a legacy all-zero pair only when neither side explicitly carries
        # a meaningful fee rate.
        if (bill_channel_fee_rate or 0) > EPS or contract_channel_fee_rate is not None:
            checks.append(
                _compare_rate(
                    "channel_fee_rate",
                    "渠道费率",
                    bill_channel_fee_rate,
                    contract_channel_fee_rate,
                )
            )

    bill_test_fee = _money(line.get("test_fee"))
    contract_test_fee = _number(candidate.get("testing_fee"))
    if bill_test_fee > EPS or contract_test_fee is not None:
        if contract_test_fee is None:
            checks.append(
                _check(
                    "testing_fee",
                    "测试费",
                    "missing",
                    bill_value=bill_test_fee,
                    contract_value=None,
                    message="账单存在测试费，但合同条款未结构化维护测试费。",
                )
            )
        else:
            difference = round(bill_test_fee - contract_test_fee, 2)
            checks.append(
                _check(
                    "testing_fee",
                    "测试费",
                    "pass" if abs(difference) <= EPS else "fail",
                    bill_value=bill_test_fee,
                    contract_value=round(contract_test_fee, 2),
                    difference=difference,
                    message="账单测试费与合同一致。"
                    if abs(difference) <= EPS
                    else f"账单测试费与合同相差 {abs(difference):.2f} 元。",
                )
            )

    refund_amount = _money(line.get("refund_amount"))
    if refund_amount > EPS:
        refund_rule = str(candidate.get("refund_rule") or "").strip()
        checks.append(
            _check(
                "refund_rule",
                "退款扣除",
                "manual" if refund_rule else "missing",
                bill_value=refund_amount,
                contract_value=refund_rule or None,
                message="账单存在退款扣除，合同有退款规则，请按规则人工复核金额。"
                if refund_rule
                else "账单存在退款扣除，但合同未维护退款规则。",
            )
        )

    other_deductions = _money(line.get("other_deductions"))
    if other_deductions > EPS:
        deduction_rule = str(candidate.get("deduction_rule") or "").strip()
        checks.append(
            _check(
                "deduction_rule",
                "其他扣除",
                "manual" if deduction_rule else "missing",
                bill_value=other_deductions,
                contract_value=deduction_rule or None,
                message="账单存在其他扣除，合同有扣除规则，请人工复核组成与金额。"
                if deduction_rule
                else "账单存在其他扣除，但合同未维护其他扣除规则。",
            )
        )

    server_cost = _money(bill.get("server_cost"))
    if server_cost > EPS:
        bearer = str(candidate.get("server_cost_bearer") or "").strip()
        checks.append(
            _check(
                "server_cost",
                "服务器费用",
                "manual" if bearer else "missing",
                bill_value=server_cost,
                contract_value=bearer or None,
                message="账单存在服务器费用，请按合同约定的承担方人工复核。"
                if bearer
                else "账单存在服务器费用，但合同未维护承担方。",
            )
        )

    unit_price = _number(candidate.get("unit_price"))
    settlement_mode = str(candidate.get("settlement_mode") or "").strip()
    if unit_price is not None:
        checks.append(
            _check(
                "unit_price",
                "计费单价",
                "manual",
                bill_value=None,
                contract_value={"mode": settlement_mode, "unit_price": unit_price, "currency": candidate.get("currency") or "CNY"},
                message="合同采用单价/按量计费；当前账单未提供计费量字段，需人工确认或后续接入计费量自动核验。",
            )
        )

    return checks


def evaluate_line(bill: dict, line: dict, candidates: list[dict]) -> dict:
    ranked: list[tuple[dict, dict]] = []
    for candidate in candidates:
        match = score_candidate(bill, line, candidate)
        if match["eligible"]:
            ranked.append((candidate, match))
    ranked.sort(key=lambda item: item[1]["score"], reverse=True)

    candidate_previews = [
        {
            "contract_id": item[0].get("contract_id"),
            "contract_name": item[0].get("contract_name"),
            "access_item_id": item[0].get("access_item_id"),
            "product_name": item[0].get("product_name"),
            "channel_name": item[0].get("channel_name"),
            "score": item[1]["score"],
            "confidence": item[1]["confidence"],
            "authorization_status": item[1]["authorization_status"],
        }
        for item in ranked[:3]
    ]

    if not ranked:
        return {
            "line_id": line.get("line_id"),
            "game_name": line.get("game_name") or "",
            "settlement_cycle": line.get("settlement_cycle") or bill.get("settlement_month") or "",
            "status": "unmatched",
            "match": None,
            "candidates": [],
            "checks": [],
            "message": "没有找到同时匹配合作方和游戏的合同合作清单。",
        }

    candidate, match = ranked[0]
    checks = compare_bill_to_candidate(bill, line, candidate, match)
    failed = any(item["status"] == "fail" for item in checks)
    needs_review = any(item["status"] in {"missing", "manual"} for item in checks)
    low_confidence = match["confidence"] == "low"
    status = "fail" if failed else "warning" if needs_review or low_confidence else "pass"

    return {
        "line_id": line.get("line_id"),
        "game_name": line.get("game_name") or "",
        "settlement_cycle": line.get("settlement_cycle") or bill.get("settlement_month") or "",
        "status": status,
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
            "settlement_mode": candidate.get("settlement_mode"),
            "settlement_basis": candidate.get("settlement_basis"),
            "payment_terms": candidate.get("payment_terms"),
            "score": match["score"],
            "confidence": match["confidence"],
            "reasons": match["reasons"],
        },
        "candidates": candidate_previews,
        "checks": checks,
        "message": "发现合同差异，请先核验。"
        if status == "fail"
        else "已匹配合同，但仍有条款需要人工确认。"
        if status == "warning"
        else "合同关键字段与账单一致。",
    }


def summarize_results(results: list[dict]) -> dict:
    counts = {key: 0 for key in ("pass", "warning", "fail", "unmatched")}
    for result in results:
        status = str(result.get("status") or "unmatched")
        counts[status if status in counts else "unmatched"] += 1
    issue_count = counts["warning"] + counts["fail"] + counts["unmatched"]
    overall_status = "fail" if counts["fail"] else "warning" if issue_count else "pass"
    return {
        "total_lines": len(results),
        "matched_lines": len(results) - counts["unmatched"],
        "pass_count": counts["pass"],
        "warning_count": counts["warning"],
        "fail_count": counts["fail"],
        "unmatched_count": counts["unmatched"],
        "issue_count": issue_count,
        "overall_status": overall_status,
        "can_auto_confirm": bool(results) and issue_count == 0,
    }
