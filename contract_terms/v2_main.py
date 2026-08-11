"""Contract reconciliation V2: persistent bill-line bindings and audit snapshots.

V1 performs deterministic preflight matching. V2 closes the loop by allowing a
finance user to lock a bill line to the exact contract access item, reuse that
binding on later checks, auto-lock high-confidence matches in bulk, and persist
an immutable reconciliation snapshot when a bill is confirmed.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import Response
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

try:
    from .extended_main import (
        app as _v1_app,
        _bill_level_checks,
        _candidate_rows,
        _channel_bill,
        _database_url,
        _rd_bill,
        _require_permission,
    )
    from .matcher import (
        compare_bill_to_candidate,
        normalize_company,
        score_candidate,
        summarize_results,
    )
except ImportError:  # Vercel imports service modules from the service root.
    from extended_main import (
        app as _v1_app,
        _bill_level_checks,
        _candidate_rows,
        _channel_bill,
        _database_url,
        _rd_bill,
        _require_permission,
    )
    from matcher import (
        compare_bill_to_candidate,
        normalize_company,
        score_candidate,
        summarize_results,
    )


app = FastAPI(
    title="contract-reconciliation-v2",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
# Preserve all stable V1 contract-term endpoints. V2 endpoints use distinct
# paths so route order cannot shadow them.
app.router.routes.extend(list(_v1_app.router.routes))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(value: Any, limit: int = 2000) -> str:
    return str(value or "").strip()[:limit]


def _ensure_v2_tables(conn: psycopg.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_bill_contract_links (
          bill_type TEXT NOT NULL,
          bill_id TEXT NOT NULL,
          line_id TEXT NOT NULL,
          access_item_id TEXT NOT NULL REFERENCES cf_contract_access_items(id) ON DELETE CASCADE,
          match_method TEXT NOT NULL DEFAULT 'manual',
          note TEXT NOT NULL DEFAULT '',
          confirmed_by TEXT NOT NULL DEFAULT '',
          confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (bill_type, bill_id, line_id),
          CONSTRAINT cf_bill_contract_links_type_chk CHECK (bill_type IN ('rd', 'channel'))
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_bill_contract_links_access
        ON cf_bill_contract_links (access_item_id)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_bill_contract_links_bill
        ON cf_bill_contract_links (bill_type, bill_id)
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_contract_reconciliation_snapshots (
          id TEXT PRIMARY KEY,
          bill_type TEXT NOT NULL,
          bill_id TEXT NOT NULL,
          event_type TEXT NOT NULL DEFAULT 'confirmed',
          overall_status TEXT NOT NULL DEFAULT '',
          summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT cf_contract_snapshots_type_chk CHECK (bill_type IN ('rd', 'channel'))
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_contract_snapshots_bill
        ON cf_contract_reconciliation_snapshots (bill_type, bill_id, created_at DESC)
        """
    )


def _load_bill(conn: psycopg.Connection, bill_type: str, bill_id: str) -> tuple[dict, list[dict]]:
    if bill_type == "rd":
        return _rd_bill(conn, bill_id)
    if bill_type == "channel":
        return _channel_bill(conn, bill_id)
    raise HTTPException(status_code=422, detail="不支持的账单类型")


def _links_for_bill(conn: psycopg.Connection, bill_type: str, bill_id: str) -> dict[str, dict]:
    _ensure_v2_tables(conn)
    rows = conn.execute(
        """
        SELECT bill_type, bill_id, line_id, access_item_id, match_method, note,
               confirmed_by, confirmed_at, created_at, updated_at
        FROM cf_bill_contract_links
        WHERE bill_type = %s AND bill_id = %s
        """,
        [bill_type, bill_id],
    ).fetchall()
    return {str(row["line_id"]): dict(row) for row in rows}


