"""FastAPI entrypoint."""

from __future__ import annotations

import logging
import os
import re

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError

from app.api.anomaly import router as anomaly_router
from app.api.bill_lifecycle import router as bill_lifecycle_router
from app.api.business_dashboard import router as business_dashboard_router
from app.api.channel import router as channel_router
from app.api.bill_attachment import router as bill_attachment_router
from app.api.bill_invoice_allocation import router as bill_invoice_allocation_router
from app.api.health import router as health_router
from app.api.auth import router as auth_router
from app.api.invoice import router as invoice_router
from app.api.exception_status import router as exception_status_router
from app.api.invoice_payment_link import router as invoice_payment_link_router
from app.api.operation_log import router as operation_log_router
from app.api.operating_expense import router as operating_expense_router
from app.api.profit_analysis import router as profit_analysis_router
from app.api.payment import router as payment_router
from app.api.bank_transaction import router as bank_transaction_router
from app.api.bank_auto_reconciliation import router as bank_auto_reconciliation_router
from app.api.reconciliation import router as reconciliation_router
from app.api.reconciliation_period import router as reconciliation_period_router
from app.api.contract import router as contract_router
from app.api.quicksdk import router as quicksdk_router
from app.api.product_source import router as product_source_router
from app.api.workbench import router as workbench_router
from app.core.migrations import run_schema_migrations
from app.core.runtime_paths import ensure_upload_root
from app.services.permissions import require_module_access

logger = logging.getLogger(__name__)

PRODUCTION_CORS_ORIGINS = [
    "https://cf.hnchpower.cn",
    "https://caiwu2026.hnchpower.cn",
    "https://duizhang2025.vercel.app",
    "https://www.duizhang2025.vercel.app",
    "https://cf-hnchpower-cn.vercel.app",
]

DEVELOPMENT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]

UNSAFE_HTTP_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
}
_RECONCILIATION_RECORD_PATH_RE = re.compile(r"^/api/reconciliation/[^/]+$")


def _is_production_env() -> bool:
    value = (
        os.environ.get("APP_ENV")
        or os.environ.get("ENV")
        or os.environ.get("ENVIRONMENT")
        or ""
    ).strip().lower()
    return value in {"prod", "production"}


def _append_origin(out: list[str], raw: str | None) -> None:
    value = (raw or "").strip().rstrip("/")
    if not value:
        return
    if not value.startswith(("https://", "http://")):
        value = f"https://{value}"
    if value not in out:
        out.append(value)


def get_cors_origins() -> list[str]:
    """Return exact trusted Origins; localhost is never enabled by default in production."""
    out = list(PRODUCTION_CORS_ORIGINS)
    if not _is_production_env():
        out.extend(origin for origin in DEVELOPMENT_CORS_ORIGINS if origin not in out)

    for env_name in ("VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"):
        _append_origin(out, os.environ.get(env_name))

    _append_origin(out, os.environ.get("CORS_ORIGIN"))
    extra = os.environ.get("CORS_EXTRA_ORIGINS", "").strip()
    if extra:
        for origin in extra.split(","):
            _append_origin(out, origin)
    return out


def _cors_headers_for_request(request: Request, allowed: list[str]) -> dict[str, str]:
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") in allowed:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        }
    return {}


def _apply_common_response_headers(response, path: str) -> None:
    for key, value in SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    if path.startswith("/api/") or path == "/health/db":
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"


def _is_idempotent_reconciliation_delete_miss(
    method: str,
    path: str,
    status_code: int,
) -> bool:
    return (
        method.upper() == "DELETE"
        and status_code == 404
        and bool(_RECONCILIATION_RECORD_PATH_RE.fullmatch(path))
    )


_cors_allowed = get_cors_origins()

app = FastAPI(title="caiwuapi", version="0.1.0")


@app.on_event("startup")
def migrate_database_schema() -> None:
    run_schema_migrations()


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allowed,
    allow_credentials=True,
    allow_methods=["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Accept", "Content-Type", "Origin", "X-Requested-With"],
)


@app.middleware("http")
async def enforce_origin_and_response_policy(request: Request, call_next):
    path = request.url.path
    origin = (request.headers.get("origin") or "").rstrip("/")
    if (
        path.startswith("/api/")
        and request.method.upper() in UNSAFE_HTTP_METHODS
        and origin
        and origin not in _cors_allowed
    ):
        response = JSONResponse(status_code=403, content={"detail": "请求来源不受信任"})
        _apply_common_response_headers(response, path)
        return response

    response = await call_next(request)
    if _is_idempotent_reconciliation_delete_miss(request.method, path, response.status_code):
        response = Response(status_code=204, headers=_cors_headers_for_request(request, _cors_allowed))
    _apply_common_response_headers(response, path)
    return response


