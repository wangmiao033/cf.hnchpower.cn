"""Contract terms service with bill-to-contract reconciliation preflight."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from psycopg.rows import dict_row

try:
    from .main import app as _base_app, _database_url, _require_permission, _require_table
    from .matcher import evaluate_line, summarize_results
    from .channel_rule_recommender import recommend_channel_rules
except ImportError:  # Vercel loads service modules from the service root.
    from main import app as _base_app, _database_url, _require_permission, _require_table
    from matcher import evaluate_line, summarize_results
    from channel_rule_recommender import recommend_channel_rules

app = FastAPI(
    title="contract-terms-reconciliation",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.router.routes.extend(list(_base_app.router.routes))


def _float(value: Any) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed == parsed else 0.0


def _rd_bill(conn: psycopg.Connection, bill_id: str) -> tuple[dict, list[dict]]:
    record = conn.execute(
        """
        SELECT id, statement_no, settlement_month, partner_name, game_name,
               game_flow, test_cost, voucher_cost, channel_fee_rate, tax_rate,
               revenue_share_rate, refund_amount, settlement_amount, remark
        FROM reconciliation_records
        WHERE id = %s
        """,
        [bill_id],
    ).fetchone()
    if record is None:
        raise HTTPException(status_code=404, detail="研发账单不存在")

    rows = conn.execute(
        """
        SELECT id, settlement_cycle, game_name, revenue, coupon_amount, test_fee,
               extra_fee, share_ratio, tax_rate, settlement_amount, sort_order
        FROM reconciliation_line_items
        WHERE reconciliation_id = %s
        ORDER BY sort_order, created_at, id
        """,
        [bill_id],
    ).fetchall()

    bill = {
        "bill_type": "rd",
        "bill_id": str(record["id"]),
        "statement_no": record.get("statement_no") or "",
        "settlement_month": record.get("settlement_month") or "",
        "partner_name": record.get("partner_name") or "",
        "channel_name": "",
        "channel_fee_rate": _float(record.get("channel_fee_rate")),
        "server_cost": 0,
        "unallocated_refund_amount": 0,
        "remark": record.get("remark") or "",
    }

    if rows:
        line_items = [
            {
                "line_id": str(row["id"]),
                "settlement_cycle": row.get("settlement_cycle") or record.get("settlement_month") or "",
                "game_name": row.get("game_name") or record.get("game_name") or "",
                "share_rate": _float(row.get("share_ratio")),
                "tax_rate": _float(row.get("tax_rate")),
                "test_fee": _float(row.get("test_fee")),
                "refund_amount": 0,
                "other_deductions": _float(row.get("coupon_amount")) + _float(row.get("extra_fee")),
                "settlement_amount": _float(row.get("settlement_amount")),
                "is_first_line": index == 0,
            }
            for index, row in enumerate(rows)
        ]
        if len(line_items) == 1:
            line_items[0]["refund_amount"] = _float(record.get("refund_amount"))
        else:
            bill["unallocated_refund_amount"] = _float(record.get("refund_amount"))
        return bill, line_items

    return bill, [
        {
            "line_id": "legacy",
            "settlement_cycle": record.get("settlement_month") or "",
            "game_name": record.get("game_name") or "",
            "share_rate": _float(record.get("revenue_share_rate")),
            "tax_rate": _float(record.get("tax_rate")),
            "test_fee": _float(record.get("test_cost")),
            "refund_amount": _float(record.get("refund_amount")),
            "other_deductions": _float(record.get("voucher_cost")),
            "settlement_amount": _float(record.get("settlement_amount")),
            "is_first_line": True,
        }
    ]


def _channel_bill(conn: psycopg.Connection, bill_id: str) -> tuple[dict, list[dict]]:
    record = conn.execute(
        """
        SELECT id, statement_no, channel_name, partner_name, game_name,
               settlement_month, billing_flow, voucher_cost, no_worry_cost,
               refund_cost, test_cost, welfare_cost, share_rate, tax_rate,
               gateway_cost, settlement_amount, server_cost, channel_fee_rate, remark
        FROM channel_records
        WHERE id = %s
        """,
        [bill_id],
    ).fetchone()
    if record is None:
        raise HTTPException(status_code=404, detail="渠道账单不存在")

    rows = conn.execute(
        """
        SELECT id, settlement_cycle, game_name, voucher_cost, no_worry_cost,
               refund_cost, test_cost, welfare_cost, share_rate, tax_rate,
               gateway_cost, settlement_amount, sort_order
        FROM channel_record_line_items
        WHERE channel_record_id = %s
        ORDER BY sort_order, created_at, id
        """,
        [bill_id],
    ).fetchall()

    bill = {
        "bill_type": "channel",
        "bill_id": str(record["id"]),
        "statement_no": record.get("statement_no") or "",
        "settlement_month": record.get("settlement_month") or "",
        "partner_name": record.get("partner_name") or record.get("channel_name") or "",
        "channel_name": record.get("channel_name") or "",
        "channel_fee_rate": (
            _float(record.get("channel_fee_rate"))
            if record.get("channel_fee_rate") is not None
            else None
        ),
        "server_cost": _float(record.get("server_cost")),
        "unallocated_refund_amount": 0,
        "remark": record.get("remark") or "",
    }

    if rows:
        return bill, [
            {
                "line_id": str(row["id"]),
                "settlement_cycle": row.get("settlement_cycle") or record.get("settlement_month") or "",
                "game_name": row.get("game_name") or record.get("game_name") or "",
                "share_rate": _float(row.get("share_rate")),
                "tax_rate": _float(row.get("tax_rate")),
                "test_fee": _float(row.get("test_cost")),
                "refund_amount": _float(row.get("refund_cost")),
                "other_deductions": (
                    _float(row.get("voucher_cost"))
                    + _float(row.get("no_worry_cost"))
                    + _float(row.get("welfare_cost"))
                ),
                "gateway_cost": _float(row.get("gateway_cost")),
                "settlement_amount": _float(row.get("settlement_amount")),
                "is_first_line": index == 0,
            }
            for index, row in enumerate(rows)
        ]

    return bill, [
        {
            "line_id": "legacy",
            "settlement_cycle": record.get("settlement_month") or "",
            "game_name": record.get("game_name") or "",
            "share_rate": _float(record.get("share_rate")),
            "tax_rate": _float(record.get("tax_rate")),
            "test_fee": _float(record.get("test_cost")),
            "refund_amount": _float(record.get("refund_cost")),
            "other_deductions": (
                _float(record.get("voucher_cost"))
                + _float(record.get("no_worry_cost"))
                + _float(record.get("welfare_cost"))
            ),
            "gateway_cost": _float(record.get("gateway_cost")),
            "settlement_amount": _float(record.get("settlement_amount")),
            "is_first_line": True,
        }
    ]


_CANDIDATE_SQL = """
    SELECT
      access.id AS access_item_id,
      access.contract_id,
      access.channel_name,
      access.product_name,
      access.authorization_start,
      access.authorization_end,
      access.share_rate,
      access.channel_fee_rate,
      access.status AS access_status,
      contract.contract_name,
      contract.contract_no,
      contract.counterparty,
      contract.effective_date,
      contract.end_date,
      contract.performance_status,
      partner.name AS partner_name,
      partner.short_name AS partner_short_name,
      terms.settlement_mode,
      terms.settlement_basis,
      terms.commercial_variant,
      terms.unit_price,
      terms.currency,
      terms.settlement_cycle,
      terms.payment_terms,
      terms.invoice_tax_rate,
      terms.invoice_type,
      terms.refund_rule,
      terms.testing_fee,
      terms.server_cost_bearer,
      terms.prepayment_amount,
      terms.minimum_guarantee_amount,
      terms.deduction_rule
    FROM cf_contract_access_items AS access
    JOIN cf_contract_records AS contract ON contract.id = access.contract_id
    LEFT JOIN cf_partner_records AS partner ON partner.id = contract.partner_id
    LEFT JOIN cf_contract_access_terms AS terms ON terms.access_item_id = access.id
    ORDER BY contract.updated_at DESC, access.updated_at DESC
