"""Contract reconciliation V4: difference disposition workflow.

V3 calculates contract-standard settlement amounts. V4 turns deterministic amount
differences into finance-owned cases with auditable actions: edit bill, accept the
variance, create an adjustment, or carry it forward to a later period.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

try:
    from .v3_main import (
        app as _v3_app,
        _database_url,
        _reconcile_data_v3,
        _require_permission,
    )
    from .matcher import summarize_results
except ImportError:  # Vercel imports modules from the service root.
    from v3_main import (
        app as _v3_app,
        _database_url,
        _reconcile_data_v3,
        _require_permission,
    )
    from matcher import summarize_results


app = FastAPI(
    title="contract-reconciliation-v4",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.router.routes.extend(list(_v3_app.router.routes))

CASE_STATUSES = {"pending", "processing", "resolved"}
HANDLING_TYPES = {"edit_bill", "accept_difference", "adjustment", "carry_forward"}
REASON_TYPES = {"商务协商", "四舍五入", "历史遗留", "特殊活动", "其他"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(value: Any, limit: int = 4000) -> str:
    return str(value or "").strip()[:limit]


def _float(value: Any, fallback: float = 0.0) -> float:
    if value in (None, ""):
        return fallback
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number == number else fallback


def _ensure_difference_tables(conn: psycopg.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_contract_difference_cases (
          id TEXT PRIMARY KEY,
          bill_type TEXT NOT NULL,
          bill_id TEXT NOT NULL,
          line_id TEXT NOT NULL,
          access_item_id TEXT,
          contract_id TEXT,
          contract_name TEXT NOT NULL DEFAULT '',
          contract_no TEXT NOT NULL DEFAULT '',
          statement_no TEXT NOT NULL DEFAULT '',
          partner_name TEXT NOT NULL DEFAULT '',
          game_name TEXT NOT NULL DEFAULT '',
          settlement_cycle TEXT NOT NULL DEFAULT '',
          expected_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
          actual_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
          difference_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
          variance_direction TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          handling_type TEXT,
          substatus TEXT NOT NULL DEFAULT '',
          reason_type TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          owner TEXT NOT NULL DEFAULT '',
          evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          source_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_by TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          resolved_at TIMESTAMPTZ,
          CONSTRAINT cf_contract_difference_case_type_chk CHECK (bill_type IN ('rd', 'channel')),
          CONSTRAINT cf_contract_difference_case_status_chk CHECK (status IN ('pending', 'processing', 'resolved')),
          UNIQUE (bill_type, bill_id, line_id)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_contract_difference_cases_status
        ON cf_contract_difference_cases (status, updated_at DESC)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_contract_difference_cases_bill
        ON cf_contract_difference_cases (bill_type, bill_id, updated_at DESC)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_contract_difference_cases_period
        ON cf_contract_difference_cases (settlement_cycle, status)
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_contract_difference_events (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cf_contract_difference_cases(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          detail TEXT NOT NULL DEFAULT '',
          payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          actor TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_contract_difference_events_case
        ON cf_contract_difference_events (case_id, created_at DESC)
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_contract_adjustments (
          id TEXT PRIMARY KEY,
          adjustment_no TEXT NOT NULL UNIQUE,
          case_id TEXT NOT NULL REFERENCES cf_contract_difference_cases(id) ON DELETE CASCADE,
          source_bill_type TEXT NOT NULL,
          source_bill_id TEXT NOT NULL,
          source_statement_no TEXT NOT NULL DEFAULT '',
          partner_name TEXT NOT NULL DEFAULT '',
          game_name TEXT NOT NULL DEFAULT '',
          settlement_cycle TEXT NOT NULL DEFAULT '',
          direction TEXT NOT NULL,
          direction_label TEXT NOT NULL DEFAULT '',
          amount NUMERIC(18,2) NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          invoice_id TEXT NOT NULL DEFAULT '',
          bank_transaction_id TEXT NOT NULL DEFAULT '',
          reconciliation_note TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          CONSTRAINT cf_contract_adjustments_status_chk CHECK (status IN ('open', 'completed', 'cancelled'))
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_contract_adjustments_case
        ON cf_contract_adjustments (case_id, created_at DESC)
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_contract_carry_forwards (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES cf_contract_difference_cases(id) ON DELETE CASCADE,
          source_bill_type TEXT NOT NULL,
          source_bill_id TEXT NOT NULL,
          source_statement_no TEXT NOT NULL DEFAULT '',
          partner_name TEXT NOT NULL DEFAULT '',
          game_name TEXT NOT NULL DEFAULT '',
          source_month TEXT NOT NULL DEFAULT '',
          target_month TEXT NOT NULL,
          direction TEXT NOT NULL,
          amount NUMERIC(18,2) NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          target_bill_type TEXT NOT NULL DEFAULT '',
          target_bill_id TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          applied_at TIMESTAMPTZ,
          CONSTRAINT cf_contract_carry_forwards_status_chk CHECK (status IN ('pending', 'applied', 'cancelled'))
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_contract_carry_forwards_target
        ON cf_contract_carry_forwards (target_month, partner_name, game_name, status)
        """
    )


