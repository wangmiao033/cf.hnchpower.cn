"""Recommend R&D bill entry fields from contract access items before a bill exists."""

from __future__ import annotations

from typing import Any

try:
    from .matcher import score_candidate
    from .settlement_recalculator_v4 import _basis_mode, calculate_contract_standard_amount_v4
except ImportError:
    from matcher import score_candidate
    from settlement_recalculator_v4 import _basis_mode, calculate_contract_standard_amount_v4

EPS = 0.000001


def _number(value: Any, fallback: float | None = None) -> float | None:
    if value in (None, ""):
        return fallback
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed == parsed else fallback


def _safe_number(value: Any, fallback: float = 0.0) -> float:
    parsed = _number(value, fallback)
    return fallback if parsed is None else parsed


def _text(value: Any) -> str:
    return str(value or "").strip()


def _candidate_snapshot(candidate: dict, scored: dict) -> dict:
    return {
        "contract_id": candidate.get("contract_id"),
        "contract_name": candidate.get("contract_name") or "",
        "contract_no": candidate.get("contract_no"),
        "access_item_id": candidate.get("access_item_id"),
        "product_name": candidate.get("product_name") or "",
        "partner_name": candidate.get("partner_name") or candidate.get("counterparty") or "",
        "authorization_start": candidate.get("authorization_start"),
        "authorization_end": candidate.get("authorization_end"),
        "share_rate": candidate.get("share_rate"),
        "channel_fee_rate": candidate.get("channel_fee_rate"),
        "invoice_tax_rate": candidate.get("invoice_tax_rate"),
        "testing_fee": candidate.get("testing_fee"),
        "settlement_mode": candidate.get("settlement_mode"),
        "settlement_basis": candidate.get("settlement_basis"),
        "payment_terms": candidate.get("payment_terms"),
        "score": float(scored.get("score") or 0),
        "confidence": scored.get("confidence") or "low",
        "authorization_status": scored.get("authorization_status") or "unknown",
        "reasons": scored.get("reasons") or [],
    }


def _recommended(candidate: dict, raw: dict) -> dict:
    basis_mode = _basis_mode(candidate)
    product_discount = _safe_number(raw.get("discount_rate"), 1.0)
    if basis_mode == "actual_paid":
        settlement_discount = 1.0
        discount_policy = "reference_only"
    elif basis_mode == "discounted_flow":
        settlement_discount = product_discount
        discount_policy = "participates"
    else:
        settlement_discount = product_discount
        discount_policy = "manual"

    warnings: list[str] = []
    share = _number(candidate.get("share_rate"))
    fee = _number(candidate.get("channel_fee_rate"))
    tax = _number(candidate.get("invoice_tax_rate"))
    testing = _number(candidate.get("testing_fee"))
    if share is None:
        warnings.append("合同未维护分成比例")
    if fee is None:
        warnings.append("合同未结构化通道费率，保留当前账单值")
    if tax is None:
        warnings.append("合同未结构化税率，保留当前账单值")
    if testing is None:
        warnings.append("合同未结构化测试费，保留当前账单值")
    if basis_mode == "ambiguous" and abs(product_discount - 1.0) > EPS:
        warnings.append("合同未明确按实付还是折后流水，折扣不自动改写")

    return {
        "basis_mode": basis_mode,
        "settlement_mode": _text(candidate.get("settlement_mode")),
        "settlement_basis": _text(candidate.get("settlement_basis")),
        "product_discount_reference": product_discount,
        "settlement_discount_rate": settlement_discount,
        "discount_policy": discount_policy,
        "share_ratio": share,
        "channel_fee_rate": None if fee is None else round(fee, 4),
        "tax_rate": None if tax is None else round(tax, 4),
        "test_fee": None if testing is None else round(testing, 2),
        "warnings": warnings,
    }


