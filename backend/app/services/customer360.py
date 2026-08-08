"""V2.5-3 customer 360 read-only business aggregation."""

from __future__ import annotations

from datetime import date, datetime
import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.rd_bank_payment_aggregate import (
    aggregate_rd_payments_for_ids,
    fill_payable_for_row,
)

_ALLOWED_TABLES = {
    "cf_partner_records",
    "cf_contract_records",
    "cf_contract_internal_numbers",
    "cf_contract_access_items",
    "cf_reconciliation_partner_links",
    "reconciliation_records",
    "reconciliation_line_items",
    "channel_records",
    "channel_record_line_items",
    "invoice_records",
    "bank_transactions",
}


def _name_key(value: object) -> str:
    return re.sub(
        r"\s+",
        "",
        str(value or "")
        .strip()
        .lower()
        .replace("（", "(")
        .replace("）", ")"),
    )


def _money(value: object) -> float:
    if value in (None, ""):
        return 0.0
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if number != number:
        return 0.0
    return round(number, 2)


def _iso(value: object) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _table_exists(db: Session, table_name: str) -> bool:
    if table_name not in _ALLOWED_TABLES:
        return False
    return bool(
        db.execute(text(f"SELECT to_regclass('public.{table_name}')")).scalar_one_or_none()
    )


def _normalized_sql(column: str) -> str:
    return (
        "LOWER(REPLACE(REPLACE(REGEXP_REPLACE("
        f"BTRIM(COALESCE({column}, '')), '[[:space:]]+', '', 'g'), "
        "'（', '('), '）', ')'))"
    )


def _exact_match_clause(columns: list[str], keys: list[str]) -> tuple[str, dict[str, str]]:
    clean_keys = list(dict.fromkeys(key for key in keys if key))
    if not clean_keys:
        return "FALSE", {}
    clauses: list[str] = []
    params: dict[str, str] = {}
    for index, key in enumerate(clean_keys):
        param = f"customer_name_key_{index}"
        params[param] = key
        clauses.extend(f"{_normalized_sql(column)} = :{param}" for column in columns)
    return f"({' OR '.join(clauses)})", params


def _section_access(permissions: set[str]) -> dict[str, bool]:
    return {
        "contracts": "contracts.view" in permissions,
        "reconciliation": "reconciliation.view" in permissions,
        "invoices": "invoices.view" in permissions,
        "funds": "funds.view" in permissions,
    }


