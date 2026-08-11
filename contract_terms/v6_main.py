"""V3.0 compatibility entrypoint.

Existing frontend code calls /reconcile-v3. This entrypoint keeps that stable URL
but serves the V3.0 difference-workflow result, so accepted/processing variances
stop blocking confirmation without requiring a risky coordinated frontend cutover.
"""

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
    )
    from .settlement_recalculator_v4 import calculate_contract_standard_amount_v4
except ImportError:
    import v3_main as _v3_module
    from v4_main import (
        app as _v4_app,
        _database_url,
        _ensure_difference_tables,
        _reconcile_data_v4,
        _require_permission,
    )
    from settlement_recalculator_v4 import calculate_contract_standard_amount_v4

_v3_module.calculate_contract_standard_amount = calculate_contract_standard_amount_v4

app = FastAPI(
    title="contract-reconciliation-v6",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

# Replace only the old reconciliation GET route. Keep all V1/V2/V3 snapshot,
# binding, terms, V4 case/action, adjustment, and carry-forward endpoints.
for route in list(_v4_app.router.routes):
    path = getattr(route, "path", "")
    methods = getattr(route, "methods", set()) or set()
    if path == "/api/contract-terms/reconcile-v3" and "GET" in methods:
        continue
    app.router.routes.append(route)


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
        conn.commit()
    return result
