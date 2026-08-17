"""DDL-free wrapper around the legacy partner/contract data service.

The legacy proxy historically used `_ensure_*` helpers that executed CREATE/ALTER/INDEX
inside normal API requests. In Vercel serverless concurrency those AccessExclusiveLock
requests can deadlock against contract rule readers. Versioned migrations now own the
schema. Runtime requests only verify that required relations exist.
"""

from __future__ import annotations

from fastapi import HTTPException

import main as _legacy


def _relation_exists(conn, name: str) -> bool:
    row = conn.execute(
        "SELECT to_regclass(%s) AS name",
        [f"public.{name}"],
    ).fetchone()
    if row is None:
        return False
    if hasattr(row, "get"):
        return bool(row.get("name"))
    return bool(row[0])


def _require_relations(conn, names: tuple[str, ...], feature: str) -> None:
    missing = [name for name in names if not _relation_exists(conn, name)]
    if missing:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "master_data_schema_not_ready",
                "feature": feature,
                "missing_tables": missing,
                "message": "客户/合同数据库结构尚未完成部署迁移，请稍后重试。",
                "retryable": True,
            },
        )


def _require_partners_table(conn) -> None:
    _require_relations(conn, ("cf_partner_records",), "partners")


def _require_reconciliation_links_table(conn) -> None:
    _require_relations(conn, ("cf_reconciliation_partner_links",), "reconciliation_partner_links")


def _require_contracts_table(conn) -> None:
    _require_relations(
        conn,
        (
            "cf_partner_records",
            "cf_contract_records",
            "cf_contract_attachment_files",
            "cf_contract_access_items",
        ),
        "contracts",
    )


# Existing route handlers resolve these globals at request time, so patching here keeps
# all API contracts unchanged while removing every partner/contract schema mutation
# from the request path.
_legacy._ensure_partners_table = _require_partners_table
_legacy._ensure_reconciliation_links_table = _require_reconciliation_links_table
_legacy._ensure_contracts_table = _require_contracts_table

app = _legacy.app
