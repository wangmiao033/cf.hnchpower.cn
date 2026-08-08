"""V2.5-2 全局搜索：跨账单、合同、发票、客户和银行流水检索。"""

from __future__ import annotations

from collections import Counter
import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

MAX_QUERY_LENGTH = 120
KIND_ORDER = {
    "contract": 0,
    "rd_bill": 1,
    "channel_bill": 2,
    "invoice": 3,
    "partner": 4,
    "bank_transaction": 5,
}


def _clean_query(value: object) -> str:
    raw = " ".join(str(value or "").strip().split())
    # % / _ 是 SQL LIKE 通配符。全局搜索按文字搜索处理，避免一个符号扫全库。
    return raw.replace("%", " ").replace("_", " ").strip()[:MAX_QUERY_LENGTH]


def _normalized(value: object) -> str:
    return re.sub(r"[\s\-—_·,，.。()（）\[\]【】/\\:：;；]+", "", str(value or "").strip().lower())


def _rank_fields(query: str, fields: list[tuple[str, object]], *, identifier_fields: set[str] | None = None) -> tuple[int, list[str]]:
    needle = _normalized(query)
    if not needle:
        return 0, []
    identifiers = identifier_fields or set()
    best = 0
    matched: list[str] = []
    for label, raw in fields:
        haystack = _normalized(raw)
        if not haystack or needle not in haystack:
            continue
        if label not in matched:
            matched.append(label)
        if haystack == needle:
            score = 100 if label in identifiers else 96
        elif haystack.startswith(needle):
            score = 92 if label in identifiers else 88
        else:
            score = 84 if label in identifiers else 72
        best = max(best, score)
    if len(matched) >= 2:
        best = min(100, best + min(8, (len(matched) - 1) * 3))
    return best, matched[:4]


def _money(value: object) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, 2) if number == number else None


def _table_exists(db: Session, table_name: str) -> bool:
    allowed = {
        "cf_contract_records",
        "cf_contract_internal_numbers",
        "cf_contract_access_items",
        "cf_partner_records",
    }
    if table_name not in allowed:
        return False
    return bool(
        db.execute(text(f"SELECT to_regclass('public.{table_name}')")).scalar_one_or_none()
    )