def _link_payload(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        "bill_type": row.get("bill_type"),
        "bill_id": row.get("bill_id"),
        "line_id": row.get("line_id"),
        "access_item_id": row.get("access_item_id"),
        "match_method": row.get("match_method") or "manual",
        "note": row.get("note") or "",
        "confirmed_by": row.get("confirmed_by") or "",
        "confirmed_at": row["confirmed_at"].isoformat() if row.get("confirmed_at") else None,
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
    }


def _same_partner(bill: dict, candidate: dict) -> bool:
    bill_partner = normalize_company(bill.get("partner_name"))
    if not bill_partner:
        return False
    candidate_partners = {
        normalize_company(candidate.get("partner_name")),
        normalize_company(candidate.get("partner_short_name")),
        normalize_company(candidate.get("counterparty")),
    }
    candidate_partners.discard("")
    return bill_partner in candidate_partners


def _candidate_option(candidate: dict, match: dict) -> dict:
    return {
        "contract_id": candidate.get("contract_id"),
        "contract_name": candidate.get("contract_name") or "",
        "contract_no": candidate.get("contract_no"),
        "access_item_id": candidate.get("access_item_id"),
        "product_name": candidate.get("product_name") or "",
        "channel_name": candidate.get("channel_name") or "",
        "partner_name": candidate.get("partner_name") or candidate.get("counterparty") or "",
        "authorization_start": candidate.get("authorization_start"),
        "authorization_end": candidate.get("authorization_end"),
        "share_rate": candidate.get("share_rate"),
        "channel_fee_rate": candidate.get("channel_fee_rate"),
        "invoice_tax_rate": candidate.get("invoice_tax_rate"),
        "settlement_mode": candidate.get("settlement_mode"),
        "settlement_basis": candidate.get("settlement_basis"),
        "payment_terms": candidate.get("payment_terms"),
        "score": match.get("score", 0),
        "confidence": match.get("confidence", "low"),
        "authorization_status": match.get("authorization_status", "unknown"),
        "eligible": bool(match.get("eligible")),
        "reasons": match.get("reasons") or [],
    }


def _candidate_options(bill: dict, line: dict, candidates: list[dict]) -> list[dict]:
    options: list[tuple[dict, dict]] = []
    for candidate in candidates:
        match = score_candidate(bill, line, candidate)
        # A manual selector must remain useful when the game alias is imperfect.
        # Include every access item belonging to the same partner, plus normal
        # eligible candidates, then rank by the deterministic score.
        if match.get("eligible") or _same_partner(bill, candidate):
            options.append((candidate, match))
    options.sort(
        key=lambda item: (
            1 if item[1].get("eligible") else 0,
            float(item[1].get("score") or 0),
            str(item[0].get("contract_name") or ""),
        ),
        reverse=True,
    )
    return [_candidate_option(candidate, match) for candidate, match in options[:30]]


def _match_payload(candidate: dict, match: dict, binding: dict | None) -> dict:
    method = binding.get("match_method") if binding else "auto"
    reasons = list(match.get("reasons") or [])
    if binding:
        reasons.insert(0, "已锁定合同依据")
    return {
        "contract_id": candidate.get("contract_id"),
        "contract_name": candidate.get("contract_name") or "",
        "contract_no": candidate.get("contract_no"),
        "access_item_id": candidate.get("access_item_id"),
        "product_name": candidate.get("product_name") or "",
        "channel_name": candidate.get("channel_name") or "",
        "authorization_start": candidate.get("authorization_start"),
        "authorization_end": candidate.get("authorization_end"),
        "share_rate": candidate.get("share_rate"),
        "channel_fee_rate": candidate.get("channel_fee_rate"),
        "invoice_tax_rate": candidate.get("invoice_tax_rate"),
        "settlement_mode": candidate.get("settlement_mode"),
        "settlement_basis": candidate.get("settlement_basis"),
        "payment_terms": candidate.get("payment_terms"),
        "score": match.get("score", 0),
        "confidence": match.get("confidence", "low"),
        "reasons": reasons,
        "match_method": method,
        "locked": bool(binding),
    }


