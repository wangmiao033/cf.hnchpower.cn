"""R&D prepayment management workbench and Bill360 evidence APIs.

This module keeps the original bank-funding write API untouched and adds read-side
views for finance users:
- product/access-item level prepayment pools;
- historical bank transaction recommendations for backfilling real funding;
- funding/invoice/deduction detail for audit;
- bill-level prepayment evidence for Bill360.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import bindparam, select, text
from sqlalchemy.orm import Session

from app.api.rd_prepayment import _bank_expense, _match_score, _money, _pool_candidates
from app.core.deps import get_db
from app.models.bank_reconciliation_match import BankReconciliationMatch
from app.models.bank_transaction import BankTransaction

router = APIRouter()
ZERO = Decimal("0")
EPS = Decimal("0.01")


def _tables_ready(db: Session) -> bool:
    required = (
        "cf_rd_prepayment_deductions",
        "cf_rd_prepayment_fundings",
        "cf_rd_prepayment_invoice_allocations",
        "cf_contract_access_terms",
        "cf_contract_access_items",
        "cf_contract_records",
    )
    for name in required:
        if not db.execute(text("SELECT to_regclass(:table_name)"), {"table_name": f"public.{name}"}).scalar_one_or_none():
            return False
    return True


def _float_money(value: Any) -> float:
    return float(_money(value))


def _pool_status(pool: dict) -> tuple[str, str, str]:
    agreed = _money(pool.get("prepayment_agreed_amount"))
    funded = _money(pool.get("actual_funded_amount"))
    deducted = _money(pool.get("deducted_amount"))
    invoiced = _money(pool.get("invoice_allocated_amount"))
    shortfall = _money(pool.get("funding_shortfall"))
    factual_available = max(ZERO, min(agreed, funded) - deducted)

    if shortfall > EPS:
        return "funding_shortfall", "抵扣超出银行已付", "danger"
    if funded + EPS < agreed:
        return "funding_pending", "待补银行预付款", "warning"
    if invoiced + EPS < funded:
        return "invoice_pending", "待补进项发票", "warning"
    if deducted > EPS and factual_available <= EPS:
        return "exhausted", "预付款已用完", "neutral"
    if deducted > EPS:
        return "deducting", "正在抵扣", "good"
    return "ready", "资金已就绪", "good"


def _candidate_score(pool: dict, tx: BankTransaction, available_amount: Decimal) -> tuple[int, list[str]]:
    payee = tx.payee_name or tx.payer_name or ""
    name_score = max(
        _match_score(payee, pool.get("counterparty")),
        _match_score(payee, pool.get("partner_name")),
        _match_score(payee, pool.get("partner_short_name")),
    )
    score = name_score
    reasons: list[str] = []
    if name_score >= 100:
        reasons.append("银行收款方与合同合作方完全一致")
    elif name_score >= 80:
        reasons.append("银行收款方与合同合作方名称高度接近")

    summary = str(tx.summary or tx.purpose or tx.remark or "").lower()
    if any(token in summary for token in ("预付", "预付款", "advance", "deposit")):
        score += 12
        reasons.append("流水摘要包含预付款特征")

    need = max(ZERO, _money(pool.get("max_fundable_amount")))
    if need > EPS:
        gap = abs(available_amount - need)
        if gap <= EPS:
            score += 18
            reasons.append("流水金额与合同待入账预付款完全一致")
        elif gap <= max(Decimal("100"), need * Decimal("0.03")):
            score += 10
            reasons.append("流水金额与合同待入账预付款接近")
        elif available_amount <= need + EPS:
            score += 5
            reasons.append("流水金额可作为本合同预付款的一部分")

    return min(100, score), reasons


def _bank_candidate_rows(db: Session, limit: int = 1200) -> list[BankTransaction]:
    rows = db.execute(
        select(BankTransaction)
        .where(BankTransaction.type.in_(("statement_import", "payment_register")))
        .order_by(BankTransaction.trade_date.desc(), BankTransaction.created_at.desc())
        .limit(limit)
    ).scalars().all()
    return rows


def _bank_recommendations(db: Session, pools: list[dict], per_pool: int = 3) -> dict[str, list[dict]]:
    if not pools:
        return {}
    rows = _bank_candidate_rows(db)
    tx_ids = [str(row.id) for row in rows]
    confirmed_ids: set[str] = set()
    if tx_ids:
        confirmed_ids = {
            str(value)
            for value in db.execute(
                select(BankReconciliationMatch.bank_transaction_id).where(
                    BankReconciliationMatch.bank_transaction_id.in_(tx_ids),
                    BankReconciliationMatch.status == "confirmed",
                )
            ).scalars().all()
            if value
        }

    funded_map: dict[str, Decimal] = {}
    if tx_ids:
        stmt = text("""
            SELECT bank_transaction_id, COALESCE(SUM(funded_amount), 0) AS amount
            FROM cf_rd_prepayment_fundings
            WHERE bank_transaction_id IN :ids
            GROUP BY bank_transaction_id
        """).bindparams(bindparam("ids", expanding=True))
        for row in db.execute(stmt, {"ids": tx_ids}).mappings().all():
            funded_map[str(row["bank_transaction_id"])] = _money(row.get("amount"))

    available_rows: list[tuple[BankTransaction, Decimal]] = []
    for row in rows:
        tx_id = str(row.id)
        if tx_id in confirmed_ids or str(row.reconciliation_id or "").strip():
            continue
        currency = str(row.currency or "CNY").strip().upper()
        if currency not in {"", "CNY", "RMB"}:
            continue
        expense = _bank_expense(row)
        available = max(ZERO, expense - funded_map.get(tx_id, ZERO))
        if available <= EPS:
            continue
        available_rows.append((row, available))

    result: dict[str, list[dict]] = {}
    for pool in pools:
        access_id = str(pool.get("access_item_id") or "")
        need = max(ZERO, _money(pool.get("max_fundable_amount")))
        if not access_id or need <= EPS:
            result[access_id] = []
            continue
        candidates: list[dict] = []
        for tx, available in available_rows:
            score, reasons = _candidate_score(pool, tx, available)
            if score < 55:
                continue
            suggested = min(available, need)
            candidates.append({
                "id": str(tx.id),
                "trade_date": tx.trade_date,
                "transaction_no": tx.transaction_no,
                "payee_name": tx.payee_name or tx.payer_name or "",
                "summary": tx.summary or tx.purpose or tx.remark or "",
                "source_bank": tx.source_bank,
                "source_file_name": tx.source_file_name,
                "expense_amount": _float_money(_bank_expense(tx)),
                "available_amount": _float_money(available),
                "suggested_funding_amount": _float_money(suggested),
                "match_score": score,
                "confidence": "high" if score >= 85 else "medium" if score >= 70 else "low",
                "reasons": reasons,
            })
        candidates.sort(key=lambda item: (item["match_score"], item["trade_date"] or ""), reverse=True)
        result[access_id] = candidates[:per_pool]
    return result


def _enrich_pool(pool: dict, recommendations: list[dict]) -> dict:
    item = dict(pool)
    agreed = max(ZERO, _money(item.get("prepayment_agreed_amount")))
    funded = max(ZERO, _money(item.get("actual_funded_amount")))
    deducted = max(ZERO, _money(item.get("deducted_amount")))
    invoiced = max(ZERO, _money(item.get("invoice_allocated_amount")))
    status, status_label, tone = _pool_status(item)
    factual_available = max(ZERO, min(agreed, funded) - deducted)
    item.update({
        "prepayment_agreed_amount": float(agreed),
        "actual_funded_amount": float(funded),
        "deducted_amount": float(deducted),
        "available_balance": float(factual_available),
        "legacy_available_balance": _float_money(item.get("available_balance")),
        "funding_gap": float(max(ZERO, agreed - funded)),
        "invoice_allocated_amount": float(invoiced),
        "invoice_gap": float(max(ZERO, funded - invoiced)),
        "funding_shortfall": _float_money(item.get("funding_shortfall")),
        "funding_verification_status": "verified" if funded > EPS else "unverified",
        "status": status,
        "status_label": status_label,
        "status_tone": tone,
        "bank_recommendations": recommendations,
    })
    return item


def _pool_list(db: Session, recommendation_limit: int = 3) -> list[dict]:
    pools = _pool_candidates(db)
    recommendations = _bank_recommendations(db, pools, per_pool=recommendation_limit)
    return [_enrich_pool(item, recommendations.get(str(item.get("access_item_id") or ""), [])) for item in pools]


@router.get("/workbench")
def workbench(
    recommendation_limit: int = Query(3, ge=0, le=8),
    db: Session = Depends(get_db),
) -> dict:
    if not _tables_ready(db):
        return {
            "stats": {
                "pool_count": 0,
                "agreed_amount": 0,
                "funded_amount": 0,
                "deducted_amount": 0,
                "available_amount": 0,
                "funding_gap": 0,
                "invoice_gap": 0,
                "attention_count": 0,
            },
            "items": [],
            "schema_ready": False,
        }
    items = _pool_list(db, recommendation_limit=recommendation_limit)
    stats = {
        "pool_count": len(items),
        "agreed_amount": round(sum(float(item["prepayment_agreed_amount"]) for item in items), 2),
        "funded_amount": round(sum(float(item["actual_funded_amount"]) for item in items), 2),
        "deducted_amount": round(sum(float(item["deducted_amount"]) for item in items), 2),
        "available_amount": round(sum(float(item["available_balance"]) for item in items), 2),
        "funding_gap": round(sum(float(item["funding_gap"]) for item in items), 2),
        "invoice_gap": round(sum(float(item["invoice_gap"]) for item in items), 2),
        "attention_count": sum(1 for item in items if item["status"] in {"funding_shortfall", "funding_pending", "invoice_pending"}),
    }
    return {"stats": stats, "items": items, "schema_ready": True}


@router.get("/pools/{access_item_id}")
def pool_detail(access_item_id: str, db: Session = Depends(get_db)) -> dict:
    if not _tables_ready(db):
        raise HTTPException(status_code=409, detail="研发预付款数据库结构尚未初始化")
    pools = _pool_list(db, recommendation_limit=5)
    pool = next((item for item in pools if str(item.get("access_item_id")) == str(access_item_id)), None)
    if pool is None:
        raise HTTPException(status_code=404, detail="研发预付款产品不存在")

    fundings = db.execute(text("""
        SELECT
          funding.id,
          funding.bank_transaction_id,
          funding.funded_amount,
          funding.currency,
          funding.funding_date,
          funding.note,
          funding.created_by,
          funding.created_at,
          bank.trade_date,
          bank.transaction_no,
          bank.payee_name,
          bank.payer_name,
          COALESCE(bank.summary, bank.purpose, bank.remark, '') AS bank_summary,
          bank.source_bank,
          bank.source_file_name
        FROM cf_rd_prepayment_fundings AS funding
        LEFT JOIN bank_transactions AS bank ON bank.id = funding.bank_transaction_id
        WHERE funding.access_item_id = :access_item_id
        ORDER BY funding.created_at ASC, funding.id ASC
    """), {"access_item_id": access_item_id}).mappings().all()

    funding_ids = [str(row["id"]) for row in fundings]
    allocations: dict[str, list[dict]] = {funding_id: [] for funding_id in funding_ids}
    if funding_ids:
        stmt = text("""
            SELECT
              allocation.id,
              allocation.funding_id,
              allocation.invoice_id,
              allocation.allocated_amount,
              allocation.created_at,
              invoice.invoice_no,
              invoice.digital_invoice_no,
              invoice.seller_name,
              invoice.invoice_date
            FROM cf_rd_prepayment_invoice_allocations AS allocation
            JOIN invoice_records AS invoice ON invoice.id = allocation.invoice_id
            WHERE allocation.funding_id IN :funding_ids
            ORDER BY allocation.created_at ASC
        """).bindparams(bindparam("funding_ids", expanding=True))
        for row in db.execute(stmt, {"funding_ids": funding_ids}).mappings().all():
            allocations[str(row["funding_id"])].append({
                "id": str(row["id"]),
                "invoice_id": str(row["invoice_id"]),
                "invoice_no": row.get("invoice_no") or row.get("digital_invoice_no") or str(row["invoice_id"])[:8],
                "seller_name": row.get("seller_name") or "",
                "invoice_date": row.get("invoice_date"),
                "allocated_amount": _float_money(row.get("allocated_amount")),
                "created_at": row.get("created_at"),
            })

    funding_items = []
    for row in fundings:
        funding_id = str(row["id"])
        invoice_items = allocations.get(funding_id, [])
        invoice_total = sum(_money(item.get("allocated_amount")) for item in invoice_items)
        funded_amount = _money(row.get("funded_amount"))
        funding_items.append({
            **dict(row),
            "id": funding_id,
            "bank_transaction_id": str(row.get("bank_transaction_id") or ""),
            "funded_amount": float(funded_amount),
            "counterparty_name": row.get("payee_name") or row.get("payer_name") or "",
            "invoice_allocated_amount": float(invoice_total),
            "invoice_gap": float(max(ZERO, funded_amount - invoice_total)),
            "invoice_allocations": invoice_items,
        })

    deduction_rows = db.execute(text("""
        SELECT
          deduction.id,
          deduction.bill_id,
          deduction.line_index,
          deduction.line_id,
          deduction.settlement_amount,
          deduction.deduction_amount,
          deduction.created_by,
          deduction.created_at,
          bill.statement_no,
          bill.settlement_month,
          bill.partner_name,
          COALESCE(line.game_name, bill.game_name, '') AS game_name,
          COALESCE(line.settlement_cycle, bill.settlement_month, '') AS settlement_cycle
        FROM cf_rd_prepayment_deductions AS deduction
        LEFT JOIN reconciliation_records AS bill ON bill.id = deduction.bill_id
        LEFT JOIN reconciliation_line_items AS line ON line.id = deduction.line_id
        WHERE deduction.access_item_id = :access_item_id
        ORDER BY deduction.created_at DESC, deduction.id DESC
    """), {"access_item_id": access_item_id}).mappings().all()
    deductions = [{
        **dict(row),
        "id": str(row["id"]),
        "bill_id": str(row.get("bill_id") or ""),
        "settlement_amount": _float_money(row.get("settlement_amount")),
        "deduction_amount": _float_money(row.get("deduction_amount")),
        "actual_cash_payable": _float_money(max(ZERO, _money(row.get("settlement_amount")) - _money(row.get("deduction_amount")))),
    } for row in deduction_rows]

    return {"pool": pool, "fundings": funding_items, "deductions": deductions}


@router.get("/bills/{bill_id}/evidence")
def bill_evidence(bill_id: str, db: Session = Depends(get_db)) -> dict:
    if not _tables_ready(db):
        return {
            "bill_id": bill_id,
            "bill_amount": 0,
            "prepayment_deduction_amount": 0,
            "cash_payable_amount": 0,
            "status": "not_configured",
            "status_label": "未使用预付款",
            "lines": [],
        }

    bill = db.execute(text("""
        SELECT id, statement_no, settlement_amount, settlement_month, partner_name, game_name
        FROM reconciliation_records
        WHERE id = :bill_id
    """), {"bill_id": bill_id}).mappings().first()
    if bill is None:
        raise HTTPException(status_code=404, detail="研发账单不存在")

    rows = db.execute(text("""
        SELECT
          deduction.id,
          deduction.line_index,
          deduction.line_id,
          deduction.access_item_id,
          deduction.contract_id,
          deduction.settlement_amount,
          deduction.deduction_amount,
          deduction.created_by,
          deduction.created_at,
          access.product_name,
          contract.contract_name,
          contract.contract_no,
          contract.counterparty,
          COALESCE(terms.prepayment_amount, 0) AS agreed_amount,
          COALESCE(line.game_name, access.product_name, '') AS game_name,
          COALESCE(line.settlement_cycle, bill.settlement_month, '') AS settlement_cycle
        FROM cf_rd_prepayment_deductions AS deduction
        LEFT JOIN reconciliation_line_items AS line ON line.id = deduction.line_id
        LEFT JOIN cf_contract_access_items AS access ON access.id = deduction.access_item_id
        LEFT JOIN cf_contract_records AS contract ON contract.id = deduction.contract_id
        LEFT JOIN cf_contract_access_terms AS terms ON terms.access_item_id = deduction.access_item_id
        LEFT JOIN reconciliation_records AS bill ON bill.id = deduction.bill_id
        WHERE deduction.bill_id = :bill_id
        ORDER BY deduction.line_index ASC, deduction.created_at ASC
    """), {"bill_id": bill_id}).mappings().all()

    access_ids = list(dict.fromkeys(str(row.get("access_item_id") or "") for row in rows if row.get("access_item_id")))
    funded_map: dict[str, Decimal] = {}
    invoice_map: dict[str, Decimal] = {}
    used_map: dict[str, Decimal] = {}
    if access_ids:
        stmt = text("""
            SELECT access_item_id, COALESCE(SUM(funded_amount), 0) AS amount
            FROM cf_rd_prepayment_fundings
            WHERE access_item_id IN :ids
            GROUP BY access_item_id
        """).bindparams(bindparam("ids", expanding=True))
        funded_map = {str(row["access_item_id"]): _money(row.get("amount")) for row in db.execute(stmt, {"ids": access_ids}).mappings().all()}
        stmt = text("""
            SELECT funding.access_item_id, COALESCE(SUM(allocation.allocated_amount), 0) AS amount
            FROM cf_rd_prepayment_invoice_allocations AS allocation
            JOIN cf_rd_prepayment_fundings AS funding ON funding.id = allocation.funding_id
            WHERE funding.access_item_id IN :ids
            GROUP BY funding.access_item_id
        """).bindparams(bindparam("ids", expanding=True))
        invoice_map = {str(row["access_item_id"]): _money(row.get("amount")) for row in db.execute(stmt, {"ids": access_ids}).mappings().all()}
        stmt = text("""
            SELECT access_item_id, COALESCE(SUM(deduction_amount), 0) AS amount
            FROM cf_rd_prepayment_deductions
            WHERE access_item_id IN :ids
            GROUP BY access_item_id
        """).bindparams(bindparam("ids", expanding=True))
        used_map = {str(row["access_item_id"]): _money(row.get("amount")) for row in db.execute(stmt, {"ids": access_ids}).mappings().all()}

    lines = []
    for row in rows:
        access_id = str(row.get("access_item_id") or "")
        agreed = max(ZERO, _money(row.get("agreed_amount")))
        funded = max(ZERO, funded_map.get(access_id, ZERO))
        used_total = max(ZERO, used_map.get(access_id, ZERO))
        deduction = max(ZERO, _money(row.get("deduction_amount")))
        settlement = max(ZERO, _money(row.get("settlement_amount")))
        lines.append({
            **dict(row),
            "id": str(row["id"]),
            "access_item_id": access_id,
            "settlement_amount": float(settlement),
            "deduction_amount": float(deduction),
            "cash_payable_amount": float(max(ZERO, settlement - deduction)),
            "agreed_amount": float(agreed),
            "actual_funded_amount": float(funded),
            "invoice_allocated_amount": float(invoice_map.get(access_id, ZERO)),
            "pool_used_amount": float(used_total),
            "pool_available_amount": float(max(ZERO, min(agreed, funded) - used_total)),
        })

    bill_amount = abs(_money(bill.get("settlement_amount")))
    deduction_total = sum((_money(row.get("deduction_amount")) for row in rows), ZERO)
    deduction_total = min(bill_amount, max(ZERO, deduction_total))
    cash_payable = max(ZERO, bill_amount - deduction_total)
    if bill_amount <= EPS:
        status = "zero_settlement"
        label = "零结算"
    elif deduction_total > EPS and cash_payable <= EPS:
        status = "fully_offset"
        label = "预付款全额抵扣"
    elif deduction_total > EPS:
        status = "partially_offset"
        label = "预付款部分抵扣"
    else:
        status = "not_used"
        label = "未使用预付款"

    return {
        "bill_id": str(bill["id"]),
        "statement_no": bill.get("statement_no"),
        "settlement_month": bill.get("settlement_month"),
        "partner_name": bill.get("partner_name"),
        "game_name": bill.get("game_name"),
        "bill_amount": float(bill_amount),
        "prepayment_deduction_amount": float(deduction_total),
        "cash_payable_amount": float(cash_payable),
        "status": status,
        "status_label": label,
        "lines": lines,
    }