reconciliation_access = Depends(require_module_access("reconciliation.view", "reconciliation.manage"))
analytics_access = Depends(require_module_access("analytics.view", "analytics.manage"))
anomaly_access = Depends(require_module_access("anomalies.view", "anomalies.manage"))
funds_access = Depends(require_module_access("funds.view", "funds.manage"))
invoice_access = Depends(require_module_access("invoices.view", "invoices.manage"))
contract_access = Depends(
    require_module_access(
        "contracts.view",
        "contracts.manage",
        path_overrides={"/api/contracts/partners": ("partners.view", "partners.manage")},
    )
)
data_access = Depends(require_module_access("data.view", "data.manage"))
audit_access = Depends(require_module_access("audit.view"))

app.include_router(health_router)
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(workbench_router, prefix="/api/workbench", tags=["workbench"])
app.include_router(reconciliation_router, prefix="/api/reconciliation", tags=["reconciliation"], dependencies=[reconciliation_access])
app.include_router(reconciliation_period_router, prefix="/api/reconciliation-periods", tags=["reconciliation-periods"], dependencies=[reconciliation_access])
app.include_router(channel_router, prefix="/api/channel-records", tags=["channel-records"], dependencies=[reconciliation_access])
app.include_router(bill_lifecycle_router, prefix="/api/bill-lifecycle", tags=["bill-lifecycle"], dependencies=[reconciliation_access])
app.include_router(business_dashboard_router, prefix="/api/business-dashboard", tags=["business-dashboard"], dependencies=[analytics_access])
app.include_router(profit_analysis_router, prefix="/api/profit-analysis", tags=["profit-analysis"], dependencies=[analytics_access])
app.include_router(operating_expense_router, prefix="/api/operating-expenses", tags=["operating-expenses"], dependencies=[analytics_access])
app.include_router(invoice_router, prefix="/api/invoices", tags=["invoices"], dependencies=[invoice_access])
app.include_router(payment_router, prefix="/api/payments", tags=["payments"], dependencies=[funds_access])
app.include_router(invoice_payment_link_router, prefix="/api/invoice-payment-links", tags=["invoice-payment-links"], dependencies=[invoice_access])
app.include_router(exception_status_router, prefix="/api/exception-statuses", tags=["exception-statuses"], dependencies=[anomaly_access])
app.include_router(anomaly_router, prefix="/api/anomaly-data", tags=["anomaly-data"], dependencies=[anomaly_access])
app.include_router(operation_log_router, prefix="/api/operation-logs", tags=["operation-logs"], dependencies=[audit_access])
app.include_router(bank_transaction_router, prefix="/api/bank-transactions", tags=["bank-transactions"], dependencies=[funds_access])
app.include_router(bank_auto_reconciliation_router, prefix="/api/bank-auto-reconciliation", tags=["bank-auto-reconciliation"], dependencies=[funds_access])
app.include_router(contract_router, prefix="/api/contracts", tags=["contracts"], dependencies=[contract_access])
app.include_router(quicksdk_router, prefix="/api/quicksdk", tags=["quicksdk"], dependencies=[data_access])
app.include_router(bill_attachment_router, prefix="/api/bill-attachments", tags=["bill-attachments"], dependencies=[reconciliation_access])
app.include_router(bill_invoice_allocation_router, prefix="/api/bill-invoice-allocations", tags=["bill-invoice-allocations"], dependencies=[invoice_access])
app.include_router(product_source_router, prefix="/api/product-sources", tags=["product-sources"], dependencies=[data_access])

_upload_root = ensure_upload_root()
app.mount("/uploads", StaticFiles(directory=str(_upload_root)), name="uploads")


@app.exception_handler(SQLAlchemyError)
async def handle_sqlalchemy_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
    logger.exception("SQLAlchemy error: %s", request.url.path)
    response = JSONResponse(
        status_code=500,
        content={"error": "database_error", "message": "数据库查询失败，请联系系统管理员检查服务状态。"},
        headers=_cors_headers_for_request(request, _cors_allowed),
    )
    _apply_common_response_headers(response, request.url.path)
    return response


@app.get("/")
def root() -> dict:
    return {"ok": True, "service": "caiwuapi"}
