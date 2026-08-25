"""Production contract service V16: avoid false hard differences for specific Anjiu sub-variants.

The contract matcher intentionally removes parenthetical marketing/version suffixes
so a base contract can still match a bill product. For Guangdong Anjiu / 游戏fan,
that can over-collapse financially distinct child SKUs: e.g. a bill line named
``云上征途（0.1折齐天伏魔）`` can match a generic access item named
``云上征途（0.1折）`` even when their share/channel-fee fields differ.

V16 keeps the generic contract as audit evidence, but if the contract-standard
amount independently passes, those two rate differences are downgraded to manual
warnings instead of being called an explicit contract difference. A real amount
difference, authorization failure, exact-SKU rate difference, or non-Anjiu bill
still blocks exactly as before.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

try:
    from . import channel_line_verification as _line_verify
    from . import matcher as _matcher
    from . import v15_main as _v15
except ImportError:  # Vercel imports service modules from the service root.
    import channel_line_verification as _line_verify
    import matcher as _matcher
    import v15_main as _v15

app = _v15.app
_v14 = _v15._v14
_v13 = _v14._v13
_v12 = _v13._v12
_v11 = _v12._v11
_v8 = _v11._v8
_v3_module = _v8._v3_module

_ORIGINAL_APPLY_CHANNEL_LINE_AUTHORITY = _v8.apply_channel_line_fee_authority
_ORIGINAL_RECONCILE_DATA_V3 = _v3_module._reconcile_data_v3
_RATE_CHECK_KEYS = {"share_rate", "channel_fee_rate"}
_BRACKET_RE = re.compile(r"[（(]([^（）()]*)[）)]")
_DISCOUNT_RE = re.compile(r"(?<!\d)\d+(?:\.\d+)?\s*折", re.IGNORECASE)


def _compact(value: Any) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).strip().lower()


def _parenthetical_residual(value: Any) -> str:
    """Return marketing text inside brackets after removing the discount token."""
    text = _compact(value)
    chunks = _BRACKET_RE.findall(text)
    if not chunks:
        return ""
    residual = "".join(_DISCOUNT_RE.sub("", chunk) for chunk in chunks)
    # A lone generic word such as “版/版本” does not make an access item a
    # financially specific child SKU. Keep meaningful names such as “齐天伏魔”.
    residual = re.sub(r"[\s·,，.。\-_/\\:：]", "", residual)
    residual = re.sub(r"^(?:版本|版)$", "", residual)
    return residual


def _generic_discount_contract_for_specific_variant(
    bill_game_name: Any,
    contract_product_name: Any,
) -> bool:
    """Detect a generic same-discount contract matched to a more specific child SKU."""
    bill_raw = _compact(bill_game_name)
    contract_raw = _compact(contract_product_name)
    if not bill_raw or not contract_raw or bill_raw == contract_raw:
        return False
    if _matcher.normalize_game(bill_game_name) != _matcher.normalize_game(contract_product_name):
        return False
    bill_variant = _matcher.commercial_game_variant(bill_game_name)
    contract_variant = _matcher.commercial_game_variant(contract_product_name)
    if not bill_variant or bill_variant != contract_variant:
        return False
    return bool(_parenthetical_residual(bill_game_name)) and not _parenthetical_residual(
        contract_product_name
    )


def _is_anjiu_result(result: dict) -> bool:
    bill = result.get("bill") or {}
    return (
        str(bill.get("bill_type") or "") == "channel"
        and _v14._is_anjiu(
            str(bill.get("partner_name") or ""),
            str(bill.get("channel_name") or ""),
        )
    )


def _manual_rate_message(check: dict, line: dict) -> str:
    match = line.get("match") or {}
    bill_game = str(line.get("game_name") or "")
    contract_game = str(match.get("product_name") or "")
    label = str(check.get("label") or "合同费率")
    return (
        f"{label}存在差异，但当前合同清单仅匹配到基础版本“{contract_game}”，"
        f"账单为更具体子版本“{bill_game}”。该差异保留人工提示，不作为明确合同差异；"
        "合同标准结算金额仍独立核验，若金额不一致仍会阻断确认。"
    )


def _rebuild_summary(result: dict, lines: list[dict]) -> dict:
    summary = _matcher.summarize_results(lines)
    bill_checks = list(result.get("bill_checks") or [])
    if bill_checks:
        summary["warning_count"] += len(bill_checks)
        summary["issue_count"] += len(bill_checks)
        if summary["overall_status"] == "pass":
            summary["overall_status"] = "warning"
        summary["can_auto_confirm"] = False

    old_summary = result.get("summary") or {}
    for key in (
        "binding_count",
        "manual_binding_count",
        "auto_binding_count",
        "amount_status",
        "amount_comparable_lines",
        "amount_deterministic_lines",
        "amount_expected",
        "amount_actual",
        "amount_difference",
        "handled_difference_lines",
        "unresolved_difference_lines",
    ):
        if key in old_summary:
            summary[key] = old_summary.get(key)
    return summary


def normalize_anjiu_specific_variant_rate_checks(result: dict) -> dict:
    """Downgrade only generic-contract rate failures after amount verification passes."""
    if not _is_anjiu_result(result):
        return result

    changed = False
    next_lines: list[dict] = []
    for source in result.get("lines") or []:
        line = dict(source)
        match = line.get("match") or {}
        amount = line.get("contract_amount") or {}
        if (
            amount.get("status") == "pass"
            and _generic_discount_contract_for_specific_variant(
                line.get("game_name"),
                match.get("product_name"),
            )
        ):
            checks = [dict(check) for check in (line.get("checks") or [])]
            line_changed = False
            for check in checks:
                if check.get("key") in _RATE_CHECK_KEYS and check.get("status") == "fail":
                    check["status"] = "manual"
                    check["message"] = _manual_rate_message(check, line)
                    check["specific_variant_generic_contract"] = True
                    line_changed = True
            if line_changed:
                line["checks"] = checks
                line["specific_variant_contract_notice"] = {
                    "type": "generic_contract_for_specific_variant",
                    "contract_product_name": match.get("product_name"),
                    "bill_game_name": line.get("game_name"),
                    "amount_check_status": amount.get("status"),
                }
                _line_verify._recompute_line_status(line)
                line["message"] = (
                    "合同匹配到同折扣基础版本，具体子版本费率差异已保留为人工提示；"
                    "合同标准结算金额一致，不作为明确合同差异阻断确认。"
                )
                changed = True
        next_lines.append(line)

    if not changed:
        return result
    updated = dict(result)
    updated["lines"] = next_lines
    updated["summary"] = _rebuild_summary(updated, next_lines)
    updated["specific_variant_rate_warning_count"] = sum(
        1 for line in next_lines if line.get("specific_variant_contract_notice")
    )
    return updated


def _apply_channel_line_authority_v16(
    conn: Any,
    bill_type: str,
    bill_id: str,
    result: dict,
) -> dict:
    normalized = _ORIGINAL_APPLY_CHANNEL_LINE_AUTHORITY(conn, bill_type, bill_id, result)
    return normalize_anjiu_specific_variant_rate_checks(normalized)


def _reconcile_data_v3_v16(conn: Any, bill_type: str, bill_id: str) -> dict:
    """Keep immutable confirmation snapshots consistent with the live preflight."""
    result = _ORIGINAL_RECONCILE_DATA_V3(conn, bill_type, bill_id)
    return normalize_anjiu_specific_variant_rate_checks(result)


# The live V8 preflight calls this module global before its final confirmation
# policy. V3 snapshot creation resolves _reconcile_data_v3 at request time, so
# patch both paths to keep confirmation and historical evidence consistent.
_v8.apply_channel_line_fee_authority = _apply_channel_line_authority_v16
_v3_module._reconcile_data_v3 = _reconcile_data_v3_v16