def recommend_rd_rules(
    partner_name: str,
    lines: list[dict],
    candidates: list[dict],
) -> dict:
    results: list[dict] = []
    for index, raw in enumerate(lines or []):
        source_index = raw.get("line_index", index)
        try:
            source_index = int(source_index)
        except (TypeError, ValueError):
            source_index = index
        game_name = _text(raw.get("game_name") or raw.get("gameName"))
        cycle = _text(raw.get("settlement_cycle") or raw.get("settlementCycle"))
        if not game_name:
            continue

        bill = {
            "partner_name": partner_name,
            "channel_name": "",
            "settlement_month": cycle,
        }
        line = {
            "line_id": str(raw.get("line_id") or raw.get("id") or f"draft-{source_index}"),
            "game_name": game_name,
            "settlement_cycle": cycle,
        }
        ranked: list[tuple[dict, dict]] = []
        for candidate in candidates:
            scored = score_candidate(bill, line, candidate)
            if scored.get("eligible"):
                ranked.append((candidate, scored))
        ranked.sort(key=lambda item: float(item[1].get("score") or 0), reverse=True)

        if not ranked:
            results.append({
                "line_index": source_index,
                "game_name": game_name,
                "settlement_cycle": cycle,
                "auto_apply": False,
                "confidence": "none",
                "score": 0,
                "ambiguity_margin": 0,
                "message": "未找到匹配的合同合作清单",
                "match": None,
                "recommended": None,
                "contract_amount": None,
            })
            continue

        candidate, scored = ranked[0]
        top_score = float(scored.get("score") or 0)
        second_score = float(ranked[1][1].get("score") or 0) if len(ranked) > 1 else 0.0
        margin = round(top_score - second_score, 1)
        recommended = _recommended(candidate, raw)
        share_ready = recommended["share_ratio"] is not None
        auto_apply = (
            scored.get("confidence") == "high"
            and scored.get("authorization_status") == "covered"
            and top_score >= 82
            and margin >= 10
            and share_ready
        )

        raw_line = {
            "revenue": _safe_number(raw.get("revenue")),
            "discount_rate": _safe_number(raw.get("discount_rate"), 1.0),
            "coupon_amount": _safe_number(raw.get("coupon_amount")),
            "test_fee": _safe_number(raw.get("test_fee")),
            "extra_fee": _safe_number(raw.get("extra_fee")),
            "header_refund_amount": 0.0,
            "refund_amount": 0.0,
            "other_deductions": _safe_number(raw.get("coupon_amount")) + _safe_number(raw.get("extra_fee")),
            "share_rate": _safe_number(raw.get("share_ratio")),
            "tax_rate": _safe_number(raw.get("tax_rate")),
            "settlement_amount": _safe_number(raw.get("settlement_amount")),
        }
        contract_amount = calculate_contract_standard_amount_v4(
            "rd",
            {"channel_fee_rate": _safe_number(raw.get("channel_fee_rate")), "validation_tolerance": 0.05},
            raw_line,
            candidate,
            tolerance=0.05,
        )
        if not auto_apply and contract_amount.get("status") == "fail":
            contract_amount = dict(contract_amount)
            contract_amount["status"] = "manual"
            contract_amount["deterministic"] = False
            contract_amount["message"] = "已找到合同参考金额，但合同身份尚未达到自动带入阈值，需人工确认。"

        results.append({
            "line_index": source_index,
            "game_name": game_name,
            "settlement_cycle": cycle,
            "auto_apply": auto_apply,
            "confidence": scored.get("confidence") or "low",
            "score": top_score,
            "ambiguity_margin": margin,
            "message": "合同匹配明确，可自动带入研发结算规则" if auto_apply else "已找到合同，但匹配或条款仍需人工确认",
            "match": _candidate_snapshot(candidate, scored),
            "recommended": recommended,
            "contract_amount": contract_amount,
        })

    auto_lines = [item for item in results if item.get("auto_apply") and item.get("recommended")]
    header = None
    if auto_lines:
        fee_values = [item["recommended"].get("channel_fee_rate") for item in auto_lines]
        fees = {round(float(value), 4) for value in fee_values if value is not None}
        if len(fees) == 1 and all(value is not None for value in fee_values):
            header = {"channel_fee_rate": next(iter(fees)), "compatible": True}
        elif any(value is None for value in fee_values):
            header = {
                "channel_fee_rate": None,
                "compatible": True,
                "message": "部分合同未结构化通道费率，保留当前整单通道费并提示人工复核。",
            }
        else:
            header = {
                "channel_fee_rate": None,
                "compatible": False,
                "message": "同一研发账单内匹配到不同合同通道费率，请拆分账单后再保存。",
            }

    return {
        "version": "contract-rd-entry-v1",
        "auto_apply": bool(results) and len(auto_lines) == len(results),
        "matched_lines": len([item for item in results if item.get("match")]),
        "auto_apply_lines": len(auto_lines),
        "total_lines": len(results),
        "header_recommendation": header,
        "lines": results,
        "message": (
            "研发合同规则已明确，可自动带入"
            if results and len(auto_lines) == len(results) and (not header or header.get("compatible"))
            else "部分合同匹配或条款需要人工确认"
            if results
            else "请先填写游戏名称"
        ),
    }