def _event(
    conn: psycopg.Connection,
    case_id: str,
    event_type: str,
    title: str,
    detail: str,
    actor: str,
    payload: dict | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO cf_contract_difference_events
          (id, case_id, event_type, title, detail, payload_json, actor)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        [
            uuid4().hex,
            case_id,
            _text(event_type, 80),
            _text(title, 200),
            _text(detail, 4000),
            Jsonb(jsonable_encoder(payload or {})),
            _text(actor, 200),
        ],
    )


def _case_payload(row: dict) -> dict:
    payload = dict(row)
    payload["expected_amount"] = _float(payload.get("expected_amount"))
    payload["actual_amount"] = _float(payload.get("actual_amount"))
    payload["difference_amount"] = _float(payload.get("difference_amount"))
    payload["variance_abs"] = round(abs(payload["difference_amount"]), 2)
    payload["evidence"] = payload.pop("evidence_json", []) or []
    payload["source_snapshot"] = payload.pop("source_snapshot_json", {}) or {}
    return payload


def _adjustment_payload(row: dict) -> dict:
    payload = dict(row)
    payload["amount"] = _float(payload.get("amount"))
    return payload


def _carry_payload(row: dict) -> dict:
    payload = dict(row)
    payload["amount"] = _float(payload.get("amount"))
    return payload


def _case_by_id(conn: psycopg.Connection, case_id: str) -> dict:
    row = conn.execute(
        "SELECT * FROM cf_contract_difference_cases WHERE id = %s",
        [case_id],
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="合同差异不存在")
    return dict(row)


def _case_for_line(
    conn: psycopg.Connection,
    bill_type: str,
    bill_id: str,
    line_id: str,
) -> dict | None:
    row = conn.execute(
        """
        SELECT * FROM cf_contract_difference_cases
        WHERE bill_type = %s AND bill_id = %s AND line_id = %s
        """,
        [bill_type, bill_id, line_id],
    ).fetchone()
    return dict(row) if row else None


