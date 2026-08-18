"""Production contract service entrypoint with DDL-free request handling.

All historical V2/V4/V9 helpers used to self-create their tables on demand. That is
unsafe in a serverless environment because concurrent cold starts and ordinary reads
can form PostgreSQL AccessExclusiveLock/AccessShareLock deadlocks. V10 keeps every
existing route but replaces those runtime schema builders with read-only schema guards.
Versioned SQL migrations are executed once by the production build.
"""

from __future__ import annotations

import logging
import re

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

try:
    from . import extended_main as _extended
    from . import rd_prepayment as _rd_prepayment
    from . import v2_main as _v2
    from . import v2_1_main as _v2_1
    from . import v3_main as _v3
    from . import v4_main as _v4
    from . import v8_main as _v8
    from . import v9_main as _v9
except ImportError:
    import extended_main as _extended
    import rd_prepayment as _rd_prepayment
    import v2_main as _v2
    import v2_1_main as _v2_1
    import v3_main as _v3
    import v4_main as _v4
    import v8_main as _v8
    import v9_main as _v9

logger = logging.getLogger("contract_terms")


def _require_relations(conn, names: tuple[str, ...], feature: str) -> None:
    missing: list[str] = []
    for name in names:
        row = conn.execute("SELECT to_regclass(%s) AS name", [f"public.{name}"]).fetchone()
        value = row.get("name") if hasattr(row, "get") else row[0] if row else None
        if not value:
            missing.append(name)
    if missing:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "contract_schema_not_ready",
                "feature": feature,
                "missing_tables": missing,
                "message": "合同服务数据库结构尚未完成部署迁移，请稍后重试。",
                "retryable": True,
            },
        )


def _require_v2_tables(conn) -> None:
    _require_relations(
        conn,
        ("cf_bill_contract_links", "cf_contract_reconciliation_snapshots"),
        "contract_binding",
    )


def _require_difference_tables(conn) -> None:
    _require_relations(
        conn,
        (
            "cf_contract_difference_cases",
            "cf_contract_difference_events",
            "cf_contract_adjustments",
            "cf_contract_carry_forwards",
        ),
        "contract_difference_workflow",
    )


def _require_rd_entry_tables(conn) -> None:
    _require_relations(
        conn,
        ("cf_rd_contract_entry_pending", "cf_rd_contract_entry_snapshots"),
        "rd_contract_entry",
    )


def _require_rd_prepayment_table(conn) -> None:
    _require_relations(conn, ("cf_rd_prepayment_deductions",), "rd_prepayment")


_VARIANT_BRACKET_RE = re.compile(
    r"[（(【\[]\s*(?:\d+(?:[.]\d+)?\s*折|折扣版|折版|折服)[^）)】\]]*[）)】\]]",
    re.IGNORECASE,
)
_VARIANT_SUFFIX_RE = re.compile(
    r"(?:[-_/\s]+)(?:\d+(?:[.]\d+)?\s*折(?:版|服)?|折扣版|折版|折服)\s*$",
    re.IGNORECASE,
)


def _canonical_variant(value) -> str:
    raw = str(value or "").strip().lower().replace(" ", "")
    raw = raw.replace("．", ".").replace("％", "%")
    match = re.search(r"\d+(?:[.]\d+)?折", raw)
    if match:
        number = match.group(0)[:-1]
        try:
            normalized = f"{float(number):g}"
        except ValueError:
            normalized = number
        return f"{normalized}折"
    if "折扣版" in raw:
        return "折扣版"
    if "折服" in raw:
        return "折服"
    if "折版" in raw:
        return "折版"
    return raw[:80]


def _project_variant_into_name(candidate: dict) -> dict:
    """Make the structured settlement variant authoritative for legacy matchers."""
    variant = _canonical_variant(candidate.get("commercial_variant"))
    if not variant:
        return candidate
    original = str(candidate.get("product_name") or "").strip()
    base = _VARIANT_BRACKET_RE.sub("", original)
    base = _VARIANT_SUFFIX_RE.sub("", base).strip(" -_/（）()【】[]") or original
    projected = dict(candidate)
    projected["commercial_variant"] = variant
    projected["product_name"] = f"{base}（{variant}）" if base else variant
    return projected


_original_candidate_rows = _extended._candidate_rows


def _candidate_rows_with_structured_variant(conn):
    return [_project_variant_into_name(row) for row in _original_candidate_rows(conn)]


# Patch every imported alias used by the historical route functions. Python resolves
# these module globals at request time, so existing routes keep their behavior while
# schema initialization is moved completely out of the request lifecycle.
_v2._ensure_v2_tables = _require_v2_tables
_v2_1._ensure_v2_tables = _require_v2_tables
_v3._ensure_v2_tables = _require_v2_tables
_v9._ensure_v2_tables = _require_v2_tables

_v4._ensure_difference_tables = _require_difference_tables
_v8._ensure_difference_tables = _require_difference_tables

_v9._ensure_rd_entry_tables = _require_rd_entry_tables
_rd_prepayment.ensure_rd_prepayment_table = _require_rd_prepayment_table

# V1 defines the live recommendation route; V2+ imported `_candidate_rows` by value.
# Patch all aliases so structured commercial variants are honored everywhere.
_extended._candidate_rows = _candidate_rows_with_structured_variant
for _module in (_v2, _v2_1, _v3, _v4, _v8, _v9):
    if hasattr(_module, "_candidate_rows"):
        _module._candidate_rows = _candidate_rows_with_structured_variant


app = FastAPI(
    title="contract-reconciliation-v3.2-stable",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.router.routes.extend(list(_v9.app.router.routes))


@app.exception_handler(Exception)
async def _unhandled_contract_service_error(request: Request, exc: Exception) -> JSONResponse:
    """Return a real HTTP 500 instead of leaking an unhandled ASGI exception.

    Vercel can otherwise record the wrapper request as HTTP 200 while the ASGI
    application crashes after dispatch, which makes monitoring misleading.  The
    stack trace is still logged server-side, while callers receive a stable,
    explicit technical error that the UI can distinguish from a business-level
    "contract not matched" result.
    """
    logger.error(
        "Unhandled contract service error path=%s method=%s",
        request.url.path,
        request.method,
        exc_info=(type(exc), exc, exc.__traceback__),
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": {
                "error": "contract_service_internal_error",
                "message": "合同服务发生内部错误，请稍后重试；本次账单可保留为待核对状态。",
                "retryable": True,
            }
        },
    )
