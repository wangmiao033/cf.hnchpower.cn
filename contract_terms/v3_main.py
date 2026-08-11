"""Contract reconciliation V3: standard settlement amount recomputation.

V2 fixed the identity of the contract evidence. V3 uses that evidence to
recalculate what each bill line would settle to under the contract's structured
numeric terms, while explicitly refusing to guess text-only or unit-price rules.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

try:
    from .v2_1_main import app as _v2_1_app
    from .v2_main import (
        _candidate_rows,
        _database_url,
        _ensure_v2_tables,
        _reconcile_data,
        _require_permission,
        _snapshot_meta,
    )
    from .matcher import summarize_results
    from .settlement_recalculator import (
        DEFAULT_TOLERANCE,
        calculate_contract_standard_amount,
        summarize_contract_amounts,
    )
except ImportError:  # Vercel imports modules from the service root.
    from v2_1_main import app as _v2_1_app
    from v2_main import (
        _candidate_rows,
        _database_url,
        _ensure_v2_tables,
        _reconcile_data,
        _require_permission,
        _snapshot_meta,
    )
    from matcher import summarize_results
    from settlement_recalculator import (
        DEFAULT_TOLERANCE,
        calculate_contract_standard_amount,
        summarize_contract_amounts,
    )


app = FastAPI(
    title="contract-reconciliation-v3",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

# Keep every V2.1 route except snapshot creation, which V3 replaces so the
# immutable confirmation evidence contains the amount recomputation as well.
for route in list(_v2_1_app.router.routes):
    path = getattr(route, "path", "")
    methods = getattr(route, "methods", set()) or set()
    if path == "/api/contract-terms/reconcile-snapshots" and "POST" in methods:
        continue
    app.router.routes.append(route)


def _float(value: Any, fallback: float = 0.0) -> float:
    if value in (None, ""):
        return fallback
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed == parsed else fallback


def _raw_rd_bill(conn: psycopg.Connection, bill_id: str) -> tuple[dict, dict[str, dict]]:
    record = conn.execute(
        """
        SELECT id, channel_fee_rate, game_flow, test_cost, voucher_cost,
               refund_amount, revenue_share_rate, tax_rate, discount_value,
               settlement_amount
        FROM reconciliation_records
        WHERE id = %s
        """,
        [bill_id],
    ).fetchone()
    if record is None:
        raise HTTPException(status_code=404, detail="研发账单不存在")

    rows = conn.execute(
        """
        SELECT id, revenue, discount_rate, coupon_amount, test_fee, extra_fee,
               share_ratio, tax_rate, settlement_amount
        FROM reconciliation_line_items
        WHERE reconciliation_id = %s
        ORDER BY sort_order, created_at, id
        """,
        [bill_id],
    ).fetchall()
    bill = {
        "channel_fee_rate": _float(record.get("channel_fee_rate")),
        "tax_mode": "share",
        "channel_fee_mode": "percent",
        "validation_tolerance": DEFAULT_TOLERANCE,
    }
    if rows:
        return bill, {
            str(row["id"]): {
                "line_id": str(row["id"]),
                "revenue": _float(row.get("revenue")),
                "discount_rate": _float(row.get("discount_rate"), 1.0),
                "coupon_amount": _float(row.get("coupon_amount")),
                "test_fee": _float(row.get("test_fee")),
                "extra_fee": _float(row.get("extra_fee")),
                # reconciliation_records.refund_amount is the compatibility
                # aggregate of line extra_fee, so do not deduct it twice here.
                "header_refund_amount": 0.0,
                "refund_amount": 0.0,
                "other_deductions": _float(row.get("coupon_amount")) + _float(row.get("extra_fee")),
                "share_rate": _float(row.get("share_ratio")),
                "tax_rate": _float(row.get("tax_rate")),
                "settlement_amount": _float(row.get("settlement_amount")),
            }
            for row in rows
        }

    return bill, {
        "legacy": {
            "line_id": "legacy",
            "revenue": _float(record.get("game_flow")),
            "discount_rate": _float(record.get("discount_value"), 1.0),
            "coupon_amount": _float(record.get("voucher_cost")),
            "test_fee": _float(record.get("test_cost")),
            "extra_fee": 0.0,
            "header_refund_amount": _float(record.get("refund_amount")),
            "refund_amount": _float(record.get("refund_amount")),
            "other_deductions": _float(record.get("voucher_cost")) + _float(record.get("refund_amount")),
            "share_rate": _float(record.get("revenue_share_rate")),
            "tax_rate": _float(record.get("tax_rate")),
            "settlement_amount": _float(record.get("settlement_amount")),
        }
    }


def _raw_channel_bill(conn: psycopg.Connection, bill_id: str) -> tuple[dict, dict[str, dict]]:
    record = conn.execute(
        """
        SELECT id, channel_fee_rate, channel_fee_mode, tax_mode,
               validation_tolerance, billing_flow, voucher_cost, no_worry_cost,
               refund_cost, test_cost, welfare_cost, coin_cost, share_rate,
               tax_rate, gateway_cost, settlement_amount
        FROM channel_records
        WHERE id = %s
        """,
        [bill_id],
    ).fetchone()
    if record is None:
        raise HTTPException(status_code=404, detail="渠道账单不存在")

    rows = conn.execute(
        """
        SELECT id, billing_flow, discount_factor, voucher_cost, no_worry_cost,
               refund_cost, test_cost, welfare_cost, coin_cost, share_rate,
               tax_rate, gateway_cost, settlement_amount
        FROM channel_record_line_items
        WHERE channel_record_id = %s
        ORDER BY sort_order, created_at, id
        """,
        [bill_id],
    ).fetchall()
    bill = {
        "channel_fee_rate": _float(record.get("channel_fee_rate")),
        "channel_fee_mode": str(record.get("channel_fee_mode") or "fixed"),
        "tax_mode": str(record.get("tax_mode") or "share"),
        "validation_tolerance": max(0.0, _float(record.get("validation_tolerance"), DEFAULT_TOLERANCE)),
    }
    if rows:
        return bill, {
            str(row["id"]): {
                "line_id": str(row["id"]),
                "billing_flow": _float(row.get("billing_flow")),
                "discount_factor": _float(row.get("discount_factor"), 1.0),
                "voucher_cost": _float(row.get("voucher_cost")),
                "no_worry_cost": _float(row.get("no_worry_cost")),
                "refund_amount": _float(row.get("refund_cost")),
                "test_fee": _float(row.get("test_cost")),
                "welfare_cost": _float(row.get("welfare_cost")),
                "coin_cost": _float(row.get("coin_cost")),
                "other_deductions": (
                    _float(row.get("voucher_cost"))
                    + _float(row.get("no_worry_cost"))
                    + _float(row.get("welfare_cost"))
                    + _float(row.get("coin_cost"))
                ),
                "share_rate": _float(row.get("share_rate")),
                "tax_rate": _float(row.get("tax_rate")),
                "gateway_cost": _float(row.get("gateway_cost")),
                "settlement_amount": _float(row.get("settlement_amount")),
            }
            for row in rows
        }

    return bill, {
        "legacy": {
            "line_id": "legacy",
            # Header billing_flow is already the compatibility aggregate. Legacy
            # rows have no separate discount factor, so use 1.
            "billing_flow": _float(record.get("billing_flow")),
            "discount_factor": 1.0,
            "voucher_cost": _float(record.get("voucher_cost")),
            "no_worry_cost": _float(record.get("no_worry_cost")),
            "refund_amount": _float(record.get("refund_cost")),
            "test_fee": _float(record.get("test_cost")),
            "welfare_cost": _float(record.get("welfare_cost")),
            "coin_cost": _float(record.get("coin_cost")),
            "other_deductions": (
                _float(record.get("voucher_cost"))
                + _float(record.get("no_worry_cost"))
                + _float(record.get("welfare_cost"))
                + _float(record.get("coin_cost"))
            ),
            "share_rate": _float(record.get("share_rate")),
            "tax_rate": _float(record.get("tax_rate")),
            "gateway_cost": _float(record.get("gateway_cost")),
            "settlement_amount": _float(record.get("settlement_amount")),
        }
    }


def _raw_bill(conn: psycopg.Connection, bill_type: str, bill_id: str) -> tuple[dict, dict[str, dict]]:
    if bill_type == "rd":
        return _raw_rd_bill(conn, bill_id)
    if bill_type == "channel":
        return _raw_channel_bill(conn, bill_id)
    raise HTTPException(status_code=422, detail="不支持的账单类型")


def _identity_reliable(line_result: dict) -> bool:
    if line_result.get("binding"):
        return True
    match = line_result.get("match") or {}
    if match.get("confidence") != "high" or _float(match.get("score")) < 82:
        return False
    access_item_id = str(match.get("access_item_id") or "")
    alternatives = [
        item
        for item in (line_result.get("candidates") or [])
        if item.get("eligible") and str(item.get("access_item_id") or "") != access_item_id
    ]
    if not alternatives:
        return True
    return _float(match.get("score")) - _float(alternatives[0].get("score")) >= 8


def _amount_message(amount: dict) -> str:
    expected = amount.get("expected_amount")
    actual = amount.get("actual_amount")
    difference = amount.get("variance_abs")
    if amount.get("status") == "pass":
        return f"按合同数字条款应结算 ¥{expected:.2f}，账单实际 ¥{actual:.2f}，金额一致。"
    if amount.get("status") == "fail":
        direction = "少结" if amount.get("variance_direction") == "under" else "多结"
        return f"按合同数字条款应结算 ¥{expected:.2f}，账单实际 ¥{actual:.2f}，{direction} ¥{difference:.2f}。"
    return str(amount.get("message") or "合同标准结算金额需要人工复核。")


def _amount_check(amount: dict) -> dict:
    status = amount.get("status")
    return {
        "key": "contract_standard_settlement",
        "label": "合同标准结算额",
        "status": status if status in {"pass", "fail"} else "manual",
        "bill_value": amount.get("actual_amount"),
        "contract_value": amount.get("expected_amount"),
        "difference": amount.get("difference_amount"),
        "message": _amount_message(amount),
    }


def _apply_amount_recalculation(
    bill_type: str,
    base: dict,
    raw_bill: dict,
    raw_lines: dict[str, dict],
    candidates: list[dict],
) -> dict:
    candidate_by_id = {
        str(candidate.get("access_item_id")): candidate
        for candidate in candidates
        if candidate.get("access_item_id")
    }
    tolerance = max(0.0, _float(raw_bill.get("validation_tolerance"), DEFAULT_TOLERANCE))
    lines: list[dict] = []
    for source in base.get("lines") or []:
        line = dict(source)
        line_id = str(line.get("line_id") or "legacy")
        raw_line = raw_lines.get(line_id)
        match = line.get("match") or {}
        candidate = candidate_by_id.get(str(match.get("access_item_id") or ""))
        if raw_line is None or candidate is None:
            contract_amount = {
                "status": "manual",
                "supported": False,
                "deterministic": False,
                "actual_amount": _float(raw_line.get("settlement_amount")) if raw_line else None,
                "expected_amount": None,
                "difference_amount": None,
                "variance_abs": None,
                "variance_direction": "unknown",
                "tolerance": tolerance,
                "formula_code": "",
                "formula_label": "",
                "breakdown": {},
                "assumptions": [],
                "message": "尚未确定可用于重算的合同合作清单。" if candidate is None else "账单明细原始数据不足，暂不能重算。",
            }
        else:
            contract_amount = calculate_contract_standard_amount(
                bill_type,
                {**base.get("bill", {}), **raw_bill},
                raw_line,
                candidate,
                tolerance=tolerance,
            )
            if contract_amount.get("expected_amount") is not None and contract_amount.get("deterministic") and not _identity_reliable(line):
                contract_amount = dict(contract_amount)
                contract_amount["status"] = "manual"
                contract_amount["deterministic"] = False
                assumptions = list(contract_amount.get("assumptions") or [])
                assumptions.append("合同身份尚未锁定且自动匹配不足以作为阻断依据")
                contract_amount["assumptions"] = assumptions
                contract_amount["message"] = "已生成参考重算金额，但合同身份尚未锁定/匹配仍有歧义，暂不作为自动阻断依据。"

        line["contract_amount"] = contract_amount
        checks = list(line.get("checks") or [])
        checks.append(_amount_check(contract_amount))
        line["checks"] = checks
        if contract_amount.get("status") == "fail":
            line["status"] = "fail"
            line["message"] = _amount_message(contract_amount)
        elif contract_amount.get("status") == "manual" and line.get("status") == "pass":
            line["status"] = "warning"
            line["message"] = "合同字段核验通过，但标准结算金额仍需人工复核。"
        lines.append(line)

    summary = summarize_results(lines)
    bill_checks = list(base.get("bill_checks") or [])
    if bill_checks:
        summary["warning_count"] += len(bill_checks)
        summary["issue_count"] += len(bill_checks)
        summary["overall_status"] = "warning" if summary["overall_status"] == "pass" else summary["overall_status"]
        summary["can_auto_confirm"] = False

    old_summary = base.get("summary") or {}
    for key in ("binding_count", "manual_binding_count", "auto_binding_count"):
        summary[key] = int(old_summary.get(key) or 0)
    amount_summary = summarize_contract_amounts(lines)
    summary["amount_status"] = amount_summary.get("status")
    summary["amount_comparable_lines"] = amount_summary.get("comparable_lines")
    summary["amount_deterministic_lines"] = amount_summary.get("deterministic_lines")
    summary["amount_expected"] = amount_summary.get("expected_amount")
    summary["amount_actual"] = amount_summary.get("actual_amount")
    summary["amount_difference"] = amount_summary.get("difference_amount")

    return {
        **base,
        "version": "contract-match-v3",
        "summary": summary,
        "lines": lines,
        "amount_summary": amount_summary,
    }


def _reconcile_data_v3(conn: psycopg.Connection, bill_type: str, bill_id: str) -> dict:
    base = _reconcile_data(conn, bill_type, bill_id)
    raw_bill, raw_lines = _raw_bill(conn, bill_type, bill_id)
    candidates = _candidate_rows(conn)
    return _apply_amount_recalculation(bill_type, base, raw_bill, raw_lines, candidates)


@app.get("/api/contract-terms/reconcile-v3")
def reconcile_bill_contract_v3(
    request: Request,
    bill_type: str = Query(..., pattern="^(rd|channel)$"),
    bill_id: str = Query(..., min_length=1, max_length=128),
) -> dict:
    _require_permission(request, "contracts.view")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        result = _reconcile_data_v3(conn, bill_type, bill_id)
        conn.commit()
    return result


@app.post("/api/contract-terms/reconcile-snapshots")
def create_reconciliation_snapshot_v3(request: Request, payload: dict) -> dict:
    actor = _require_permission(request, "contracts.view")
    bill_type = str(payload.get("bill_type") or "").strip()
    bill_id = str(payload.get("bill_id") or "").strip()[:128]
    event_type = str(payload.get("event_type") or "confirmed").strip()[:80] or "confirmed"
    if bill_type not in {"rd", "channel"} or not bill_id:
        raise HTTPException(status_code=422, detail="账单类型或账单 ID 无效")

    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_v2_tables(conn)
        result = _reconcile_data_v3(conn, bill_type, bill_id)
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