def _search_rd_bills(db: Session, query: str, limit: int) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT
              bill.id,
              bill.statement_no,
              bill.partner_name,
              bill.game_name,
              bill.settlement_month,
              bill.settlement_amount,
              bill.status,
              COALESCE(
                string_agg(DISTINCT NULLIF(line.game_name, ''), ' / '),
                ''
              ) AS line_games
            FROM reconciliation_records AS bill
            LEFT JOIN reconciliation_line_items AS line
              ON line.reconciliation_id = bill.id
            WHERE concat_ws(
              ' ',
              bill.statement_no,
              bill.partner_name,
              bill.game_name,
              bill.settlement_month,
              bill.remark,
              line.game_name
            ) ILIKE :pattern
            GROUP BY bill.id
            ORDER BY bill.updated_at DESC NULLS LAST, bill.created_at DESC
            LIMIT :limit
            """
        ),
        {"pattern": f"%{query}%", "limit": limit},
    ).mappings().all()
    results: list[dict[str, Any]] = []
    for row in rows:
        score, matched = _rank_fields(
            query,
            [
                ("账单编号", row.get("statement_no")),
                ("合作方", row.get("partner_name")),
                ("游戏", row.get("game_name")),
                ("游戏明细", row.get("line_games")),
                ("账期", row.get("settlement_month")),
            ],
            identifier_fields={"账单编号"},
        )
        results.append(
            {
                "id": f"rd:{row['id']}",
                "kind": "rd_bill",
                "title": str(row.get("statement_no") or f"研发账单 {str(row['id'])[:8]}"),
                "subtitle": " / ".join(
                    part
                    for part in [str(row.get("partner_name") or ""), str(row.get("game_name") or row.get("line_games") or "")]
                    if part
                ) or "研发账单",
                "meta": str(row.get("settlement_month") or "账期未填"),
                "badge": "研发账单",
                "amount": _money(row.get("settlement_amount")),
                "status": str(row.get("status") or "pending"),
                "score": score,
                "matched_fields": matched,
                "target": {
                    "action": "bill360",
                    "view": "recon-rd",
                    "entity_id": str(row["id"]),
                    "bill_type": "rd",
                },
            }
        )
    return results


def _search_channel_bills(db: Session, query: str, limit: int) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT
              bill.id,
              bill.statement_no,
              bill.channel_name,
              bill.partner_name,
              bill.game_name,
              bill.settlement_month,
              bill.settlement_amount,
              bill.received_amount,
              bill.status,
              COALESCE(
                string_agg(DISTINCT NULLIF(line.game_name, ''), ' / '),
                ''
              ) AS line_games
            FROM channel_records AS bill
            LEFT JOIN channel_record_line_items AS line
              ON line.channel_record_id = bill.id
            WHERE concat_ws(
              ' ',
              bill.statement_no,
              bill.channel_name,
              bill.partner_name,
              bill.game_name,
              bill.settlement_month,
              bill.remark,
              line.game_name
            ) ILIKE :pattern
            GROUP BY bill.id
            ORDER BY bill.updated_at DESC NULLS LAST, bill.created_at DESC
            LIMIT :limit
            """
        ),
        {"pattern": f"%{query}%", "limit": limit},
    ).mappings().all()
    results: list[dict[str, Any]] = []
    for row in rows:
        score, matched = _rank_fields(
            query,
            [
                ("账单编号", row.get("statement_no")),
                ("渠道", row.get("channel_name")),
                ("合作方", row.get("partner_name")),
                ("游戏", row.get("game_name")),
                ("游戏明细", row.get("line_games")),
                ("账期", row.get("settlement_month")),
            ],
            identifier_fields={"账单编号"},
        )
        results.append(
            {
                "id": f"channel:{row['id']}",
                "kind": "channel_bill",
                "title": str(row.get("statement_no") or f"渠道账单 {str(row['id'])[:8]}"),
                "subtitle": " / ".join(
                    part
                    for part in [
                        str(row.get("partner_name") or row.get("channel_name") or ""),
                        str(row.get("game_name") or row.get("line_games") or ""),
                    ]
                    if part
                ) or "渠道账单",
                "meta": str(row.get("settlement_month") or "账期未填"),
                "badge": "渠道账单",
                "amount": _money(row.get("settlement_amount")),
                "status": str(row.get("status") or "pending"),
                "score": score,
                "matched_fields": matched,
                "target": {
                    "action": "bill360",
                    "view": "recon-channel",
                    "entity_id": str(row["id"]),
                    "bill_type": "channel",
                },
            }
        )
    return results


