"""Production contract service entrypoint with DDL-free request handling.

All historical V2/V4/V9 helpers used to self-create their tables on demand.  That is
unsafe in a serverless environment because concurrent cold starts and ordinary reads
can form PostgreSQL AccessExclusiveLock/AccessShareLock deadlocks.  V10 keeps every
existing route but replaces those runtime schema builders with read-only schema guards.
Versioned SQL migrations are executed once by the production deployment workflow.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

try:
    from . import rd_prepayment as _rd_prepayment
    from . import v2_main as _v2
    from . import v2_1_main as _v2_1
    from . import v3_main as _v3
    from . import v4_main as _v4
    from . import v8_main as _v8
    from . import v9_main as _v9
except ImportError:
    import rd_prepayment as _rd_prepayment
    import v2_main as _v2
    import v2_1_main as _v2_1
    import v3_main as _v3
    import v4_main as _v4
    import v8_main as _v8
    import v9_main as _v9


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


# Patch every imported alias used by the historical route functions.  Python resolves
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


app = FastAPI(
    title="contract-reconciliation-v3.2-stable",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.router.routes.extend(list(_v9.app.router.routes))
