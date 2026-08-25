"""Production contract service V15: refresh stale automatic Anjiu bindings.

V14 aligned Guangdong Anjiu / 游戏fan settlement formulas and unbound contract
selection. Historical bills can still carry an old ``auto_locked`` contract
binding created before those matching fixes. A stale automatic binding must not
outrank the current contract-first recommendation when it is the only reason a
line fails confirmation.

Manual bindings remain authoritative. Real differences against the current
recommended contract remain blocking. No non-Anjiu bill is changed.
"""

from __future__ import annotations

from typing import Any

try:
    from . import v14_main as _v14
except ImportError:  # Vercel imports service modules from the service root.
    import v14_main as _v14

app = _v14.app
_v2 = _v14._v2
_V14_EVALUATE_LINE = _v14._evaluate_channel_line_with_contract_rule_authority


def _binding_method(binding: dict | None) -> str:
    return str((binding or {}).get("match_method") or "").strip().lower()


def _evaluate_channel_line_with_auto_binding_refresh(
    bill: dict,
    line: dict,
    candidates: list[dict],
    binding: dict | None,
) -> dict:
    """Refresh only failed historical ``auto_locked`` Anjiu bindings.

    The persisted auto binding is kept when it still passes. If it fails, the
    line is re-evaluated without that machine-created lock so V14 can use the same
    current contract-first recommendation as the edit form. The replacement is
    accepted only when the refreshed result has no explicit failure.
    """
    base = _V14_EVALUATE_LINE(bill, line, candidates, binding)
    if bill.get("bill_type") != "channel":
        return base
    if not _v14._is_anjiu(
        str(bill.get("partner_name") or ""),
        str(bill.get("channel_name") or ""),
    ):
        return base
    if not binding:
        return base

    method = _binding_method(binding)
    if method != "auto_locked":
        # Human-selected/manual bindings are accounting evidence and remain
        # authoritative even if the automatic matcher would choose differently.
        return base
    if str(base.get("status") or "").lower() != "fail":
        return base

    refreshed = _V14_EVALUATE_LINE(bill, line, candidates, None)
    if str(refreshed.get("status") or "").lower() == "fail":
        # The current contract also disagrees: this is a real difference.
        return base

    old_access_item_id = str(binding.get("access_item_id") or "")
    new_access_item_id = str((refreshed.get("match") or {}).get("access_item_id") or "")
    if not new_access_item_id or new_access_item_id == old_access_item_id:
        return base

    updated = dict(refreshed)
    # Do not pretend the stale DB binding points at the refreshed candidate.
    # Treat this preflight as current automatic evidence; manual confirmation can
    # still lock a specific contract later if needed.
    updated["binding"] = None
    match = dict(updated.get("match") or {})
    match["match_method"] = "auto_refreshed"
    match["locked"] = False
    reasons = [
        reason
        for reason in (match.get("reasons") or [])
        if str(reason or "").strip() != "已锁定合同依据"
    ]
    reasons.insert(0, "历史自动锁定已失效，已按当前有效合同重新匹配")
    match["reasons"] = reasons
    updated["match"] = match

    authority: dict[str, Any] = dict(updated.get("contract_rule_authority") or {})
    authority.update(
        {
            "source": "channel_rule_recommendation_auto_binding_refresh",
            "stale_auto_binding_access_item_id": old_access_item_id or None,
            "access_item_id": new_access_item_id,
        }
    )
    updated["contract_rule_authority"] = authority
    updated["message"] = (
        "历史自动合同绑定已按当前有效合同重新匹配；关键字段与账单一致。"
        if updated.get("status") == "pass"
        else "历史自动合同绑定已按当前有效合同重新匹配；仍有非阻断项需要复核。"
    )
    return updated


# V2 reconciliation reads this module-level function at request time. Replace
# only the evaluator; every V14 formula, fee, snapshot and special-settlement
# rule remains in place.
_v2._evaluate_line_v2 = _evaluate_channel_line_with_auto_binding_refresh