def _search_invoices(db: Session, query: str, limit: int) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT
              id,
              invoice_direction,
              digital_invoice_no,
              invoice_code,
              invoice_no,
              buyer_name,
              buyer_tax_no,
              seller_name,
              seller_tax_no,
              title,
              tax_no,
              amount_with_tax,
              invoice_amount,
              tax_amount,
              invoice_date,
              status,
              tax_status
            FROM invoice_records
            WHERE concat_ws(
              ' ',
              digital_invoice_no,
              invoice_code,
              invoice_no,
              buyer_name,
              buyer_tax_no,
              seller_name,
              seller_tax_no,
              title,
              tax_no,
              invoice_identity_key,
              invoice_date,
              remark
            ) ILIKE :pattern
            ORDER BY updated_at DESC NULLS LAST, created_at DESC
            LIMIT :limit
            """
        ),
        {"pattern": f"%{query}%", "limit": limit},
    ).mappings().all()
    results: list[dict[str, Any]] = []
    for row in rows:
        invoice_no = str(row.get("digital_invoice_no") or "") or " / ".join(
            str(value) for value in (row.get("invoice_code"), row.get("invoice_no")) if value
        )
        direction = "input" if str(row.get("invoice_direction") or "output") == "input" else "output"
        counterparty = (
            str(row.get("seller_name") or "")
            if direction == "input"
            else str(row.get("buyer_name") or row.get("title") or "")
        )
        gross = _money(row.get("amount_with_tax"))
        if gross is None:
            gross = round(float(row.get("invoice_amount") or 0) + float(row.get("tax_amount") or 0), 2)
        score, matched = _rank_fields(
            query,
            [
                ("发票号码", invoice_no),
                ("购买方", row.get("buyer_name")),
                ("购买方税号", row.get("buyer_tax_no")),
                ("销售方", row.get("seller_name")),
                ("销售方税号", row.get("seller_tax_no")),
                ("抬头", row.get("title")),
                ("税号", row.get("tax_no")),
                ("开票日期", row.get("invoice_date")),
            ],
            identifier_fields={"发票号码", "购买方税号", "销售方税号", "税号"},
        )
        results.append(
            {
                "id": f"invoice:{row['id']}",
                "kind": "invoice",
                "title": invoice_no or f"发票 {str(row['id'])[:8]}",
                "subtitle": counterparty or ("进项发票" if direction == "input" else "销项发票"),
                "meta": str(row.get("invoice_date") or "开票日期未填"),
                "badge": "进项发票" if direction == "input" else "销项发票",
                "amount": gross,
                "status": str(row.get("status") or row.get("tax_status") or ""),
                "score": score,
                "matched_fields": matched,
                "target": {
                    "action": "invoice_detail",
                    "view": "invoice-input" if direction == "input" else "invoice-manage",
                    "entity_id": str(row["id"]),
                    "direction": direction,
                },
            }
        )
    return results


def _search_bank_transactions(db: Session, query: str, limit: int) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT
              id,
              type,
              trade_date,
              payer_name,
              payee_name,
              amount,
              income_amount,
              expense_amount,
              currency,
              transaction_no,
              instruction_no,
              summary,
              purpose,
              status,
              reconciliation_no
            FROM bank_transactions
            WHERE concat_ws(
              ' ',
              transaction_no,
              instruction_no,
              payer_name,
              payee_name,
              payer_account,
              payee_account,
              payer_bank_name,
              payee_bank_name,
              bank_account,
              summary,
              purpose,
              remark,
              reconciliation_no,
              raw_text
            ) ILIKE :pattern
            ORDER BY trade_date DESC NULLS LAST, created_at DESC
            LIMIT :limit
            """
        ),
        {"pattern": f"%{query}%", "limit": limit},
    ).mappings().all()
    type_labels = {
        "statement_import": "银行流水",
        "payment_register": "银行付款",
        "collection_register": "银行回款",
    }
    results: list[dict[str, Any]] = []
    for row in rows:
        score, matched = _rank_fields(
            query,
            [
                ("流水号", row.get("transaction_no")),
                ("指令编号", row.get("instruction_no")),
                ("付款方", row.get("payer_name")),
                ("收款方", row.get("payee_name")),
                ("摘要", row.get("summary")),
                ("用途", row.get("purpose")),
                ("关联账单", row.get("reconciliation_no")),
            ],
            identifier_fields={"流水号", "指令编号", "关联账单"},
        )
        amount = row.get("expense_amount") or row.get("income_amount") or row.get("amount")
        counterparties = " → ".join(
            part
            for part in [str(row.get("payer_name") or ""), str(row.get("payee_name") or "")]
            if part
        )
        tx_type = str(row.get("type") or "statement_import")
        results.append(
            {
                "id": f"bank:{row['id']}",
                "kind": "bank_transaction",
                "title": str(row.get("transaction_no") or row.get("instruction_no") or f"流水 {str(row['id'])[:8]}"),
                "subtitle": counterparties or str(row.get("summary") or row.get("purpose") or "银行流水"),
                "meta": str(row.get("trade_date") or "交易日期未填"),
                "badge": type_labels.get(tx_type, "银行流水"),
                "amount": _money(amount),
                "status": str(row.get("status") or ""),
                "score": score,
                "matched_fields": matched,
                "target": {
                    "action": "bank_detail",
                    "view": "bank-transactions-ledger",
                    "entity_id": str(row["id"]),
                },
            }
        )
    return results