def _load_partner(db: Session, partner_id: str) -> dict[str, Any] | None:
    if not _table_exists(db, "cf_partner_records"):
        return None
    row = (
        db.execute(
            text(
                """
                SELECT
                  id, name, short_name, category, tag, tax_registration_no,
                  bank_name, bank_account, invoice_content, recipient,
                  recipient_phone, mailing_address, created_at, updated_at
                FROM cf_partner_records
                WHERE id = :partner_id
                """
            ),
            {"partner_id": partner_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        return None
    return {
        "id": str(row["id"]),
        "name": str(row.get("name") or ""),
        "short_name": str(row.get("short_name") or ""),
        "category": str(row.get("category") or ""),
        "tag": str(row.get("tag") or ""),
        "tax_registration_no": str(row.get("tax_registration_no") or ""),
        "bank_name": str(row.get("bank_name") or ""),
        "bank_account": str(row.get("bank_account") or ""),
        "invoice_content": str(row.get("invoice_content") or ""),
        "recipient": str(row.get("recipient") or ""),
        "recipient_phone": str(row.get("recipient_phone") or ""),
        "mailing_address": str(row.get("mailing_address") or ""),
        "created_at": _iso(row.get("created_at")),
        "updated_at": _iso(row.get("updated_at")),
    }


def _partner_match_keys(db: Session, partner: dict[str, Any]) -> list[str]:
    """Use the legal name and only a globally unique short name for legacy exact matching."""
    full_key = _name_key(partner.get("name"))
    short_key = _name_key(partner.get("short_name"))
    keys = [full_key] if full_key else []
    if not short_key or short_key == full_key:
        return keys

    rows = (
        db.execute(
            text(
                """
                SELECT id, short_name
                FROM cf_partner_records
                WHERE short_name <> ''
                """
            )
        )
        .mappings()
        .all()
    )
    matches = [row for row in rows if _name_key(row.get("short_name")) == short_key]
    if len(matches) == 1 and str(matches[0]["id"]) == str(partner["id"]):
        keys.append(short_key)
    return keys


def _contract_state(row: dict[str, Any]) -> str:
    status = str(row.get("performance_status") or "").strip()
    lowered = status.lower()
    if any(token in status for token in ("终止", "解除", "结束", "完成", "过期")):
        return "ended"
    end_date = row.get("end_date")
    if end_date and str(end_date) < date.today().isoformat():
        return "expired"
    effective_date = row.get("effective_date")
    if effective_date and str(effective_date) > date.today().isoformat():
        return "pending"
    if lowered in {"cancelled", "canceled", "expired", "completed"}:
        return "ended"
    return "active"


def _load_contracts(db: Session, partner_id: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not _table_exists(db, "cf_contract_records"):
        return [], {"count": 0, "active_count": 0, "amount": 0.0}

    internal_join = ""
    internal_select = "'' AS internal_contract_no"
    if _table_exists(db, "cf_contract_internal_numbers"):
        internal_join = (
            "LEFT JOIN cf_contract_internal_numbers AS number "
            "ON number.contract_id = contract.id"
        )
        internal_select = "COALESCE(number.internal_contract_no, '') AS internal_contract_no"

    rows = (
        db.execute(
            text(
                f"""
                SELECT
                  contract.id,
                  contract.contract_name,
                  contract.contract_type,
                  contract.contract_no,
                  contract.amount,
                  contract.effective_date,
                  contract.end_date,
                  contract.performance_status,
                  contract.payment_type,
                  contract.created_at,
                  contract.updated_at,
                  {internal_select}
                FROM cf_contract_records AS contract
                {internal_join}
                WHERE contract.partner_id = :partner_id
                ORDER BY contract.updated_at DESC NULLS LAST, contract.created_at DESC
                LIMIT 50
                """
            ),
            {"partner_id": partner_id},
        )
        .mappings()
        .all()
    )

    access_by_contract: dict[str, dict[str, list[str]]] = {}
    contract_ids = [str(row["id"]) for row in rows]
    if contract_ids and _table_exists(db, "cf_contract_access_items"):
        access_rows = (
            db.execute(
                text(
                    """
                    SELECT contract_id, product_name, channel_name
                    FROM cf_contract_access_items
                    WHERE contract_id = ANY(:contract_ids)
                    ORDER BY created_at
                    """
                ),
                {"contract_ids": contract_ids},
            )
            .mappings()
            .all()
        )
        for access in access_rows:
            bucket = access_by_contract.setdefault(
                str(access["contract_id"]), {"products": [], "channels": []}
            )
            product = str(access.get("product_name") or "").strip()
            channel = str(access.get("channel_name") or "").strip()
            if product and product not in bucket["products"]:
                bucket["products"].append(product)
            if channel and channel not in bucket["channels"]:
                bucket["channels"].append(channel)

    items: list[dict[str, Any]] = []
    for row in rows:
        related = access_by_contract.get(str(row["id"]), {"products": [], "channels": []})
        items.append(
            {
                "id": str(row["id"]),
                "internal_contract_no": str(row.get("internal_contract_no") or ""),
                "contract_no": str(row.get("contract_no") or ""),
                "contract_name": str(row.get("contract_name") or ""),
                "contract_type": str(row.get("contract_type") or ""),
                "products": related["products"],
                "channels": related["channels"],
                "amount": _money(row.get("amount")),
                "effective_date": _iso(row.get("effective_date")),
                "end_date": _iso(row.get("end_date")),
                "performance_status": str(row.get("performance_status") or ""),
                "payment_type": str(row.get("payment_type") or ""),
                "state": _contract_state(dict(row)),
                "created_at": _iso(row.get("created_at")),
                "updated_at": _iso(row.get("updated_at")),
            }
        )

    summary_row = (
        db.execute(
            text(
                """
                SELECT
                  COUNT(*) AS count,
                  COALESCE(SUM(amount), 0) AS amount,
                  COUNT(*) FILTER (
                    WHERE (end_date IS NULL OR end_date >= CURRENT_DATE)
                      AND COALESCE(performance_status, '') NOT IN (
                        '已终止', '已结束', '已完成', '已过期', '解除'
                      )
                  ) AS active_count
                FROM cf_contract_records
                WHERE partner_id = :partner_id
                """
            ),
            {"partner_id": partner_id},
        )
        .mappings()
        .first()
    )
    summary = {
        "count": int(summary_row.get("count") or 0) if summary_row else 0,
        "active_count": int(summary_row.get("active_count") or 0) if summary_row else 0,
        "amount": _money(summary_row.get("amount")) if summary_row else 0.0,
    }
    return items, summary


def _rd_match_context(
    db: Session, partner_id: str, keys: list[str]
) -> tuple[str, dict[str, Any], str]:
    fallback, params = _exact_match_clause(["bill.partner_name"], keys)
    params["partner_id"] = partner_id
    if _table_exists(db, "cf_reconciliation_partner_links"):
        join = (
            "LEFT JOIN cf_reconciliation_partner_links AS customer_link "
            "ON customer_link.reconciliation_id = bill.id"
        )
        where = (
            f"(customer_link.partner_id = :partner_id OR "
            f"(customer_link.partner_id IS NULL AND {fallback}))"
        )
        return where, params, join
    return fallback, params, ""


def _load_rd_bills(
    db: Session, partner_id: str, keys: list[str]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not _table_exists(db, "reconciliation_records"):
        return [], {"count": 0, "settlement": 0.0, "paid": 0.0, "unpaid": 0.0}

    where, params, link_join = _rd_match_context(db, partner_id, keys)
    base_rows = (
        db.execute(
            text(
                f"""
                SELECT bill.id, bill.settlement_amount
                FROM reconciliation_records AS bill
                {link_join}
                WHERE {where}
                """
            ),
            params,
        )
        .mappings()
        .all()
    )
    ids = [str(row["id"]) for row in base_rows]
    try:
        payment_map = aggregate_rd_payments_for_ids(db, ids) if ids else {}
    except Exception:
        payment_map = {}

    payment_by_id: dict[str, dict[str, Any]] = {}
    total_paid = 0.0
    total_unpaid = 0.0
    for row in base_rows:
        pay = fill_payable_for_row(payment_map.get(str(row["id"])), row.get("settlement_amount"))
        data = {
            "paid_amount": _money(pay.paid_amount),
            "unpaid_amount": _money(pay.unpaid_amount),
            "payment_status": str(pay.payment_status or ""),
            "latest_payment_date": pay.latest_payment_date,
        }
        payment_by_id[str(row["id"])] = data
        total_paid += data["paid_amount"]
        total_unpaid += data["unpaid_amount"]

    line_join = ""
    line_select = "'' AS line_games"
    if _table_exists(db, "reconciliation_line_items"):
        line_join = (
            "LEFT JOIN reconciliation_line_items AS line "
            "ON line.reconciliation_id = bill.id"
        )
        line_select = (
            "COALESCE(string_agg(DISTINCT NULLIF(line.game_name, ''), ' / '), '') AS line_games"
        )

    rows = (
        db.execute(
            text(
                f"""
                SELECT
                  bill.id,
                  bill.statement_no,
                  bill.settlement_month,
                  bill.partner_name,
                  bill.game_name,
                  bill.settlement_amount,
                  bill.status,
                  bill.created_at,
                  bill.updated_at,
                  {line_select}
                FROM reconciliation_records AS bill
                {link_join}
                {line_join}
                WHERE {where}
                GROUP BY bill.id
                ORDER BY bill.updated_at DESC NULLS LAST, bill.created_at DESC
                LIMIT 50
                """
            ),
            params,
        )
        .mappings()
        .all()
    )
    items: list[dict[str, Any]] = []
    for row in rows:
        payment = payment_by_id.get(
            str(row["id"]),
            {"paid_amount": 0.0, "unpaid_amount": _money(row.get("settlement_amount")), "payment_status": "", "latest_payment_date": None},
        )
        games = str(row.get("line_games") or row.get("game_name") or "")
        items.append(
            {
                "id": str(row["id"]),
                "statement_no": str(row.get("statement_no") or ""),
                "settlement_month": str(row.get("settlement_month") or ""),
                "games": games,
                "settlement_amount": _money(row.get("settlement_amount")),
                "paid_amount": payment["paid_amount"],
                "unpaid_amount": payment["unpaid_amount"],
                "payment_status": payment["payment_status"],
                "latest_payment_date": payment["latest_payment_date"],
                "status": str(row.get("status") or ""),
                "created_at": _iso(row.get("created_at")),
                "updated_at": _iso(row.get("updated_at")),
            }
        )
    return items, {
        "count": len(base_rows),
        "settlement": round(sum(_money(row.get("settlement_amount")) for row in base_rows), 2),
        "paid": round(total_paid, 2),
        "unpaid": round(total_unpaid, 2),
    }


def _load_channel_bills(
    db: Session, keys: list[str]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not _table_exists(db, "channel_records"):
        return [], {"count": 0, "settlement": 0.0, "received": 0.0, "unreceived": 0.0}
    where, params = _exact_match_clause(["bill.partner_name", "bill.channel_name"], keys)

    summary_row = (
        db.execute(
            text(
                f"""
                SELECT
                  COUNT(*) AS count,
                  COALESCE(SUM(settlement_amount), 0) AS settlement,
                  COALESCE(SUM(received_amount), 0) AS received
                FROM channel_records AS bill
                WHERE {where}
                """
            ),
            params,
        )
        .mappings()
        .first()
    )

    line_join = ""
    line_select = "'' AS line_games"
    if _table_exists(db, "channel_record_line_items"):
        line_join = (
            "LEFT JOIN channel_record_line_items AS line "
            "ON line.channel_record_id = bill.id"
        )
        line_select = (
            "COALESCE(string_agg(DISTINCT NULLIF(line.game_name, ''), ' / '), '') AS line_games"
        )
    rows = (
        db.execute(
            text(
                f"""
                SELECT
                  bill.id,
                  bill.statement_no,
                  bill.settlement_month,
                  bill.partner_name,
                  bill.channel_name,
                  bill.game_name,
                  bill.settlement_amount,
                  bill.received_amount,
                  bill.receipt_status,
                  bill.status,
                  bill.created_at,
                  bill.updated_at,
                  {line_select}
                FROM channel_records AS bill
                {line_join}
                WHERE {where}
                GROUP BY bill.id
                ORDER BY bill.updated_at DESC NULLS LAST, bill.created_at DESC
                LIMIT 50
                """
            ),
            params,
        )
        .mappings()
        .all()
    )
    items = []
    for row in rows:
        settlement = _money(row.get("settlement_amount"))
        received = _money(row.get("received_amount"))
        items.append(
            {
                "id": str(row["id"]),
                "statement_no": str(row.get("statement_no") or ""),
                "settlement_month": str(row.get("settlement_month") or ""),
                "games": str(row.get("line_games") or row.get("game_name") or ""),
                "settlement_amount": settlement,
                "received_amount": received,
                "unreceived_amount": round(max(0.0, settlement - received), 2),
                "receipt_status": str(row.get("receipt_status") or ""),
                "status": str(row.get("status") or ""),
                "created_at": _iso(row.get("created_at")),
                "updated_at": _iso(row.get("updated_at")),
            }
        )
    settlement_total = _money(summary_row.get("settlement")) if summary_row else 0.0
    received_total = _money(summary_row.get("received")) if summary_row else 0.0
    return items, {
        "count": int(summary_row.get("count") or 0) if summary_row else 0,
        "settlement": settlement_total,
        "received": received_total,
        "unreceived": round(max(0.0, settlement_total - received_total), 2),
    }


def _load_invoices(
    db: Session, keys: list[str]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not _table_exists(db, "invoice_records"):
        return [], {"count": 0, "amount": 0.0, "input_count": 0, "output_count": 0}
    where, params = _exact_match_clause(
        ["invoice.buyer_name", "invoice.seller_name", "invoice.title"], keys
    )
    amount_expr = "COALESCE(NULLIF(invoice.amount_with_tax, 0), invoice.invoice_amount, 0)"
    summary_row = (
        db.execute(
            text(
                f"""
                SELECT
                  COUNT(*) AS count,
                  COALESCE(SUM({amount_expr}), 0) AS amount,
                  COUNT(*) FILTER (WHERE invoice_direction = 'input') AS input_count,
                  COUNT(*) FILTER (WHERE invoice_direction <> 'input') AS output_count
                FROM invoice_records AS invoice
                WHERE {where}
                """
            ),
            params,
        )
        .mappings()
        .first()
    )
    rows = (
        db.execute(
            text(
                f"""
                SELECT
                  invoice.id,
                  invoice.invoice_direction,
                  invoice.digital_invoice_no,
                  invoice.invoice_code,
                  invoice.invoice_no,
                  invoice.invoice_date,
                  invoice.buyer_name,
                  invoice.seller_name,
                  invoice.amount_with_tax,
                  invoice.invoice_amount,
                  invoice.tax_amount,
                  invoice.tax_status,
                  invoice.status,
                  invoice.created_at,
                  invoice.updated_at
                FROM invoice_records AS invoice
                WHERE {where}
                ORDER BY invoice.invoice_date DESC NULLS LAST, invoice.updated_at DESC NULLS LAST
                LIMIT 50
                """
            ),
            params,
        )
        .mappings()
        .all()
    )
    items = []
    for row in rows:
        invoice_no = str(row.get("digital_invoice_no") or "") or " / ".join(
            str(value) for value in (row.get("invoice_code"), row.get("invoice_no")) if value
        )
        amount = _money(row.get("amount_with_tax")) or _money(row.get("invoice_amount"))
        items.append(
            {
                "id": str(row["id"]),
                "direction": "input" if str(row.get("invoice_direction") or "output") == "input" else "output",
                "invoice_no": invoice_no,
                "invoice_date": str(row.get("invoice_date") or ""),
                "buyer_name": str(row.get("buyer_name") or ""),
                "seller_name": str(row.get("seller_name") or ""),
                "amount": amount,
                "tax_amount": _money(row.get("tax_amount")),
                "tax_status": str(row.get("tax_status") or ""),
                "status": str(row.get("status") or ""),
                "created_at": _iso(row.get("created_at")),
                "updated_at": _iso(row.get("updated_at")),
            }
        )
    return items, {
        "count": int(summary_row.get("count") or 0) if summary_row else 0,
        "amount": _money(summary_row.get("amount")) if summary_row else 0.0,
        "input_count": int(summary_row.get("input_count") or 0) if summary_row else 0,
        "output_count": int(summary_row.get("output_count") or 0) if summary_row else 0,
    }


def _load_bank_transactions(
    db: Session, keys: list[str]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not _table_exists(db, "bank_transactions"):
        return [], {"count": 0, "inflow": 0.0, "outflow": 0.0, "latest_trade_date": None}
    where, params = _exact_match_clause(["tx.payer_name", "tx.payee_name"], keys)
    inflow_expr = (
        "CASE WHEN COALESCE(tx.income_amount, 0) <> 0 THEN ABS(tx.income_amount) "
        "WHEN tx.type = 'collection_register' THEN ABS(COALESCE(tx.amount, 0)) ELSE 0 END"
    )
    outflow_expr = (
        "CASE WHEN COALESCE(tx.expense_amount, 0) <> 0 THEN ABS(tx.expense_amount) "
        "WHEN tx.type = 'payment_register' THEN ABS(COALESCE(tx.amount, 0)) ELSE 0 END"
    )
    summary_row = (
        db.execute(
            text(
                f"""
                SELECT
                  COUNT(*) AS count,
                  COALESCE(SUM({inflow_expr}), 0) AS inflow,
                  COALESCE(SUM({outflow_expr}), 0) AS outflow,
                  MAX(trade_date) AS latest_trade_date
                FROM bank_transactions AS tx
                WHERE {where}
                """
            ),
            params,
        )
        .mappings()
        .first()
    )
    rows = (
        db.execute(
            text(
                f"""
                SELECT
                  tx.id,
                  tx.type,
                  tx.trade_date,
                  tx.transaction_no,
                  tx.instruction_no,
                  tx.payer_name,
                  tx.payee_name,
                  tx.summary,
                  tx.purpose,
                  tx.amount,
                  tx.income_amount,
                  tx.expense_amount,
                  tx.currency,
                  tx.reconciliation_no,
                  tx.status,
                  tx.created_at,
                  tx.updated_at
                FROM bank_transactions AS tx
                WHERE {where}
                ORDER BY tx.trade_date DESC NULLS LAST, tx.created_at DESC
                LIMIT 50
                """
            ),
            params,
        )
        .mappings()
        .all()
    )
    items = []
    for row in rows:
        inflow = _money(row.get("income_amount"))
        outflow = _money(row.get("expense_amount"))
        if inflow == 0 and str(row.get("type") or "") == "collection_register":
            inflow = abs(_money(row.get("amount")))
        if outflow == 0 and str(row.get("type") or "") == "payment_register":
            outflow = abs(_money(row.get("amount")))
        items.append(
            {
                "id": str(row["id"]),
                "type": str(row.get("type") or ""),
                "trade_date": str(row.get("trade_date") or ""),
                "transaction_no": str(row.get("transaction_no") or row.get("instruction_no") or ""),
                "payer_name": str(row.get("payer_name") or ""),
                "payee_name": str(row.get("payee_name") or ""),
                "summary": str(row.get("summary") or row.get("purpose") or ""),
                "inflow": abs(inflow),
                "outflow": abs(outflow),
                "currency": str(row.get("currency") or "CNY"),
                "reconciliation_no": str(row.get("reconciliation_no") or ""),
                "status": str(row.get("status") or ""),
                "created_at": _iso(row.get("created_at")),
                "updated_at": _iso(row.get("updated_at")),
            }
        )
    return items, {
        "count": int(summary_row.get("count") or 0) if summary_row else 0,
        "inflow": _money(summary_row.get("inflow")) if summary_row else 0.0,
        "outflow": _money(summary_row.get("outflow")) if summary_row else 0.0,
        "latest_trade_date": str(summary_row.get("latest_trade_date") or "") or None if summary_row else None,
    }


def _activity_sort_value(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return "0000-00-00"
    if re.match(r"^\d{4}-\d{2}$", raw):
        return f"{raw}-01"
    return raw


def _recent_activities(
    contracts: list[dict[str, Any]],
    rd_bills: list[dict[str, Any]],
    channel_bills: list[dict[str, Any]],
    invoices: list[dict[str, Any]],
    bank_transactions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for contract in contracts:
        event_date = contract.get("effective_date") or contract.get("created_at")
        items.append(
            {
                "kind": "contract",
                "entity_id": contract["id"],
                "date": event_date,
                "title": contract.get("contract_name") or "合同",
                "amount": contract.get("amount") or 0.0,
                "meta": contract.get("internal_contract_no") or contract.get("contract_no") or "合同",
                "sort_at": contract.get("updated_at") or event_date,
            }
        )
    for bill in rd_bills:
        items.append(
            {
                "kind": "rd_bill",
                "entity_id": bill["id"],
                "date": bill.get("settlement_month") or bill.get("created_at"),
                "title": bill.get("games") or bill.get("statement_no") or "研发账单",
                "amount": bill.get("settlement_amount") or 0.0,
                "meta": bill.get("statement_no") or "研发账单",
                "sort_at": bill.get("updated_at") or bill.get("created_at"),
            }
        )
    for bill in channel_bills:
        items.append(
            {
                "kind": "channel_bill",
                "entity_id": bill["id"],
                "date": bill.get("settlement_month") or bill.get("created_at"),
                "title": bill.get("games") or bill.get("statement_no") or "渠道账单",
                "amount": bill.get("settlement_amount") or 0.0,
                "meta": bill.get("statement_no") or "渠道账单",
                "sort_at": bill.get("updated_at") or bill.get("created_at"),
            }
        )
    for invoice in invoices:
        items.append(
            {
                "kind": "invoice",
                "entity_id": invoice["id"],
                "date": invoice.get("invoice_date") or invoice.get("created_at"),
                "title": "进项发票" if invoice.get("direction") == "input" else "销项发票",
                "amount": invoice.get("amount") or 0.0,
                "meta": invoice.get("invoice_no") or "发票",
                "sort_at": invoice.get("updated_at") or invoice.get("created_at"),
            }
        )
    for tx in bank_transactions:
        amount = tx.get("inflow") or tx.get("outflow") or 0.0
        items.append(
            {
                "kind": "bank_transaction",
                "entity_id": tx["id"],
                "date": tx.get("trade_date") or tx.get("created_at"),
                "title": "银行流入" if (tx.get("inflow") or 0) > 0 else "银行流出",
                "amount": amount,
                "meta": tx.get("transaction_no") or tx.get("summary") or "银行流水",
                "sort_at": tx.get("updated_at") or tx.get("created_at"),
            }
        )
    items.sort(key=lambda item: _activity_sort_value(item.get("sort_at")), reverse=True)
    return [
        {key: value for key, value in item.items() if key != "sort_at"}
        for item in items[:20]
    ]


def build_customer360(
    db: Session,
    permissions: set[str],
    partner_id: object,
) -> dict[str, Any] | None:
    partner = _load_partner(db, str(partner_id or "").strip())
    if partner is None:
        return None

    keys = _partner_match_keys(db, partner)
    access = _section_access(permissions)

    contracts: list[dict[str, Any]] = []
    rd_bills: list[dict[str, Any]] = []
    channel_bills: list[dict[str, Any]] = []
    invoices: list[dict[str, Any]] = []
    bank_transactions: list[dict[str, Any]] = []

    contract_summary = {"count": None, "active_count": None, "amount": None}
    rd_summary = {"count": None, "settlement": None, "paid": None, "unpaid": None}
    channel_summary = {"count": None, "settlement": None, "received": None, "unreceived": None}
    invoice_summary = {"count": None, "amount": None, "input_count": None, "output_count": None}
    bank_summary = {"count": None, "inflow": None, "outflow": None, "latest_trade_date": None}

    if access["contracts"]:
        contracts, contract_summary = _load_contracts(db, partner["id"])
    if access["reconciliation"]:
        rd_bills, rd_summary = _load_rd_bills(db, partner["id"], keys)
        channel_bills, channel_summary = _load_channel_bills(db, keys)
    if access["invoices"]:
        invoices, invoice_summary = _load_invoices(db, keys)
    if access["funds"]:
        bank_transactions, bank_summary = _load_bank_transactions(db, keys)

    summary = {
        "contract_count": contract_summary["count"],
        "active_contract_count": contract_summary["active_count"],
        "contract_amount": contract_summary["amount"],
        "rd_bill_count": rd_summary["count"],
        "rd_settlement_amount": rd_summary["settlement"],
        "rd_paid_amount": rd_summary["paid"],
        "rd_unpaid_amount": rd_summary["unpaid"],
        "channel_bill_count": channel_summary["count"],
        "channel_settlement_amount": channel_summary["settlement"],
        "channel_received_amount": channel_summary["received"],
        "channel_unreceived_amount": channel_summary["unreceived"],
        "invoice_count": invoice_summary["count"],
        "invoice_amount": invoice_summary["amount"],
        "input_invoice_count": invoice_summary["input_count"],
        "output_invoice_count": invoice_summary["output_count"],
        "bank_transaction_count": bank_summary["count"],
        "bank_inflow_amount": bank_summary["inflow"],
        "bank_outflow_amount": bank_summary["outflow"],
        "latest_trade_date": bank_summary["latest_trade_date"],
    }

    return {
        "partner": partner,
        "access": access,
        "summary": summary,
        "contracts": contracts,
        "rd_bills": rd_bills,
        "channel_bills": channel_bills,
        "invoices": invoices,
        "bank_transactions": bank_transactions,
        "recent_activities": _recent_activities(
            contracts,
            rd_bills,
            channel_bills,
            invoices,
            bank_transactions,
        ),
        "match_keys": keys,
    }