def _evaluate_line_v2(
    bill: dict,
    line: dict,
    candidates: list[dict],
    binding: dict | None,
) -> dict:
    options = _candidate_options(bill, line, candidates)
    candidate_by_id = {
        str(candidate.get("access_item_id")): candidate
        for candidate in candidates
        if candidate.get("access_item_id")
    }

    chosen: dict | None = None
    match: dict | None = None
    if binding:
        chosen = candidate_by_id.get(str(binding.get("access_item_id") or ""))
        if chosen is not None:
            match = score_candidate(bill, line, chosen)

    if chosen is None:
        ranked: list[tuple[dict, dict]] = []
        for candidate in candidates:
            candidate_match = score_candidate(bill, line, candidate)
            if candidate_match.get("eligible"):
                ranked.append((candidate, candidate_match))
        ranked.sort(key=lambda item: float(item[1].get("score") or 0), reverse=True)
        if ranked:
            chosen, match = ranked[0]

    line_id = _text(line.get("line_id"), 200) or "legacy"
    game_name = _text(line.get("game_name"), 500)
    settlement_cycle = _text(line.get("settlement_cycle") or bill.get("settlement_month"), 64)

    if chosen is None or match is None:
        return {
            "line_id": line_id,
            "game_name": game_name,
            "settlement_cycle": settlement_cycle,
            "status": "unmatched",
            "match": None,
            "binding": _link_payload(binding),
            "candidates": options,
            "checks": [],
            "message": "没有找到可用的合同合作清单，请在合同中心补充清单或人工锁定正确依据。",
        }

    checks = compare_bill_to_candidate(bill, line, chosen, match)
    failed = any(item.get("status") == "fail" for item in checks)
    needs_review = any(item.get("status") in {"missing", "manual"} for item in checks)
    # Once a human explicitly locks the contract access item, a low automatic
    # identity score is no longer itself a review issue. Financial differences
    # and missing contract fields still remain visible and unchanged.
    low_confidence = match.get("confidence") == "low" and not binding
    status = "fail" if failed else "warning" if needs_review or low_confidence else "pass"

    return {
        "line_id": line_id,
        "game_name": game_name,
        "settlement_cycle": settlement_cycle,
        "status": status,
        "match": _match_payload(chosen, match, binding),
        "binding": _link_payload(binding),
        "candidates": options,
        "checks": checks,
        "message": (
            "发现合同差异，请先核验。"
            if status == "fail"
            else "已锁定合同依据，但仍有条款需要人工确认。"
            if status == "warning" and binding
            else "已匹配合同，但仍有条款需要人工确认。"
            if status == "warning"
            else "已锁定合同依据，关键字段与账单一致。"
            if binding
            else "合同关键字段与账单一致。"
        ),
    }


def _snapshot_meta(row: dict | None) -> dict | None:
    if not row:
        return None
    summary = row.get("summary_json") or {}
    return {
        "id": row.get("id"),
        "bill_type": row.get("bill_type"),
        "bill_id": row.get("bill_id"),
        "event_type": row.get("event_type") or "confirmed",
        "overall_status": row.get("overall_status") or "",
        "summary": summary,
        "created_by": row.get("created_by") or "",
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
    }


def _latest_snapshot(conn: psycopg.Connection, bill_type: str, bill_id: str) -> dict | None:
    row = conn.execute(
        """
        SELECT id, bill_type, bill_id, event_type, overall_status, summary_json,
               created_by, created_at
        FROM cf_contract_reconciliation_snapshots
        WHERE bill_type = %s AND bill_id = %s
        ORDER BY created_at DESC
        LIMIT 1
        """,
        [bill_type, bill_id],
    ).fetchone()
    return _snapshot_meta(dict(row)) if row else None


