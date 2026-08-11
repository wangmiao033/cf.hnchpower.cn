"""V3.0 production entrypoint: contract difference closure + settlement-basis guard."""

from fastapi import FastAPI

try:
    from . import v3_main as _v3_module
    from .v4_main import app as _v4_app
    from .settlement_recalculator_v4 import calculate_contract_standard_amount_v4
except ImportError:  # Vercel service-root imports
    import v3_main as _v3_module
    from v4_main import app as _v4_app
    from settlement_recalculator_v4 import calculate_contract_standard_amount_v4

# _reconcile_data_v3 resolves this global at call time, so patching the module
# here upgrades both V3 reconciliation and every V4 difference-workflow call.
_v3_module.calculate_contract_standard_amount = calculate_contract_standard_amount_v4

app = FastAPI(
    title="contract-reconciliation-v5",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.router.routes.extend(list(_v4_app.router.routes))
