"""V2.1 service hardening for contract reconciliation closure.

Keeps all V2 routes, but replaces two write endpoints with safer variants:
- high-confidence auto-lock now refuses ambiguous top candidates;
- reconciliation snapshots are JSON-encoded before writing JSONB so Decimal and
  datetime values from PostgreSQL cannot break confirmation-time audit capture.
"""

from __future__ import annotations

from uuid import uuid4

import psycopg
from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

try:
    from .v2_main import (
        app as _v2_app,
        _candidate_rows,
        _database_url,
        _ensure_v2_tables,
        _evaluate_line_v2,
        _links_for_bill,
        _load_bill,
        _reconcile_data,
        _require_permission,
        _snapshot_meta,
        _text,
    )
except ImportError:
    from v2_main import (
        app as _v2_app,
        _candidate_rows,
        _database_url,
        _ensure_v2_tables,
        _evaluate_line_v2,
        _links_for_bill,
        _load_bill,
        _reconcile_data,
        _require_permission,
        _snapshot_meta,
        _text,
    )


app = FastAPI(
    title="contract-reconciliation-v2.1",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

_REPLACED_ROUTES = {
    ("/api/contract-terms/bill-links/auto-lock", "POST"),
    ("/api/contract-terms/reconcile-snapshots", "POST"),
}
for route in list(_v2_app.router.routes):
    methods = getattr(route, "methods", set()) or set()
    if any((getattr(route, "path", ""), method) in _REPLACED_ROUTES for method in methods):
        continue
    app.router.routes.append(route)


def _top_candidate_is_unambiguous(result: dict) -> bool:
    match = result.get("match") or {}
    access_item_id = str(match.get("access_item_id") or "")
    if not access_item_id or match.get("confidence") != "high":
        return False
    score = float(match.get("score") or 0)
    if score < 82:
        return False

    eligible = [
        item for item in (result.get("candidates") or [])
        if item.get("eligible") and str(item.get("access_item_id") or "") != access_item_id
    ]
    if not eligible:
        return True
    second_score = float(eligible[0].get("score") or 0)
    return score - second_score >= 8


@app.post("/api/contract-terms/bill-links/auto-lock")
def auto_lock_bill_contract_links_safe(request: Request, payload: dict) -> dict:
    actor = _require_permission(request, "contracts.manage")
    bill_type = _text(payload.get("bill_type"), 20)
    bill_id = _text(payload.get("bill_id"), 128)
    if bill_type not in {"rd", "channel"} or not bill_id:
        raise HTTPException(status_code=422, detail="账单类型或账单 ID 无效")

    locked = 0
    skipped_ambiguous = 0
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_v2_tables(conn)
        bill, lines = _load_bill(conn, bill_type, bill_id)
        candidates = _candidate_rows(conn)
        existing = _links_for_bill(conn, bill_type, bill_id)
        for line in lines:
            line_id = _text(line.get("line_id"), 200) or "legacy"
            if line_id in existing:
                continue
            result = _evaluate_line_v2(bill, line, candidates, None)
            match = result.get("match") or {}
            if not _top_candidate_is_unambiguous(result):
                if match.get("confidence") == "high":
                    skipped_ambiguous += 1
                continue
            conn.execute(
                """
                INSERT INTO cf_bill_contract_links (
                  bill_type, bill_id, line_id, access_item_id, match_method,
                  note, confirmed_by, confirmed_at
                )
                VALUES (%s, %s, %s, %s, 'auto_locked', %s, %s, NOW())
                ON CONFLICT (bill_type, bill_id, line_id) DO NOTHING
                """,
                [
                    bill_type,
                    bill_id,
                    line_id,
                    match["access_item_id"],
                    f"高置信自动锁定，匹配分 {match.get('score')}，候选差值满足安全阈值",
                    actor,
                ],
            )
            locked += 1
        result = _reconcile_data(conn, bill_type, bill_id)
        conn.commit()
    return {
        "locked_count": locked,
        "skipped_ambiguous": skipped_ambiguous,
        "reconciliation": result,
    }


@app.post("/api/contract-terms/reconcile-snapshots")
def create_reconciliation_snapshot_safe(request: Request, payload: dict) -> dict:
    actor = _require_permission(request, "contracts.view")
    bill_type = _text(payload.get("bill_type"), 20)
    bill_id = _text(payload.get("bill_id"), 128)
    event_type = _text(payload.get("event_type"), 80) or "confirmed"
    if bill_type not in {"rd", "channel"} or not bill_id:
        raise HTTPException(status_code=422, detail="账单类型或账单 ID 无效")

    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_v2_tables(conn)
        result = _reconcile_data(conn, bill_type, bill_id)
        safe_result = jsonable_encoder(result)
        safe_summary = jsonable_encoder(result.get("summary") or {})
        snapshot_id = uuid4().hex
        row = conn.execute(
            """
            INSERT INTO cf_contract_reconciliation_snapshots (
              id, bill_type, bill_id, event_type, overall_status,
              summary_json, result_json, created_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, bill_type, bill_id, event_type, overall_status,
                      summary_json, created_by, created_at
            """,
            [
                snapshot_id,
                bill_type,
                bill_id,
                event_type,
                str(safe_summary.get("overall_status") or ""),
                Jsonb(safe_summary),
                Jsonb(safe_result),
                actor,
            ],
        ).fetchone()
        conn.commit()
    return _snapshot_meta(dict(row)) or {}