def _sync_difference_cases(
    conn: psycopg.Connection,
    bill_type: str,
    bill_id: str,
    reconciliation: dict,
    actor: str = "system",
) -> dict[str, dict]:
    _ensure_difference_tables(conn)
    bill = reconciliation.get("bill") or {}
    case_map: dict[str, dict] = {}

    for line in reconciliation.get("lines") or []:
        amount = line.get("contract_amount") or {}
        line_id = str(line.get("line_id") or "legacy")
        existing = _case_for_line(conn, bill_type, bill_id, line_id)
        if amount.get("status") != "fail" or amount.get("expected_amount") is None:
            if (
                existing
                and existing.get("status") in {"pending", "processing"}
                and (not existing.get("handling_type") or existing.get("handling_type") == "edit_bill")
            ):
                conn.execute(
                    """
                    UPDATE cf_contract_difference_cases
                    SET status = 'resolved',
                        substatus = 'bill_corrected',
                        updated_by = %s,
                        updated_at = NOW(),
                        resolved_at = NOW()
                    WHERE id = %s
                    """,
                    [actor, existing["id"]],
                )
                _event(
                    conn,
                    str(existing["id"]),
                    "auto_resolved",
                    "差异已关闭",
                    "重新核验后合同标准金额与账单不再存在明确差异。",
                    actor,
                )
                existing = _case_by_id(conn, str(existing["id"]))
            if existing:
                case_map[line_id] = existing
            continue

        match = line.get("match") or {}
        snapshot = {
            "contract_amount": amount,
            "checks": line.get("checks") or [],
            "match": match,
            "generated_at": reconciliation.get("generated_at"),
            "version": reconciliation.get("version"),
        }
        values = {
            "access_item_id": _text(match.get("access_item_id"), 128) or None,
            "contract_id": _text(match.get("contract_id"), 128) or None,
            "contract_name": _text(match.get("contract_name"), 500),
            "contract_no": _text(match.get("contract_no"), 200),
            "statement_no": _text(bill.get("statement_no"), 200),
            "partner_name": _text(bill.get("partner_name"), 500),
            "game_name": _text(line.get("game_name"), 500),
            "settlement_cycle": _text(line.get("settlement_cycle"), 80),
            "expected_amount": _float(amount.get("expected_amount")),
            "actual_amount": _float(amount.get("actual_amount")),
            "difference_amount": _float(amount.get("difference_amount")),
            "variance_direction": _text(amount.get("variance_direction"), 20),
        }

        if existing is None:
            case_id = uuid4().hex
            conn.execute(
                """
                INSERT INTO cf_contract_difference_cases (
                  id, bill_type, bill_id, line_id, access_item_id, contract_id,
                  contract_name, contract_no, statement_no, partner_name, game_name,
                  settlement_cycle, expected_amount, actual_amount, difference_amount,
                  variance_direction, status, handling_type, substatus,
                  source_snapshot_json, created_by, updated_by
                )
                VALUES (
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, 'pending', NULL, '', %s, %s, %s
                )
                """,
                [
                    case_id,
                    bill_type,
                    bill_id,
                    line_id,
                    values["access_item_id"],
                    values["contract_id"],
                    values["contract_name"],
                    values["contract_no"],
                    values["statement_no"],
                    values["partner_name"],
                    values["game_name"],
                    values["settlement_cycle"],
                    values["expected_amount"],
                    values["actual_amount"],
                    values["difference_amount"],
                    values["variance_direction"],
                    Jsonb(jsonable_encoder(snapshot)),
                    actor,
                    actor,
                ],
            )
            direction = "少结" if values["variance_direction"] == "under" else "多结"
            _event(
                conn,
                case_id,
                "detected",
                "发现合同金额差异",
                f"合同应结 ¥{values['expected_amount']:.2f}，账单实际 ¥{values['actual_amount']:.2f}，{direction} ¥{abs(values['difference_amount']):.2f}。",
                actor,
                snapshot,
            )
            existing = _case_by_id(conn, case_id)
        else:
            conn.execute(
                """
                UPDATE cf_contract_difference_cases
                SET access_item_id = %s,
                    contract_id = %s,
                    contract_name = %s,
                    contract_no = %s,
                    statement_no = %s,
                    partner_name = %s,
                    game_name = %s,
                    settlement_cycle = %s,
                    expected_amount = %s,
                    actual_amount = %s,
                    difference_amount = %s,
                    variance_direction = %s,
                    source_snapshot_json = %s,
                    updated_by = %s,
                    updated_at = NOW()
                WHERE id = %s
                """,
                [
                    values["access_item_id"],
                    values["contract_id"],
                    values["contract_name"],
                    values["contract_no"],
                    values["statement_no"],
                    values["partner_name"],
                    values["game_name"],
                    values["settlement_cycle"],
                    values["expected_amount"],
                    values["actual_amount"],
                    values["difference_amount"],
                    values["variance_direction"],
                    Jsonb(jsonable_encoder(snapshot)),
                    actor,
                    existing["id"],
                ],
            )
            existing = _case_by_id(conn, str(existing["id"]))
        case_map[line_id] = existing

    return case_map


def _apply_case_dispositions(reconciliation: dict, case_map: dict[str, dict]) -> dict:
    result = dict(reconciliation)
    lines: list[dict] = []
    handled_count = 0
    unresolved_count = 0

    for source in reconciliation.get("lines") or []:
        line = dict(source)
        line_id = str(line.get("line_id") or "legacy")
        case = case_map.get(line_id)
        if case:
            line["difference_case"] = _case_payload(case)

        amount = line.get("contract_amount") or {}
        if amount.get("status") == "fail":
            if case and case.get("status") in {"processing", "resolved"} and case.get("handling_type"):
                handled_count += 1
                non_amount_fail = any(
                    check.get("status") == "fail" and check.get("key") != "contract_standard_settlement"
                    for check in (line.get("checks") or [])
                )
                if not non_amount_fail:
                    line["status"] = "warning" if case.get("status") == "processing" else "pass"
                    handling_label = {
                        "edit_bill": "待修改账单",
                        "accept_difference": "已接受差异",
                        "adjustment": "已生成补差项",
                        "carry_forward": "待下月冲抵",
                    }.get(case.get("handling_type"), "差异处理中")
                    line["message"] = f"{handling_label} · ¥{abs(_float(case.get('difference_amount'))):.2f}"
            else:
                unresolved_count += 1
        lines.append(line)

    summary = summarize_results(lines)
    old_summary = reconciliation.get("summary") or {}
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
    summary["handled_difference_lines"] = handled_count
    summary["unresolved_difference_lines"] = unresolved_count

    result["version"] = "contract-match-v4"
    result["lines"] = lines
    result["summary"] = summary
    result["difference_summary"] = {
        "handled_lines": handled_count,
        "unresolved_lines": unresolved_count,
    }
    return result


