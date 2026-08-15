"""V3.1 contract-driven R&D bill entry service."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

try:
    from .v8_main import app as _v8_app, reconcile_bill_contract_v3_compat as _v8_reconcile
    from .v4_main import _database_url, _require_permission
    from .extended_main import _candidate_rows
    from .v2_main import _ensure_v2_tables
    from .matcher import score_candidate
    from .rd_rule_recommender import recommend_rd_rules
    from .rd_prepayment import enrich_prepayment_candidates, replace_bill_prepayment_deductions
except ImportError:
    from v8_main import app as _v8_app, reconcile_bill_contract_v3_compat as _v8_reconcile
    from v4_main import _database_url, _require_permission
    from extended_main import _candidate_rows
    from v2_main import _ensure_v2_tables
    from matcher import score_candidate
    from rd_rule_recommender import recommend_rd_rules
    from rd_prepayment import enrich_prepayment_candidates, replace_bill_prepayment_deductions


app = FastAPI(
    title="contract-reconciliation-v3.1-rd-entry",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

for route in list(_v8_app.router.routes):
    path = getattr(route, "path", "")
    methods = getattr(route, "methods", set()) or set()
    if path == "/api/contract-terms/reconcile-v3" and "GET" in methods:
        continue
    app.router.routes.append(route)


def _text(value: object, limit: int = 500) -> str:
    return str(value or "").strip()[:limit]


def _ensure_rd_entry_tables(conn: psycopg.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_rd_contract_entry_pending (
          statement_no TEXT PRIMARY KEY,
          metadata_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          prepared_by TEXT NOT NULL DEFAULT '',
          prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_rd_contract_entry_snapshots (
          id TEXT PRIMARY KEY,
          bill_id TEXT NOT NULL,
          statement_no TEXT NOT NULL,
          metadata_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_rd_contract_entry_snapshots_bill
        ON cf_rd_contract_entry_snapshots (bill_id, created_at DESC)
        """
    )


def _metadata_payload(value: object) -> list[dict]:
    if not isinstance(value, list):
        raise HTTPException(status_code=422, detail="合同录入快照必须是数组")
    if len(value) > 200:
        raise HTTPException(status_code=422, detail="合同录入快照明细过多")
    safe = jsonable_encoder(value)
    out: list[dict] = []
    for raw in safe:
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        try:
            item["line_index"] = int(item.get("line_index") or 0)
        except (TypeError, ValueError):
            item["line_index"] = 0
        if "override_reason" in item:
            item["override_reason"] = _text(item.get("override_reason"), 1000)
        out.append(item)
    return out