"""


def _candidate_rows(conn: psycopg.Connection) -> list[dict]:
    """Read contract candidates without runtime DDL and retry transient deadlocks."""
    for attempt in range(3):
        try:
            _require_table(conn)
            rows = conn.execute(_CANDIDATE_SQL).fetchall()
            return [dict(row) for row in rows]
        except psycopg.errors.DeadlockDetected as exc:
            conn.rollback()
            if attempt >= 2:
                raise HTTPException(
                    status_code=503,
                    detail={
                        "error": "contract_service_busy",
                        "message": "合同服务正在处理并发数据库操作，请稍后重试。",
                        "retryable": True,
                    },
                ) from exc
            time.sleep(0.08 * (attempt + 1))
    return []


def _bill_level_checks(bill: dict, line_results: list[dict]) -> list[dict]:
    checks: list[dict] = []
    refund_amount = round(_float(bill.get("unallocated_refund_amount")), 2)
    if refund_amount > 0.01:
        matched_rules = [
            str(check.get("contract_value") or "").strip()
            for result in line_results
            for check in result.get("checks") or []
            if check.get("key") == "refund_rule" and check.get("contract_value")
        ]
        checks.append(
            {
                "key": "unallocated_refund",
                "label": "账单级退款",
                "status": "manual",
                "bill_value": refund_amount,
                "contract_value": matched_rules[0] if matched_rules else None,
                "difference": None,
                "message": "研发账单存在未分摊到具体游戏明细的退款金额，需人工确认归属后再按合同退款规则核验。",
            }
        )
    return checks


@app.post("/api/contract-terms/channel-rule-recommendation")
def recommend_channel_rule(request: Request, payload: dict) -> dict:
    _require_permission(request, "contracts.view")
    partner_name = str(payload.get("partner_name") or "").strip()
    channel_name = str(payload.get("channel_name") or "").strip()
    lines = payload.get("lines") if isinstance(payload.get("lines"), list) else []
    if not partner_name:
        raise HTTPException(status_code=422, detail="请先选择合作方，再自动匹配合同规则")
    if not lines:
        raise HTTPException(status_code=422, detail="请至少填写一条游戏明细")

    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        candidates = _candidate_rows(conn)
        result = recommend_channel_rules(partner_name, channel_name, lines, candidates)
    return {**result, "generated_at": datetime.now(timezone.utc).isoformat()}


@app.get("/api/contract-terms/reconcile")
def reconcile_bill_contract(
    request: Request,
    bill_type: str = Query(..., pattern="^(rd|channel)$"),
    bill_id: str = Query(..., min_length=1, max_length=128),
) -> dict:
    _require_permission(request, "contracts.view")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        bill, lines = _rd_bill(conn, bill_id) if bill_type == "rd" else _channel_bill(conn, bill_id)
        candidates = _candidate_rows(conn)
        results = [evaluate_line(bill, line, candidates) for line in lines]
        bill_checks = _bill_level_checks(bill, results)
        summary = summarize_results(results)
        if bill_checks:
            summary["warning_count"] += len(bill_checks)
            summary["issue_count"] += len(bill_checks)
            summary["overall_status"] = "warning" if summary["overall_status"] == "pass" else summary["overall_status"]
            summary["can_auto_confirm"] = False

    return {
        "version": "contract-match-v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "bill": bill,
        "summary": summary,
        "lines": results,
        "bill_checks": bill_checks,
    }