def _reconcile_data_v4(
    conn: psycopg.Connection,
    bill_type: str,
    bill_id: str,
    actor: str = "system",
) -> dict:
    base = _reconcile_data_v3(conn, bill_type, bill_id)
    cases = _sync_difference_cases(conn, bill_type, bill_id, base, actor)
    return _apply_case_dispositions(base, cases)


def _next_adjustment_no(conn: psycopg.Connection) -> str:
    now = datetime.now(timezone.utc)
    prefix = f"ADJ-{now.strftime('%Y%m')}-"
    conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [f"contract-adjustment:{prefix}"])
    row = conn.execute(
        """
        SELECT adjustment_no
        FROM cf_contract_adjustments
        WHERE adjustment_no LIKE %s
        ORDER BY adjustment_no DESC
        LIMIT 1
        """,
        [f"{prefix}%"],
    ).fetchone()
    seq = 1
    if row:
        try:
            seq = int(str(row["adjustment_no"]).rsplit("-", 1)[-1]) + 1
        except (TypeError, ValueError):
            seq = 1
    return f"{prefix}{seq:03d}"


def _adjustment_direction(case: dict) -> tuple[str, str]:
    bill_type = str(case.get("bill_type") or "")
    variance = str(case.get("variance_direction") or "")
    if bill_type == "channel":
        return ("receivable", "应补收") if variance == "under" else ("refund_or_offset", "应退/冲减")
    return ("payable", "应补付") if variance == "under" else ("recover_or_offset", "应追回/冲减")


def _carry_direction(case: dict) -> str:
    return "next_period_add" if case.get("variance_direction") == "under" else "next_period_deduct"


