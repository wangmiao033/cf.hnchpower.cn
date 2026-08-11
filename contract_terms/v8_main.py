"""V3.0 final service entrypoint with safe write permissions."""

import psycopg
from fastapi import FastAPI, Query, Request
from psycopg.rows import dict_row

try:
    from . import v3_main as _v3_module
    from .v4_main import (
        app as _v4_app,
        _database_url,
        _ensure_difference_tables,
        _reconcile_data_v4,
        _require_permission,
        handle_difference_case as _handle_difference_case,
        complete_adjustment as _complete_adjustment,
        apply_carry_forward as _apply_carry_forward,
    )
    from .matcher import summarize_results
    from .settlement_recalculator_v4 import calculate_contract_standard_amount_v4
except ImportError:
    import v3_main as _v3_module
    from v4_main import (
        app as _v4_app,
        _database_url,
        _ensure_difference_tables,
        _reconcile_data_v4,
        _require_permission,
        handle_difference_case as _handle_difference_case,
        complete_adjustment as _complete_adjustment,
        apply_carry_forward as _apply_carry_forward,
    )
    from matcher import summarize_results
    from settlement_recalculator_v4 import calculate_contract_standard_amount_v4

_v3_module.calculate_contract_standard_amount = calculate_contract_standard_amount_v4

app = FastAPI(
    title="contract-reconciliation-v3.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

_REPLACED_ROUTES = {
    ("/api/contract-terms/reconcile-v3", "GET"),
    ("/api/contract-terms/difference-cases/{case_id}/actions", "POST"),
    ("/api/contract-terms/adjustments/{adjustment_id}/complete", "POST"),
    ("/api/contract-terms/carry-forwards/{carry_id}/apply", "POST"),
}

for route in list(_v4_app.router.routes):
    path = getattr(route, "path", "")
    methods = getattr(route, "methods", set()) or set()
    if any((path, method) in _REPLACED_ROUTES for method in methods):
        continue
    app.router.routes.append(route)


def _apply_confirmation_policy(result: dict) -> dict:
    lines = []
    unresolved = 0
    handled = 0

    for source in result.get("lines") or []:
        line = dict(source)
        amount = line.get("contract_amount") or {}
        case = line.get("difference_case") or {}
        if amount.get("status") != "fail":
            lines.append(line)
            continue

        handling = case.get("handling_type")
        case_status = case.get("status")
        authorization_fail = any(
            check.get("key") == "authorization" and check.get("status") == "fail"
            for check in (line.get("checks") or [])
        )

        if handling == "edit_bill" and case_status == "processing":
            line["status"] = "fail"
            line["message"] = "已进入修改账单流程；修改并保存后需重新核验，差异消失前不能确认核对。"
            unresolved += 1
        elif handling in {"accept_difference", "adjustment", "carry_forward"} and case_status in {"processing", "resolved"}:
            if authorization_fail:
                line["status"] = "fail"
                line["message"] = "金额差异已有处理动作，但账期不在合同授权期内，仍需先确认合同身份/授权期。"
                unresolved += 1
            else:
                line["status"] = "warning" if case_status == "processing" else "pass"
                handled += 1
        else:
            line["status"] = "fail"
            unresolved += 1
        lines.append(line)

    summary = summarize_results(lines)
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
    ):
        if key in old_summary:
            summary[key] = old_summary.get(key)
    summary["handled_difference_lines"] = handled
    summary["unresolved_difference_lines"] = unresolved

    updated = dict(result)
    updated["version"] = "contract-match-v3.0"
    updated["lines"] = lines
    updated["summary"] = summary
    updated["difference_summary"] = {
        "handled_lines": handled,
        "unresolved_lines": unresolved,
    }
    return updated


@app.get("/api/contract-terms/reconcile-v3")
def reconcile_bill_contract_v3_compat(
    request: Request,
    bill_type: str = Query(..., pattern="^(rd|channel)$"),
    bill_id: str = Query(..., min_length=1, max_length=128),
) -> dict:
    actor = _require_permission(request, "contracts.view")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_difference_tables(conn)
        result = _reconcile_data_v4(conn, bill_type, bill_id, actor)
        result = _apply_confirmation_policy(result)
        conn.commit()
    return result


@app.post("/api/contract-terms/difference-cases/{case_id}/actions")
def handle_difference_case_secure(request: Request, case_id: str, payload: dict) -> dict:
    _require_permission(request, "contracts.manage")
    return _handle_difference_case(request, case_id, payload)


@app.post("/api/contract-terms/adjustments/{adjustment_id}/complete")
def complete_adjustment_secure(request: Request, adjustment_id: str, payload: dict) -> dict:
    _require_permission(request, "contracts.manage")
    return _complete_adjustment(request, adjustment_id, payload)


@app.post("/api/contract-terms/carry-forwards/{carry_id}/apply")
def apply_carry_forward_secure(request: Request, carry_id: str, payload: dict) -> dict:
    _require_permission(request, "contracts.manage")
    return _apply_carry_forward(request, carry_id, payload)