def _search_partners(db: Session, query: str, limit: int) -> list[dict[str, Any]]:
    if not _table_exists(db, "cf_partner_records"):
        return []
    rows = db.execute(
        text(
            """
            SELECT
              id,
              name,
              short_name,
              category,
              tag,
              tax_registration_no,
              bank_name,
              bank_account,
              recipient
            FROM cf_partner_records
            WHERE concat_ws(
              ' ',
              name,
              short_name,
              category,
              tag,
              tax_registration_no,
              bank_name,
              bank_account,
              recipient
            ) ILIKE :pattern
            ORDER BY updated_at DESC NULLS LAST, name
            LIMIT :limit
            """
        ),
        {"pattern": f"%{query}%", "limit": limit},
    ).mappings().all()
    results: list[dict[str, Any]] = []
    for row in rows:
        score, matched = _rank_fields(
            query,
            [
                ("客户名称", row.get("name")),
                ("客户简称", row.get("short_name")),
                ("税号", row.get("tax_registration_no")),
                ("银行账号", row.get("bank_account")),
                ("联系人", row.get("recipient")),
            ],
            identifier_fields={"税号", "银行账号"},
        )
        name = str(row.get("name") or "")
        results.append(
            {
                "id": f"partner:{row['id']}",
                "kind": "partner",
                "title": str(row.get("short_name") or name or "未命名客户"),
                "subtitle": name if row.get("short_name") else str(row.get("category") or "客户资料"),
                "meta": str(row.get("tax_registration_no") or row.get("bank_name") or "客户库"),
                "badge": str(row.get("category") or "客户"),
                "amount": None,
                "status": None,
                "score": score,
                "matched_fields": matched,
                "target": {
                    "action": "partner_focus",
                    "view": "partner-contacts",
                    "entity_id": str(row["id"]),
                    "focus_query": name or str(row.get("short_name") or ""),
                },
            }
        )
    return results


def _search_contracts(db: Session, query: str, limit: int) -> list[dict[str, Any]]:
    if not _table_exists(db, "cf_contract_records"):
        return []
    has_internal = _table_exists(db, "cf_contract_internal_numbers")
    has_access = _table_exists(db, "cf_contract_access_items")
    has_partners = _table_exists(db, "cf_partner_records")

    internal_select = "number.internal_contract_no" if has_internal else "'' AS internal_contract_no"
    internal_join = (
        "LEFT JOIN cf_contract_internal_numbers AS number ON number.contract_id = contract.id"
        if has_internal
        else ""
    )
    partner_select = (
        "partner.name AS partner_name, partner.short_name AS partner_short_name"
        if has_partners
        else "'' AS partner_name, '' AS partner_short_name"
    )
    partner_join = (
        "LEFT JOIN cf_partner_records AS partner ON partner.id = contract.partner_id"
        if has_partners
        else ""
    )
    access_select = (
        "COALESCE(string_agg(DISTINCT NULLIF(access.product_name, ''), ' / '), '') AS access_products, "
        "COALESCE(string_agg(DISTINCT NULLIF(access.channel_name, ''), ' / '), '') AS access_channels, "
        "COALESCE(string_agg(DISTINCT NULLIF(access.app_id, ''), ' / '), '') AS access_app_ids"
        if has_access
        else "'' AS access_products, '' AS access_channels, '' AS access_app_ids"
    )
    access_join = (
        "LEFT JOIN cf_contract_access_items AS access ON access.contract_id = contract.id"
        if has_access
        else ""
    )
    search_parts = [
        "contract.contract_name",
        "contract.contract_type",
        "contract.counterparty",
        "contract.contract_no",
        "contract.platform_record_id",
        "contract.payment_type",
        "contract.performance_status",
    ]
    if has_internal:
        search_parts.append("number.internal_contract_no")
    if has_partners:
        search_parts.extend(["partner.name", "partner.short_name"])
    if has_access:
        search_parts.extend(
            [
                "access.product_name",
                "access.channel_name",
                "access.app_id",
                "access.platform_record_id",
                "access.software_copyright_no",
                "access.isbn",
            ]
        )
    search_expr = ", ".join(search_parts)
    group_parts = [
        "contract.id",
        "contract.contract_name",
        "contract.contract_type",
        "contract.counterparty",
        "contract.contract_no",
        "contract.amount",
        "contract.effective_date",
        "contract.end_date",
        "contract.performance_status",
        "contract.payment_type",
        "contract.updated_at",
        "contract.created_at",
    ]
    if has_internal:
        group_parts.append("number.internal_contract_no")
    if has_partners:
        group_parts.extend(["partner.name", "partner.short_name"])
    group_expr = ", ".join(group_parts)

    sql = f"""
        SELECT
          contract.id,
          contract.contract_name,
          contract.contract_type,
          contract.counterparty,
          contract.contract_no,
          contract.amount,
          contract.effective_date,
          contract.end_date,
          contract.performance_status,
          contract.payment_type,
          {internal_select},
          {partner_select},
          {access_select}
        FROM cf_contract_records AS contract
        {internal_join}
        {partner_join}
        {access_join}
        WHERE concat_ws(' ', {search_expr}) ILIKE :pattern
        GROUP BY {group_expr}
        ORDER BY contract.updated_at DESC NULLS LAST, contract.created_at DESC
        LIMIT :limit
    """
    rows = db.execute(text(sql), {"pattern": f"%{query}%", "limit": limit}).mappings().all()
    results: list[dict[str, Any]] = []
    for row in rows:
        score, matched = _rank_fields(
            query,
            [
                ("我司合同编号", row.get("internal_contract_no")),
                ("客户原合同编号", row.get("contract_no")),
                ("合同名称", row.get("contract_name")),
                ("签约方", row.get("counterparty")),
                ("关联客户", row.get("partner_name")),
                ("客户简称", row.get("partner_short_name")),
                ("游戏", row.get("access_products")),
                ("渠道", row.get("access_channels")),
                ("应用 ID", row.get("access_app_ids")),
            ],
            identifier_fields={"我司合同编号", "客户原合同编号", "应用 ID"},
        )
        internal_no = str(row.get("internal_contract_no") or "")
        original_no = str(row.get("contract_no") or "")
        results.append(
            {
                "id": f"contract:{row['id']}",
                "kind": "contract",
                "title": str(row.get("contract_name") or "未命名合同"),
                "subtitle": str(row.get("partner_short_name") or row.get("counterparty") or row.get("partner_name") or "签约方未填"),
                "meta": " · ".join(part for part in [internal_no, f"原号 {original_no}" if original_no else ""] if part) or "合同编号生成中",
                "badge": "合同",
                "amount": _money(row.get("amount")),
                "status": str(row.get("performance_status") or ""),
                "score": score,
                "matched_fields": matched,
                "target": {
                    "action": "contract_detail",
                    "view": "contracts",
                    "entity_id": str(row["id"]),
                    "focus_query": internal_no or original_no or str(row.get("contract_name") or ""),
                },
            }
        )
    return results