@app.get("/api/contract-terms/reconcile-v4")
def reconcile_bill_contract_v4(
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


@app.get("/api/contract-terms/difference-cases")
def list_difference_cases(
    request: Request,
    bill_type: str | None = Query(default=None, pattern="^(rd|channel)$"),
    bill_id: str | None = Query(default=None, max_length=128),
    status: str | None = Query(default=None, pattern="^(pending|processing|resolved)$"),
    limit: int = Query(default=200, ge=1, le=1000),
) -> dict:
    _require_permission(request, "contracts.view")
    clauses: list[str] = []
    params: list[Any] = []
    if bill_type:
        clauses.append("bill_type = %s")
        params.append(bill_type)
    if bill_id:
        clauses.append("bill_id = %s")
        params.append(bill_id)
    if status:
        clauses.append("status = %s")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_difference_tables(conn)
        rows = conn.execute(
            f"""
            SELECT *
            FROM cf_contract_difference_cases
            {where}
            ORDER BY
              CASE status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END,
              ABS(difference_amount) DESC,
              updated_at DESC
            LIMIT %s
            """,
            [*params, limit],
        ).fetchall()
        items = [_case_payload(dict(row)) for row in rows]

        summary_row = conn.execute(
            f"""
            SELECT
              COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
              COUNT(*) FILTER (WHERE status = 'processing') AS processing_count,
              COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_count,
              COALESCE(SUM(ABS(difference_amount)) FILTER (
                WHERE status <> 'resolved' AND variance_direction = 'under'
              ), 0) AS under_total,
              COALESCE(SUM(ABS(difference_amount)) FILTER (
                WHERE status <> 'resolved' AND variance_direction = 'over'
              ), 0) AS over_total
            FROM cf_contract_difference_cases
            {where}
            """,
            params,
        ).fetchone()
    under_total = _float(summary_row.get("under_total"))
    over_total = _float(summary_row.get("over_total"))
    return {
        "items": items,
        "total": len(items),
        "summary": {
            "pending_count": int(summary_row.get("pending_count") or 0),
            "processing_count": int(summary_row.get("processing_count") or 0),
            "resolved_count": int(summary_row.get("resolved_count") or 0),
            "under_total": round(under_total, 2),
            "over_total": round(over_total, 2),
            "net_difference": round(under_total - over_total, 2),
        },
    }


@app.get("/api/contract-terms/difference-cases/{case_id}")
def get_difference_case(request: Request, case_id: str) -> dict:
    _require_permission(request, "contracts.view")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_difference_tables(conn)
        case = _case_by_id(conn, case_id)
        events = conn.execute(
            """
            SELECT id, case_id, event_type, title, detail, payload_json, actor, created_at
            FROM cf_contract_difference_events
            WHERE case_id = %s
            ORDER BY created_at, id
            """,
            [case_id],
        ).fetchall()
        adjustments = conn.execute(
            "SELECT * FROM cf_contract_adjustments WHERE case_id = %s ORDER BY created_at DESC",
            [case_id],
        ).fetchall()
        carries = conn.execute(
            "SELECT * FROM cf_contract_carry_forwards WHERE case_id = %s ORDER BY created_at DESC",
            [case_id],
        ).fetchall()
    return {
        **_case_payload(case),
        "events": [
            {
                **{key: value for key, value in dict(row).items() if key != "payload_json"},
                "payload": row.get("payload_json") or {},
            }
            for row in events
        ],
        "adjustments": [_adjustment_payload(dict(row)) for row in adjustments],
        "carry_forwards": [_carry_payload(dict(row)) for row in carries],
    }


@app.post("/api/contract-terms/difference-cases/{case_id}/actions")
def handle_difference_case(request: Request, case_id: str, payload: dict) -> dict:
    actor = _require_permission(request, "contracts.view")
    action = _text(payload.get("action"), 80)
    reason_type = _text(payload.get("reason_type"), 80)
    description = _text(payload.get("description"))
    owner = _text(payload.get("owner"), 200)
    evidence = payload.get("evidence") or []
    if not isinstance(evidence, list):
        raise HTTPException(status_code=422, detail="证据必须是数组")

    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_difference_tables(conn)
        case = _case_by_id(conn, case_id)
        if case.get("status") == "resolved" and action not in {"reopen"}:
            raise HTTPException(status_code=409, detail="该差异已解决，如需继续处理请先重新打开")

        if action == "edit_bill":
            conn.execute(
                """
                UPDATE cf_contract_difference_cases
                SET status = 'processing', handling_type = 'edit_bill',
                    substatus = 'awaiting_bill_edit', owner = %s,
                    description = %s, evidence_json = %s,
                    updated_by = %s, updated_at = NOW(), resolved_at = NULL
                WHERE id = %s
                """,
                [owner, description, Jsonb(jsonable_encoder(evidence)), actor, case_id],
            )
            _event(conn, case_id, "edit_bill", "待修改账单", description or "已选择修改当前账单。", actor)

        elif action == "accept_difference":
            if reason_type not in REASON_TYPES:
                raise HTTPException(status_code=422, detail="请选择有效的接受差异原因")
            if not description:
                raise HTTPException(status_code=422, detail="接受差异必须填写处理说明")
            conn.execute(
                """
                UPDATE cf_contract_difference_cases
                SET status = 'resolved', handling_type = 'accept_difference',
                    substatus = 'accepted', reason_type = %s, description = %s,
                    owner = %s, evidence_json = %s, updated_by = %s,
                    updated_at = NOW(), resolved_at = NOW()
                WHERE id = %s
                """,
                [
                    reason_type,
                    description,
                    owner,
                    Jsonb(jsonable_encoder(evidence)),
                    actor,
                    case_id,
                ],
            )
            _event(
                conn,
                case_id,
                "accepted",
                "已接受差异",
                f"{reason_type}：{description}",
                actor,
                {"evidence": evidence},
            )

        elif action == "create_adjustment":
            adjustment_no = _next_adjustment_no(conn)
            direction, direction_label = _adjustment_direction(case)
            adjustment_id = uuid4().hex
            amount = round(abs(_float(case.get("difference_amount"))), 2)
            conn.execute(
                """
                INSERT INTO cf_contract_adjustments (
                  id, adjustment_no, case_id, source_bill_type, source_bill_id,
                  source_statement_no, partner_name, game_name, settlement_cycle,
                  direction, direction_label, amount, reason, created_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    adjustment_id,
                    adjustment_no,
                    case_id,
                    case.get("bill_type"),
                    case.get("bill_id"),
                    case.get("statement_no") or "",
                    case.get("partner_name") or "",
                    case.get("game_name") or "",
                    case.get("settlement_cycle") or "",
                    direction,
                    direction_label,
                    amount,
                    description or "合同应结与账单实际差异",
                    actor,
                ],
            )
            conn.execute(
                """
                UPDATE cf_contract_difference_cases
                SET status = 'processing', handling_type = 'adjustment',
                    substatus = 'awaiting_adjustment', reason_type = %s,
                    description = %s, owner = %s, evidence_json = %s,
                    updated_by = %s, updated_at = NOW(), resolved_at = NULL
                WHERE id = %s
                """,
                [
                    reason_type,
                    description,
                    owner,
                    Jsonb(jsonable_encoder(evidence)),
                    actor,
                    case_id,
                ],
            )
            _event(
                conn,
                case_id,
                "adjustment_created",
                f"生成补差单 {adjustment_no}",
                f"{direction_label} ¥{amount:.2f}",
                actor,
                {"adjustment_id": adjustment_id, "adjustment_no": adjustment_no},
            )

        elif action == "carry_forward":
            target_month = _text(payload.get("target_month"), 20)
            if not target_month:
                raise HTTPException(status_code=422, detail="请选择目标月份")
            carry_id = uuid4().hex
            amount = round(abs(_float(case.get("difference_amount"))), 2)
            direction = _carry_direction(case)
            conn.execute(
                """
                INSERT INTO cf_contract_carry_forwards (
                  id, case_id, source_bill_type, source_bill_id, source_statement_no,
                  partner_name, game_name, source_month, target_month, direction,
                  amount, note, created_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    carry_id,
                    case_id,
                    case.get("bill_type"),
                    case.get("bill_id"),
                    case.get("statement_no") or "",
                    case.get("partner_name") or "",
                    case.get("game_name") or "",
                    case.get("settlement_cycle") or "",
                    target_month,
                    direction,
                    amount,
                    description,
                    actor,
                ],
            )
            conn.execute(
                """
                UPDATE cf_contract_difference_cases
                SET status = 'processing', handling_type = 'carry_forward',
                    substatus = 'awaiting_carry_forward', reason_type = %s,
                    description = %s, owner = %s, evidence_json = %s,
                    updated_by = %s, updated_at = NOW(), resolved_at = NULL
                WHERE id = %s
                """,
                [
                    reason_type,
                    description,
                    owner,
                    Jsonb(jsonable_encoder(evidence)),
                    actor,
                    case_id,
                ],
            )
            _event(
                conn,
                case_id,
                "carry_forward_created",
                "转下月冲抵",
                f"待冲抵 ¥{amount:.2f}，目标月份 {target_month}。",
                actor,
                {"carry_forward_id": carry_id, "target_month": target_month},
            )

        elif action == "reopen":
            conn.execute(
                """
                UPDATE cf_contract_difference_cases
                SET status = 'pending', handling_type = NULL, substatus = '',
                    resolved_at = NULL, updated_by = %s, updated_at = NOW()
                WHERE id = %s
                """,
                [actor, case_id],
            )
            _event(conn, case_id, "reopened", "重新打开差异", description or "差异重新进入待处理。", actor)

        else:
            raise HTTPException(status_code=422, detail="不支持的差异处置动作")

        conn.commit()
        case = _case_by_id(conn, case_id)
    return _case_payload(case)


@app.post("/api/contract-terms/adjustments/{adjustment_id}/complete")
def complete_adjustment(request: Request, adjustment_id: str, payload: dict) -> dict:
    actor = _require_permission(request, "contracts.view")
    invoice_id = _text(payload.get("invoice_id"), 128)
    bank_transaction_id = _text(payload.get("bank_transaction_id"), 128)
    reconciliation_note = _text(payload.get("reconciliation_note"))
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_difference_tables(conn)
        adjustment = conn.execute(
            "SELECT * FROM cf_contract_adjustments WHERE id = %s",
            [adjustment_id],
        ).fetchone()
        if adjustment is None:
            raise HTTPException(status_code=404, detail="补差单不存在")
        case_id = str(adjustment["case_id"])
        conn.execute(
            """
            UPDATE cf_contract_adjustments
            SET status = 'completed', invoice_id = %s, bank_transaction_id = %s,
                reconciliation_note = %s, updated_at = NOW(), completed_at = NOW()
            WHERE id = %s
            """,
            [invoice_id, bank_transaction_id, reconciliation_note, adjustment_id],
        )
        conn.execute(
            """
            UPDATE cf_contract_difference_cases
            SET status = 'resolved', substatus = 'adjustment_completed',
                updated_by = %s, updated_at = NOW(), resolved_at = NOW()
            WHERE id = %s
            """,
            [actor, case_id],
        )
        _event(
            conn,
            case_id,
            "adjustment_completed",
            "补差完成",
            reconciliation_note or "补差单已完成并关闭原合同差异。",
            actor,
            {"adjustment_id": adjustment_id, "invoice_id": invoice_id, "bank_transaction_id": bank_transaction_id},
        )
        conn.commit()
        updated = conn.execute(
            "SELECT * FROM cf_contract_adjustments WHERE id = %s",
            [adjustment_id],
        ).fetchone()
    return _adjustment_payload(dict(updated))


@app.get("/api/contract-terms/carry-forwards")
def list_carry_forwards(
    request: Request,
    target_month: str | None = Query(default=None, max_length=20),
    partner_name: str | None = Query(default=None, max_length=500),
    game_name: str | None = Query(default=None, max_length=500),
    status: str = Query(default="pending", pattern="^(pending|applied|cancelled|all)$"),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict:
    _require_permission(request, "contracts.view")
    clauses: list[str] = []
    params: list[Any] = []
    if target_month:
        clauses.append("target_month = %s")
        params.append(target_month)
    if partner_name:
        clauses.append("partner_name = %s")
        params.append(partner_name)
    if game_name:
        clauses.append("game_name = %s")
        params.append(game_name)
    if status != "all":
        clauses.append("status = %s")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_difference_tables(conn)
        rows = conn.execute(
            f"""
            SELECT * FROM cf_contract_carry_forwards
            {where}
            ORDER BY target_month, created_at
            LIMIT %s
            """,
            [*params, limit],
        ).fetchall()
    return {"items": [_carry_payload(dict(row)) for row in rows], "total": len(rows)}


@app.post("/api/contract-terms/carry-forwards/{carry_id}/apply")
def apply_carry_forward(request: Request, carry_id: str, payload: dict) -> dict:
    actor = _require_permission(request, "contracts.view")
    target_bill_type = _text(payload.get("target_bill_type"), 20)
    target_bill_id = _text(payload.get("target_bill_id"), 128)
    note = _text(payload.get("note"))
    if target_bill_type not in {"rd", "channel"} or not target_bill_id:
        raise HTTPException(status_code=422, detail="请提供目标账单")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_difference_tables(conn)
        carry = conn.execute(
            "SELECT * FROM cf_contract_carry_forwards WHERE id = %s",
            [carry_id],
        ).fetchone()
        if carry is None:
            raise HTTPException(status_code=404, detail="待冲抵记录不存在")
        if carry.get("status") != "pending":
            raise HTTPException(status_code=409, detail="该冲抵记录已经处理")
        case_id = str(carry["case_id"])
        conn.execute(
            """
            UPDATE cf_contract_carry_forwards
            SET status = 'applied', target_bill_type = %s, target_bill_id = %s,
                note = %s, updated_at = NOW(), applied_at = NOW()
            WHERE id = %s
            """,
            [target_bill_type, target_bill_id, note, carry_id],
        )
        conn.execute(
            """
            UPDATE cf_contract_difference_cases
            SET status = 'resolved', substatus = 'carry_forward_applied',
                updated_by = %s, updated_at = NOW(), resolved_at = NOW()
            WHERE id = %s
            """,
            [actor, case_id],
        )
        _event(
            conn,
            case_id,
            "carry_forward_applied",
            "下月冲抵完成",
            note or f"已带入目标账单 {target_bill_id}。",
            actor,
            {"carry_forward_id": carry_id, "target_bill_type": target_bill_type, "target_bill_id": target_bill_id},
        )
        conn.commit()
        updated = conn.execute(
            "SELECT * FROM cf_contract_carry_forwards WHERE id = %s",
            [carry_id],
        ).fetchone()
    return _carry_payload(dict(updated))