def _reconcile_data(conn: psycopg.Connection, bill_type: str, bill_id: str) -> dict:
    _ensure_v2_tables(conn)
    bill, lines = _load_bill(conn, bill_type, bill_id)
    candidates = _candidate_rows(conn)
    links = _links_for_bill(conn, bill_type, bill_id)
    results = [
        _evaluate_line_v2(
            bill,
            line,
            candidates,
            links.get(_text(line.get("line_id"), 200) or "legacy"),
        )
        for line in lines
    ]
    bill_checks = _bill_level_checks(bill, results)
    summary = summarize_results(results)
    if bill_checks:
        summary["warning_count"] += len(bill_checks)
        summary["issue_count"] += len(bill_checks)
        summary["overall_status"] = "warning" if summary["overall_status"] == "pass" else summary["overall_status"]
        summary["can_auto_confirm"] = False

    binding_rows = [result.get("binding") for result in results if result.get("binding")]
    summary["binding_count"] = len(binding_rows)
    summary["manual_binding_count"] = sum(
        1 for item in binding_rows if item.get("match_method") == "manual"
    )
    summary["auto_binding_count"] = sum(
        1 for item in binding_rows if item.get("match_method") == "auto_locked"
    )

    return {
        "version": "contract-match-v2",
        "generated_at": _now_iso(),
        "bill": bill,
        "summary": summary,
        "lines": results,
        "bill_checks": bill_checks,
        "last_snapshot": _latest_snapshot(conn, bill_type, bill_id),
    }


def _validate_line_exists(lines: list[dict], line_id: str) -> None:
    valid = {_text(item.get("line_id"), 200) or "legacy" for item in lines}
    if line_id not in valid:
        raise HTTPException(status_code=404, detail="账单明细不存在或已被修改")


def _validate_access_item(conn: psycopg.Connection, access_item_id: str) -> None:
    row = conn.execute(
        "SELECT id FROM cf_contract_access_items WHERE id = %s",
        [access_item_id],
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="合同合作清单不存在")


@app.get("/api/contract-terms/reconcile-v2")
def reconcile_bill_contract_v2(
    request: Request,
    bill_type: str = Query(..., pattern="^(rd|channel)$"),
    bill_id: str = Query(..., min_length=1, max_length=128),
) -> dict:
    _require_permission(request, "contracts.view")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        result = _reconcile_data(conn, bill_type, bill_id)
        conn.commit()
    return result


@app.get("/api/contract-terms/bill-links")
def list_bill_contract_links(
    request: Request,
    bill_type: str = Query(..., pattern="^(rd|channel)$"),
    bill_id: str = Query(..., min_length=1, max_length=128),
) -> dict:
    _require_permission(request, "contracts.view")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        links = _links_for_bill(conn, bill_type, bill_id)
        conn.commit()
    items = [_link_payload(row) for row in links.values()]
    return {"items": items, "total": len(items)}


@app.put("/api/contract-terms/bill-links/{bill_type}/{bill_id}/{line_id}")
def upsert_bill_contract_link(
    bill_type: str,
    bill_id: str,
    line_id: str,
    request: Request,
    payload: dict,
) -> dict:
    if bill_type not in {"rd", "channel"}:
        raise HTTPException(status_code=422, detail="不支持的账单类型")
    actor = _require_permission(request, "contracts.manage")
    access_item_id = _text(payload.get("access_item_id"), 200)
    if not access_item_id:
        raise HTTPException(status_code=422, detail="请选择合同合作清单")
    note = _text(payload.get("note"), 1000)
    safe_bill_id = _text(bill_id, 128)
    safe_line_id = _text(line_id, 200) or "legacy"

    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_v2_tables(conn)
        _, lines = _load_bill(conn, bill_type, safe_bill_id)
        _validate_line_exists(lines, safe_line_id)
        _validate_access_item(conn, access_item_id)
        row = conn.execute(
            """
            INSERT INTO cf_bill_contract_links (
              bill_type, bill_id, line_id, access_item_id, match_method, note,
              confirmed_by, confirmed_at
            )
            VALUES (%s, %s, %s, %s, 'manual', %s, %s, NOW())
            ON CONFLICT (bill_type, bill_id, line_id) DO UPDATE SET
              access_item_id = EXCLUDED.access_item_id,
              match_method = 'manual',
              note = EXCLUDED.note,
              confirmed_by = EXCLUDED.confirmed_by,
              confirmed_at = NOW(),
              updated_at = NOW()
            RETURNING *
            """,
            [bill_type, safe_bill_id, safe_line_id, access_item_id, note, actor],
        ).fetchone()
        conn.commit()
    return _link_payload(dict(row)) or {}