def _latest_snapshot(conn: psycopg.Connection, bill_id: str) -> dict | None:
    row = conn.execute(
        """
        SELECT id, bill_id, statement_no, metadata_json, created_by, created_at
        FROM cf_rd_contract_entry_snapshots
        WHERE bill_id = %s
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        [bill_id],
    ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "bill_id": row["bill_id"],
        "statement_no": row["statement_no"],
        "metadata": row.get("metadata_json") or [],
        "created_by": row.get("created_by") or "",
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
    }


def _finalize_pending_entry(
    conn: psycopg.Connection,
    statement_no: str,
    actor: str,
) -> dict | None:
    _ensure_rd_entry_tables(conn)
    pending = conn.execute(
        """
        SELECT statement_no, metadata_json, prepared_by
        FROM cf_rd_contract_entry_pending
        WHERE statement_no = %s
        """,
        [statement_no],
    ).fetchone()
    if pending is None:
        return None

    bill = conn.execute(
        """
        SELECT id, statement_no, settlement_month, partner_name
        FROM reconciliation_records
        WHERE statement_no = %s
        """,
        [statement_no],
    ).fetchone()
    if bill is None:
        return None

    line_rows = conn.execute(
        """
        SELECT id, sort_order, game_name, settlement_cycle
        FROM reconciliation_line_items
        WHERE reconciliation_id = %s
        ORDER BY sort_order, created_at, id
        """,
        [bill["id"]],
    ).fetchall()
    metadata = list(pending.get("metadata_json") or [])
    _ensure_v2_tables(conn)
    candidate_map = {str(row.get("access_item_id") or ""): row for row in _candidate_rows(conn)}

    finalized_metadata: list[dict] = []
    for position, source in enumerate(metadata):
        item = dict(source or {})
        try:
            line_index = int(item.get("line_index", position))
        except (TypeError, ValueError):
            line_index = position
        line_row = line_rows[line_index] if 0 <= line_index < len(line_rows) else None
        if line_row:
            item["saved_line_id"] = str(line_row["id"])
            item["saved_game_name"] = line_row.get("game_name") or ""
            item["saved_settlement_cycle"] = line_row.get("settlement_cycle") or ""
        finalized_metadata.append(item)

        access_item_id = _text(item.get("access_item_id"), 128)
        if not line_row or not access_item_id or not bool(item.get("binding_allowed")):
            continue
        candidate = candidate_map.get(access_item_id)
        scored = score_candidate(
            {
                "partner_name": bill.get("partner_name") or "",
                "channel_name": "",
                "settlement_month": bill.get("settlement_month") or "",
            },
            {
                "game_name": line_row.get("game_name") or "",
                "settlement_cycle": line_row.get("settlement_cycle") or bill.get("settlement_month") or "",
            },
            candidate or {},
        )
        safe_binding = (
            candidate is not None
            and scored.get("confidence") == "high"
            and scored.get("authorization_status") == "covered"
            and float(scored.get("score") or 0) >= 82
        )
        if not safe_binding:
            item["binding_allowed"] = False
            item["binding_rejected_reason"] = "保存后复核未达到自动锁定阈值，未写入合同绑定"
            continue
        conn.execute(
            """
            INSERT INTO cf_bill_contract_links (
              bill_type, bill_id, line_id, access_item_id, match_method,
              note, confirmed_by, confirmed_at, created_at, updated_at
            )
            VALUES ('rd', %s, %s, %s, 'draft_contract', %s, %s, NOW(), NOW(), NOW())
            ON CONFLICT (bill_type, bill_id, line_id)
            DO UPDATE SET
              access_item_id = EXCLUDED.access_item_id,
              match_method = 'draft_contract',
              note = EXCLUDED.note,
              confirmed_by = EXCLUDED.confirmed_by,
              confirmed_at = NOW(),
              updated_at = NOW()
            """,
            [
                str(bill["id"]),
                str(line_row["id"]),
                access_item_id,
                "V3.1 合同驱动录入时锁定；人工偏离原因：" + _text(item.get("override_reason"), 600),
                actor,
            ],
        )

    finalized_metadata = replace_bill_prepayment_deductions(
        conn,
        str(bill["id"]),
        finalized_metadata,
        actor,
    )

    snapshot_id = uuid4().hex
    conn.execute(
        """
        INSERT INTO cf_rd_contract_entry_snapshots (
          id, bill_id, statement_no, metadata_json, created_by
        )
        VALUES (%s, %s, %s, %s, %s)
        """,
        [snapshot_id, str(bill["id"]), statement_no, Jsonb(finalized_metadata), actor],
    )
    conn.execute(
        "DELETE FROM cf_rd_contract_entry_pending WHERE statement_no = %s",
        [statement_no],
    )
    return {
        "id": snapshot_id,
        "bill_id": str(bill["id"]),
        "statement_no": statement_no,
        "metadata": finalized_metadata,
        "created_by": actor,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _recover_pending_for_bill(conn: psycopg.Connection, bill_id: str, actor: str) -> dict | None:
    bill = conn.execute(
        "SELECT statement_no FROM reconciliation_records WHERE id = %s",
        [bill_id],
    ).fetchone()
    if not bill:
        return None
    return _finalize_pending_entry(conn, str(bill.get("statement_no") or ""), actor)


@app.post("/api/contract-terms/rd-rule-recommendation")
def recommend_rd_rule(request: Request, payload: dict) -> dict:
    _require_permission(request, "contracts.view")
    partner_name = _text(payload.get("partner_name"), 500)
    lines = payload.get("lines") if isinstance(payload.get("lines"), list) else []
    if not partner_name:
        raise HTTPException(status_code=422, detail="请先选择合作方，再自动匹配研发合同规则")
    if not lines:
        raise HTTPException(status_code=422, detail="请至少填写一条游戏明细")
    bill_id = _text(payload.get("bill_id"), 128)
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        candidates = enrich_prepayment_candidates(
            conn,
            _candidate_rows(conn),
            exclude_bill_id=bill_id or None,
        )
        result = recommend_rd_rules(partner_name, lines, candidates)
        conn.commit()
    return {**result, "partner_name": partner_name, "generated_at": datetime.now(timezone.utc).isoformat()}


@app.post("/api/contract-terms/rd-entry/prepare")
def prepare_rd_contract_entry(request: Request, payload: dict) -> dict:
    actor = _require_permission(request, "contracts.view")
    statement_no = _text(payload.get("statement_no"), 200)
    if not statement_no:
        raise HTTPException(status_code=422, detail="缺少研发账单编号")
    metadata = _metadata_payload(payload.get("metadata") or [])
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_rd_entry_tables(conn)
        conn.execute(
            """
            INSERT INTO cf_rd_contract_entry_pending (
              statement_no, metadata_json, prepared_by, prepared_at, updated_at
            )
            VALUES (%s, %s, %s, NOW(), NOW())
            ON CONFLICT (statement_no)
            DO UPDATE SET
              metadata_json = EXCLUDED.metadata_json,
              prepared_by = EXCLUDED.prepared_by,
              updated_at = NOW()
            """,
            [statement_no, Jsonb(metadata), actor],
        )
        conn.commit()
    return {"ok": True, "statement_no": statement_no, "metadata_count": len(metadata)}


@app.post("/api/contract-terms/rd-entry/finalize")
def finalize_rd_contract_entry(request: Request, payload: dict) -> dict:
    actor = _require_permission(request, "contracts.view")
    statement_no = _text(payload.get("statement_no"), 200)
    if not statement_no:
        raise HTTPException(status_code=422, detail="缺少研发账单编号")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        result = _finalize_pending_entry(conn, statement_no, actor)
        if result is None:
            bill = conn.execute(
                "SELECT id FROM reconciliation_records WHERE statement_no = %s",
                [statement_no],
            ).fetchone()
            if bill:
                result = _latest_snapshot(conn, str(bill["id"]))
        conn.commit()
    if result is None:
        raise HTTPException(status_code=409, detail="账单尚未保存，合同录入快照暂不能固化")
    return result


@app.get("/api/contract-terms/rd-entry/latest")
def latest_rd_contract_entry(
    request: Request,
    bill_id: str = Query(..., min_length=1, max_length=128),
) -> dict:
    actor = _require_permission(request, "contracts.view")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_rd_entry_tables(conn)
        recovered = _recover_pending_for_bill(conn, bill_id, actor)
        result = recovered or _latest_snapshot(conn, bill_id)
        conn.commit()
    return result or {"bill_id": bill_id, "metadata": []}


@app.get("/api/contract-terms/reconcile-v3")
def reconcile_bill_contract_v31(
    request: Request,
    bill_type: str = Query(..., pattern="^(rd|channel)$"),
    bill_id: str = Query(..., min_length=1, max_length=128),
) -> dict:
    actor = _require_permission(request, "contracts.view")
    if bill_type == "rd":
        with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
            _ensure_rd_entry_tables(conn)
            _recover_pending_for_bill(conn, bill_id, actor)
            conn.commit()
    result = _v8_reconcile(request, bill_type=bill_type, bill_id=bill_id)
    result = dict(result)
    result["entry_version"] = "contract-driven-rd-v3.1"
    return result
