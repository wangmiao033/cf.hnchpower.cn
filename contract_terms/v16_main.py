"""Production contract service V16: diagnose remaining Anjiu confirmation blockers.

V15 refreshes stale automatic bindings. V16 keeps all V15 behavior and adds a
narrow server-side diagnostic for failed Guangdong Anjiu / 游戏fan reconciliation
results so production logs reveal the exact blocking line/check without exposing
new public debug endpoints.
"""

from __future__ import annotations

import json

try:
    from . import v15_main as _v15
except ImportError:  # Vercel imports service modules from the service root.
    import v15_main as _v15

app = _v15.app
_v14 = _v15._v14
_v13 = _v14._v13
_v12 = _v13._v12
_v11 = _v12._v11
_v8 = _v11._v8

_RECONCILE_PATH = "/api/contract-terms/reconcile-v3"
_ORIGINAL_RECONCILE_ENDPOINT = _v8.reconcile_bill_contract_v3_compat


def _diagnostic_payload(result: dict, *, bill_type: str, bill_id: str) -> dict:
    failed_lines = []
    for line in result.get("lines") or []:
        failed_checks = [
            {
                "key": check.get("key"),
                "label": check.get("label"),
                "bill_value": check.get("bill_value"),
                "contract_value": check.get("contract_value"),
                "difference": check.get("difference"),
                "message": check.get("message"),
            }
            for check in (line.get("checks") or [])
            if check.get("status") == "fail"
        ]
        amount = line.get("contract_amount") or {}
        if line.get("status") != "fail" and amount.get("status") != "fail" and not failed_checks:
            continue
        match = line.get("match") or {}
        binding = line.get("binding") or {}
        failed_lines.append(
            {
                "line_id": line.get("line_id"),
                "game_name": line.get("game_name"),
                "settlement_cycle": line.get("settlement_cycle"),
                "line_status": line.get("status"),
                "binding_method": binding.get("match_method"),
                "binding_access_item_id": binding.get("access_item_id"),
                "match_access_item_id": match.get("access_item_id"),
                "match_contract_name": match.get("contract_name"),
                "match_product_name": match.get("product_name"),
                "match_confidence": match.get("confidence"),
                "match_score": match.get("score"),
                "failed_checks": failed_checks,
                "contract_amount": {
                    "status": amount.get("status"),
                    "expected_amount": amount.get("expected_amount"),
                    "actual_amount": amount.get("actual_amount"),
                    "difference_amount": amount.get("difference_amount"),
                    "formula_code": amount.get("formula_code"),
                    "message": amount.get("message"),
                },
                "difference_case": {
                    "status": (line.get("difference_case") or {}).get("status"),
                    "handling_type": (line.get("difference_case") or {}).get("handling_type"),
                },
                "authority": line.get("contract_rule_authority"),
            }
        )
    return {
        "bill_type": bill_type,
        "bill_id": bill_id,
        "summary": result.get("summary") or {},
        "failed_lines": failed_lines,
    }


# Replace only the public GET route object. Calling the V8 endpoint directly keeps
# its permission checks, database transaction, line-rule normalization, difference
# workflow and confirmation policy unchanged.
app.router.routes[:] = [
    route
    for route in app.router.routes
    if not (
        getattr(route, "path", None) == _RECONCILE_PATH
        and "GET" in (getattr(route, "methods", None) or set())
    )
]


from fastapi import Query, Request  # imported late to keep entrypoint compact


@app.get(_RECONCILE_PATH)
def reconcile_bill_contract_v16(
    request: Request,
    bill_type: str = Query(..., pattern="^(rd|channel)$"),
    bill_id: str = Query(..., min_length=1, max_length=128),
) -> dict:
    result = _ORIGINAL_RECONCILE_ENDPOINT(request, bill_type, bill_id)
    partner_name = str((result.get("bill") or {}).get("partner_name") or "")
    channel_name = str((result.get("bill") or {}).get("channel_name") or "")
    if bill_type == "channel" and _v14._is_anjiu(partner_name, channel_name):
        diagnostic = _diagnostic_payload(result, bill_type=bill_type, bill_id=bill_id)
        if diagnostic["failed_lines"]:
            print(
                "ANJIU_RECONCILE_BLOCKER "
                + json.dumps(diagnostic, ensure_ascii=False, default=str, separators=(",", ":")),
                flush=True,
            )
    return result