def search_business_data(
    db: Session,
    permissions: set[str],
    query: object,
    *,
    limit: int = 30,
) -> dict[str, Any]:
    """Search only modules visible to the current user; unauthorized data is never queried."""
    cleaned = _clean_query(query)
    safe_limit = max(5, min(60, int(limit or 30)))
    if not cleaned:
        return {"query": "", "total": 0, "results": [], "groups": []}

    per_kind_limit = max(8, min(20, safe_limit))
    results: list[dict[str, Any]] = []
    if "contracts.view" in permissions:
        results.extend(_search_contracts(db, cleaned, per_kind_limit))
    if "reconciliation.view" in permissions:
        results.extend(_search_rd_bills(db, cleaned, per_kind_limit))
        results.extend(_search_channel_bills(db, cleaned, per_kind_limit))
    if "invoices.view" in permissions:
        results.extend(_search_invoices(db, cleaned, per_kind_limit))
    if "partners.view" in permissions:
        results.extend(_search_partners(db, cleaned, per_kind_limit))
    if "funds.view" in permissions:
        results.extend(_search_bank_transactions(db, cleaned, per_kind_limit))

    results.sort(
        key=lambda item: (
            -int(item.get("score") or 0),
            KIND_ORDER.get(str(item.get("kind")), 99),
            str(item.get("title") or ""),
        )
    )
    selected = results[:safe_limit]
    counts = Counter(str(item["kind"]) for item in selected)
    groups = [
        {"kind": kind, "count": counts[kind]}
        for kind in KIND_ORDER
        if counts.get(kind)
    ]
    return {
        "query": cleaned,
        "total": len(selected),
        "results": selected,
        "groups": groups,
    }