@app.delete("/api/contract-terms/bill-links/{bill_type}/{bill_id}/{line_id}", status_code=204)
def delete_bill_contract_link(
    bill_type: str,
    bill_id: str,
    line_id: str,
    request: Request,
) -> Response:
    if bill_type not in {"rd", "channel"}:
        raise HTTPException(status_code=422, detail="不支持的账单类型")
    _require_permission(request, "contracts.manage")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_v2_tables(conn)
        conn.execute(
            "DELETE FROM cf_bill_contract_links WHERE bill_type = %s AND bill_id = %s AND line_id = %s",
            [bill_type, _text(bill_id, 128), _text(line_id, 200) or "legacy"],
        )
        conn.commit()
    return Response(status_code=204)


@app.post("/api/contract-terms/bill-links/auto-lock")
def auto_lock_bill_contract_links(request: Request, payload: dict) -> dict:
    actor = _require_permission(request, "contracts.manage")
    bill_type = _text(payload.get("bill_type"), 20)
    bill_id = _text(payload.get("bill_id"), 128)
    if bill_type not in {"rd", "channel"} or not bill_id:
        raise HTTPException(status_code=422, detail="账单类型或账单 ID 无效")

    locked = 0
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
            if (
                match.get("access_item_id")
                and match.get("confidence") == "high"
                and float(match.get("score") or 0) >= 82
            ):
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
                        f"高置信自动锁定，匹配分 {match.get('score')}",
                        actor,
                    ],
                )
                locked += 1
        result = _reconcile_data(conn, bill_type, bill_id)
        conn.commit()
    return {"locked_count": locked, "reconciliation": result}


@app.post("/api/contract-terms/reconcile-snapshots")
def create_reconciliation_snapshot(request: Request, payload: dict) -> dict:
    # Snapshot creation is an audit side-effect rather than a contract mutation;
    # users who can view contract evidence may persist the evidence used when a
    # bill is confirmed. The bill transition itself remains governed elsewhere.
    actor = _require_permission(request, "contracts.view")
    bill_type = _text(payload.get("bill_type"), 20)
    bill_id = _text(payload.get("bill_id"), 128)
    event_type = _text(payload.get("event_type"), 80) or "confirmed"
    if bill_type not in {"rd", "channel"} or not bill_id:
        raise HTTPException(status_code=422, detail="账单类型或账单 ID 无效")

    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_v2_tables(conn)
        result = _reconcile_data(conn, bill_type, bill_id)
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
                result["summary"].get("overall_status") or "",
                Jsonb(result["summary"]),
                Jsonb(result),
                actor,
            ],
        ).fetchone()
        conn.commit()
    return _snapshot_meta(dict(row)) or {}


@app.get("/api/contract-terms/reconcile-snapshots")
def list_reconciliation_snapshots(
    request: Request,
    bill_type: str = Query(..., pattern="^(rd|channel)$"),
    bill_id: str = Query(..., min_length=1, max_length=128),
    limit: int = Query(10, ge=1, le=50),
) -> dict:
    _require_permission(request, "contracts.view")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_v2_tables(conn)
        rows = conn.execute(
            """
            SELECT id, bill_type, bill_id, event_type, overall_status, summary_json,
                   created_by, created_at
            FROM cf_contract_reconciliation_snapshots
            WHERE bill_type = %s AND bill_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            [bill_type, bill_id, limit],
        ).fetchall()
        conn.commit()
    items = [_snapshot_meta(dict(row)) for row in rows]
    return {"items": items, "total": len(items)}
