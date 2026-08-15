"""R&D prepayment lifecycle: installments, triggers, freezes, refunds and invoice release."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.api.rd_prepayment import _match_score, _regularly_linked
from app.core.deps import get_db
from app.models.bank_transaction import BankTransaction
from app.models.operation_log import OperationLog
from app.models.user import AuthUser
from app.services.permissions import require_permission

router = APIRouter()
CENT = Decimal("0.01")
ZERO = Decimal("0")
EPS = Decimal("0.01")
TRIGGER_TYPES = {"manual", "contract_effective", "game_launch", "fixed_date", "other"}
INVOICE_POLICIES = {"separate", "release_by_deduction", "manual"}


def _money(value: Any) -> Decimal:
    try:
        parsed = Decimal(str(value or 0))
    except Exception:
        return ZERO
    if not parsed.is_finite():
        return ZERO
    return parsed.quantize(CENT, rounding=ROUND_HALF_UP)


def _actor(user: AuthUser) -> str:
    return str(user.email or user.id or "")


def _today_text() -> str:
    return date.today().isoformat()


def _parse_date(value: Any) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def _business_due_date(trigger_date: str, business_days: int) -> str:
    current = _parse_date(trigger_date)
    if current is None:
        raise HTTPException(status_code=422, detail="触发日期格式不正确")
    remaining = max(0, int(business_days or 0))
    while remaining > 0:
        current += timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current.isoformat()


def _tables_ready(db: Session) -> bool:
    required = (
        "cf_rd_prepayment_lifecycle_settings",
        "cf_rd_prepayment_installments",
        "cf_rd_prepayment_refunds",
        "cf_rd_prepayment_invoice_releases",
        "cf_rd_prepayment_fundings",
        "cf_rd_prepayment_deductions",
        "cf_rd_prepayment_invoice_allocations",
        "cf_contract_access_items",
        "cf_contract_access_terms",
        "cf_contract_records",
    )
    return all(
        db.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{name}"}).scalar_one_or_none()
        for name in required
    )


def _audit(
    db: Session,
    user: AuthUser,
    entity_id: str,
    action: str,
    summary: str,
    changes: dict | None = None,
    metadata: dict | None = None,
) -> None:
    db.add(OperationLog(
        id=str(uuid4()),
        entity_type="rd_prepayment_lifecycle",
        entity_id=entity_id,
        entity_number=None,
        action=action,
        summary=summary,
        actor_user_id=str(user.id),
        actor_email=user.email,
        changes=changes or {},
        metadata_json=metadata or {},
    ))


def _base_pool_rows(db: Session) -> list[dict]:
    return [dict(row) for row in db.execute(text("""
        SELECT
          access.id AS access_item_id,
          access.contract_id,
          access.product_name,
          access.channel_name,
          access.status AS access_status,
          contract.contract_name,
          contract.contract_no,
          contract.counterparty,
          partner.name AS partner_name,
          partner.short_name AS partner_short_name,
          COALESCE(terms.prepayment_amount, 0) AS prepayment_agreed_amount
        FROM cf_contract_access_items AS access
        JOIN cf_contract_records AS contract ON contract.id = access.contract_id
        LEFT JOIN cf_partner_records AS partner ON partner.id = contract.partner_id
        JOIN cf_contract_access_terms AS terms ON terms.access_item_id = access.id
        WHERE COALESCE(terms.prepayment_amount, 0) > 0
        ORDER BY contract.updated_at DESC, access.updated_at DESC
    """)).mappings().all()]


def _aggregate_map(db: Session, sql: str) -> dict[str, Decimal]:
    return {
        str(row["access_item_id"]): max(ZERO, _money(row["amount"]))
        for row in db.execute(text(sql)).mappings().all()
        if row.get("access_item_id")
    }


def _settings_map(db: Session) -> dict[str, dict]:
    return {
        str(row["access_item_id"]): dict(row)
        for row in db.execute(text("SELECT * FROM cf_rd_prepayment_lifecycle_settings")).mappings().all()
    }


def _installments_map(db: Session) -> dict[str, list[dict]]:
    result: dict[str, list[dict]] = {}
    for row in db.execute(text("""
        SELECT * FROM cf_rd_prepayment_installments
        ORDER BY access_item_id, installment_no, created_at
    """)).mappings().all():
        result.setdefault(str(row["access_item_id"]), []).append(dict(row))
    return result


def _pool_status(
    *,
    strict_mode: bool,
    frozen: bool,
    plan_total: Decimal,
    triggered_total: Decimal,
    invoice_blocked: Decimal,
    funding_gap: Decimal,
    overdue_amount: Decimal,
    invoice_gap: Decimal,
    funded: Decimal,
    deducted: Decimal,
    available: Decimal,
    refund_due: Decimal,
    refunded: Decimal,
    shortfall: Decimal,
) -> tuple[str, str, str]:
    if shortfall > EPS:
        return "funding_shortfall", "抵扣超出银行实付", "danger"
    if frozen:
        if refund_due > EPS and refunded > EPS:
            return "refund_partial", "部分退款，继续追款", "warning"
        if refund_due > EPS:
            return "refund_pending", "冻结待退款", "danger"
        return "refunded", "退款 / 结清完成", "neutral"
    if strict_mode and plan_total <= EPS:
        return "plan_pending", "待建立履约计划", "warning"
    if strict_mode and triggered_total <= EPS and plan_total > EPS:
        return "pending_trigger", "预付款尚未触发", "neutral"
    if strict_mode and invoice_blocked > EPS:
        return "invoice_precondition", "已触发，等待付款前置发票", "warning"
    if strict_mode and overdue_amount > EPS:
        return "payment_overdue", "已到期未付款", "danger"
    if strict_mode and funding_gap > EPS:
        return "payment_pending", "已触发待付款", "warning"
    if invoice_gap > EPS and funded > EPS:
        return "invoice_pending", "付款凭证待补发票", "warning"
    if deducted > EPS and available <= EPS:
        return "exhausted", "预付款已用完", "neutral"
    if deducted > EPS:
        return "deducting", "正在抵扣", "good"
    if funded > EPS:
        return "ready", "资金已就绪", "good"
    if not strict_mode:
        return "legacy", "历史兼容模式", "neutral"
    return "ready", "等待研发月结", "good"


def _installment_presentations(rows: list[dict], funded: Decimal) -> list[dict]:
    funded_left = max(ZERO, funded)
    today = date.today()
    out: list[dict] = []
    for row in rows:
        planned = max(ZERO, _money(row.get("planned_amount")))
        triggered = row.get("triggered_at") is not None
        funded_amount = min(planned, funded_left) if triggered else ZERO
        if triggered:
            funded_left = max(ZERO, funded_left - funded_amount)
        requires_invoice = bool(row.get("requires_invoice"))
        invoice_ready = (not requires_invoice) or row.get("invoice_ready_at") is not None
        due = _parse_date(row.get("due_date"))
        if not triggered:
            status, label, tone = "pending_trigger", "待触发", "neutral"
        elif not invoice_ready:
            status, label, tone = "invoice_precondition", "待付款前置发票", "warning"
        elif funded_amount + EPS < planned:
            if due and due < today:
                status, label, tone = "payment_overdue", "已逾期未付", "danger"
            else:
                status, label, tone = "payment_pending", "待付款", "warning"
        else:
            status, label, tone = "paid", "已付款", "good"
        out.append({
            **row,
            "planned_amount": float(planned),
            "funded_amount": float(funded_amount),
            "payment_gap": float(max(ZERO, planned - funded_amount) if triggered else ZERO),
            "triggered": triggered,
            "invoice_ready": invoice_ready,
            "status": status,
            "status_label": label,
            "status_tone": tone,
        })
    return out


def _enriched_pools(db: Session) -> list[dict]:
    if not _tables_ready(db):
        return []
    base = _base_pool_rows(db)
    settings = _settings_map(db)
    installments = _installments_map(db)
    funded = _aggregate_map(db, """
        SELECT access_item_id, COALESCE(SUM(funded_amount), 0) AS amount
        FROM cf_rd_prepayment_fundings GROUP BY access_item_id
    """)
    deducted = _aggregate_map(db, """
        SELECT access_item_id, COALESCE(SUM(deduction_amount), 0) AS amount
        FROM cf_rd_prepayment_deductions GROUP BY access_item_id
    """)
    held_invoice = _aggregate_map(db, """
        SELECT funding.access_item_id, COALESCE(SUM(allocation.allocated_amount), 0) AS amount
        FROM cf_rd_prepayment_invoice_allocations AS allocation
        JOIN cf_rd_prepayment_fundings AS funding ON funding.id = allocation.funding_id
        GROUP BY funding.access_item_id
    """)
    refunded = _aggregate_map(db, """
        SELECT access_item_id, COALESCE(SUM(refund_amount), 0) AS amount
        FROM cf_rd_prepayment_refunds GROUP BY access_item_id
    """)
    released = _aggregate_map(db, """
        SELECT access_item_id, COALESCE(SUM(released_amount), 0) AS amount
        FROM cf_rd_prepayment_invoice_releases GROUP BY access_item_id
    """)

    out: list[dict] = []
    for row in base:
        access_id = str(row["access_item_id"])
        agreed = max(ZERO, _money(row.get("prepayment_agreed_amount")))
        funding = funded.get(access_id, ZERO)
        used = deducted.get(access_id, ZERO)
        refund = refunded.get(access_id, ZERO)
        current_invoice = held_invoice.get(access_id, ZERO)
        released_invoice = released.get(access_id, ZERO)
        invoice_received = current_invoice + released_invoice
        setting = settings.get(access_id, {})
        strict = bool(setting.get("strict_mode"))
        frozen = setting.get("frozen_at") is not None
        plan_rows = installments.get(access_id, [])
        plan_total = sum((_money(item.get("planned_amount")) for item in plan_rows), ZERO)
        triggered_rows = [item for item in plan_rows if item.get("triggered_at") is not None]
        triggered_total = sum((_money(item.get("planned_amount")) for item in triggered_rows), ZERO)
        invoice_blocked = sum((
            _money(item.get("planned_amount"))
            for item in triggered_rows
            if bool(item.get("requires_invoice")) and item.get("invoice_ready_at") is None
        ), ZERO)
        eligible_total = sum((
            _money(item.get("planned_amount"))
            for item in triggered_rows
            if not bool(item.get("requires_invoice")) or item.get("invoice_ready_at") is not None
        ), ZERO)
        overdue_amount = sum((
            _money(item.get("planned_amount"))
            for item in triggered_rows
            if (not bool(item.get("requires_invoice")) or item.get("invoice_ready_at") is not None)
            and (_parse_date(item.get("due_date")) or date.max) < date.today()
        ), ZERO)
        if strict:
            effective_cap = min(agreed, funding)
        else:
            effective_cap = min(agreed, funding) if funding > EPS else agreed
        available = max(ZERO, effective_cap - used - refund)
        funding_gap = ZERO if frozen else max(ZERO, (triggered_total if strict else agreed) - funding)
        untriggered = max(ZERO, plan_total - triggered_total) if strict else ZERO
        refund_due = max(ZERO, funding - used - refund) if frozen else ZERO
        shortfall = max(ZERO, used + refund - funding) if (strict or funding > EPS) else ZERO
        invoice_gap = max(ZERO, funding - invoice_received)
        status, label, tone = _pool_status(
            strict_mode=strict,
            frozen=frozen,
            plan_total=plan_total,
            triggered_total=triggered_total,
            invoice_blocked=invoice_blocked,
            funding_gap=funding_gap,
            overdue_amount=overdue_amount,
            invoice_gap=invoice_gap,
            funded=funding,
            deducted=used,
            available=available,
            refund_due=refund_due,
            refunded=refund,
            shortfall=shortfall,
        )
        out.append({
            **row,
            "prepayment_agreed_amount": float(agreed),
            "actual_funded_amount": float(funding),
            "deducted_amount": float(used),
            "refunded_amount": float(refund),
            "available_balance": float(available),
            "funding_gap": float(funding_gap),
            "funding_shortfall": float(shortfall),
            "plan_total": float(plan_total),
            "triggered_amount": float(triggered_total),
            "eligible_payment_amount": float(eligible_total),
            "untriggered_amount": float(untriggered),
            "invoice_precondition_amount": float(invoice_blocked),
            "overdue_amount": float(overdue_amount),
            "invoice_held_amount": float(current_invoice),
            "invoice_released_amount": float(released_invoice),
            "invoice_received_amount": float(invoice_received),
            "invoice_gap": float(invoice_gap),
            "refund_due": float(refund_due),
            "strict_mode": strict,
            "legacy_mode": not strict,
            "display_name": setting.get("display_name") or "研发预付款",
            "invoice_policy": setting.get("invoice_policy") or "separate",
            "frozen": frozen,
            "frozen_at": setting.get("frozen_at"),
            "freeze_reason": setting.get("freeze_reason") or "",
            "status": status,
            "status_label": label,
            "status_tone": tone,
        })
    return out


def _pool_or_404(db: Session, access_item_id: str) -> dict:
    pool = next((item for item in _enriched_pools(db) if str(item.get("access_item_id")) == str(access_item_id)), None)
    if pool is None:
        raise HTTPException(status_code=404, detail="研发预付款产品不存在")
    return pool


def _bank_income(tx: BankTransaction) -> Decimal:
    income = abs(_money(tx.income_amount))
    expense = abs(_money(tx.expense_amount))
    if income > EPS and expense <= EPS:
        return income
    if expense > EPS:
        return ZERO
    if str(tx.type or "") in {"collection_register", "statement_import"}:
        return abs(_money(tx.amount))
    return ZERO


def _refund_candidates(db: Session, pool: dict, limit: int = 6) -> list[dict]:
    refund_due = _money(pool.get("refund_due"))
    if refund_due <= EPS:
        return []
    rows = db.execute(
        select(BankTransaction)
        .order_by(BankTransaction.trade_date.desc(), BankTransaction.created_at.desc())
        .limit(800)
    ).scalars().all()
    used_map = {
        str(row["bank_transaction_id"]): _money(row["amount"])
        for row in db.execute(text("""
            SELECT bank_transaction_id, COALESCE(SUM(refund_amount), 0) AS amount
            FROM cf_rd_prepayment_refunds GROUP BY bank_transaction_id
        """)).mappings().all()
    }
    candidates: list[dict] = []
    for tx in rows:
        if _regularly_linked(db, tx):
            continue
        income = _bank_income(tx)
        available = max(ZERO, income - used_map.get(str(tx.id), ZERO))
        if available <= EPS:
            continue
        payer = tx.payer_name or tx.payee_name or ""
        name_score = max(
            _match_score(payer, pool.get("counterparty")),
            _match_score(payer, pool.get("partner_name")),
            _match_score(payer, pool.get("partner_short_name")),
        )
        score = name_score
        reasons: list[str] = []
        if name_score >= 100:
            reasons.append("退款方与合同合作方完全一致")
        elif name_score >= 80:
            reasons.append("退款方与合同合作方名称高度接近")
        summary = str(tx.summary or tx.purpose or tx.remark or "").lower()
        if any(token in summary for token in ("退款", "退回", "返还", "refund")):
            score += 15
            reasons.append("流水摘要包含退款特征")
        gap = abs(available - refund_due)
        if gap <= EPS:
            score += 20
            reasons.append("流水金额与当前应退余额一致")
        elif gap <= max(Decimal("100"), refund_due * Decimal("0.03")):
            score += 10
            reasons.append("流水金额与当前应退余额接近")
        elif available <= refund_due + EPS:
            score += 5
            reasons.append("流水金额可作为部分退款")
        if score < 55:
            continue
        candidates.append({
            "id": str(tx.id),
            "trade_date": tx.trade_date,
            "transaction_no": tx.transaction_no,
            "payer_name": payer,
            "summary": tx.summary or tx.purpose or tx.remark or "",
            "source_bank": tx.source_bank,
            "income_amount": float(income),
            "available_amount": float(available),
            "suggested_refund_amount": float(min(available, refund_due)),
            "match_score": min(100, score),
            "reasons": reasons,
        })
    candidates.sort(key=lambda item: (item["match_score"], item["trade_date"] or ""), reverse=True)
    return candidates[:limit]


@router.get("/workbench")
def workbench(db: Session = Depends(get_db)) -> dict:
    if not _tables_ready(db):
        return {"schema_ready": False, "stats": {}, "items": []}
    items = _enriched_pools(db)
    stats = {
        "pool_count": len(items),
        "agreed_amount": round(sum(float(item["prepayment_agreed_amount"]) for item in items), 2),
        "triggered_amount": round(sum(float(item["triggered_amount"]) for item in items), 2),
        "untriggered_amount": round(sum(float(item["untriggered_amount"]) for item in items), 2),
        "funded_amount": round(sum(float(item["actual_funded_amount"]) for item in items), 2),
        "deducted_amount": round(sum(float(item["deducted_amount"]) for item in items), 2),
        "refunded_amount": round(sum(float(item["refunded_amount"]) for item in items), 2),
        "available_amount": round(sum(float(item["available_balance"]) for item in items), 2),
        "funding_gap": round(sum(float(item["funding_gap"]) for item in items), 2),
        "refund_due": round(sum(float(item["refund_due"]) for item in items), 2),
        "invoice_gap": round(sum(float(item["invoice_gap"]) for item in items), 2),
        "strict_pool_count": sum(1 for item in items if item["strict_mode"]),
        "legacy_pool_count": sum(1 for item in items if item["legacy_mode"]),
        "attention_count": sum(1 for item in items if item["status"] in {
            "funding_shortfall", "plan_pending", "invoice_precondition", "payment_overdue",
            "payment_pending", "invoice_pending", "refund_pending", "refund_partial"
        }),
    }
    return {"schema_ready": True, "stats": stats, "items": items}


@router.get("/pools/{access_item_id}")
def pool_detail(access_item_id: str, db: Session = Depends(get_db)) -> dict:
    if not _tables_ready(db):
        raise HTTPException(status_code=409, detail="预付款履约结构尚未初始化")
    pool = _pool_or_404(db, access_item_id)
    rows = [dict(row) for row in db.execute(text("""
        SELECT * FROM cf_rd_prepayment_installments
        WHERE access_item_id = :access_item_id
        ORDER BY installment_no, created_at
    """), {"access_item_id": access_item_id}).mappings().all()]
    installments = _installment_presentations(rows, _money(pool.get("actual_funded_amount")))
    refunds = [dict(row) for row in db.execute(text("""
        SELECT refund.*, bank.trade_date, bank.transaction_no,
               bank.payer_name, bank.payee_name,
               COALESCE(bank.summary, bank.purpose, bank.remark, '') AS bank_summary
        FROM cf_rd_prepayment_refunds AS refund
        LEFT JOIN bank_transactions AS bank ON bank.id = refund.bank_transaction_id
        WHERE refund.access_item_id = :access_item_id
        ORDER BY refund.created_at DESC
    """), {"access_item_id": access_item_id}).mappings().all()]
    releases = [dict(row) for row in db.execute(text("""
        SELECT release.*, invoice.invoice_no, invoice.digital_invoice_no,
               invoice.seller_name, bill.statement_no, bill.settlement_month
        FROM cf_rd_prepayment_invoice_releases AS release
        LEFT JOIN invoice_records AS invoice ON invoice.id = release.invoice_id
        LEFT JOIN reconciliation_records AS bill ON bill.id = release.bill_id
        WHERE release.access_item_id = :access_item_id
        ORDER BY release.created_at DESC
    """), {"access_item_id": access_item_id}).mappings().all()]
    return {
        "pool": pool,
        "installments": installments,
        "refunds": [{**row, "refund_amount": float(_money(row.get("refund_amount")))} for row in refunds],
        "invoice_releases": [{**row, "released_amount": float(_money(row.get("released_amount")))} for row in releases],
        "refund_candidates": _refund_candidates(db, pool),
    }


@router.put("/pools/{access_item_id}/settings")
def save_settings(
    access_item_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    pool = _pool_or_404(db, access_item_id)
    strict_mode = bool(payload.get("strict_mode"))
    invoice_policy = str(payload.get("invoice_policy") or "separate").strip()
    display_name = str(payload.get("display_name") or "研发预付款").strip()[:80] or "研发预付款"
    if invoice_policy not in INVOICE_POLICIES:
        raise HTTPException(status_code=422, detail="发票处理策略不支持")
    if strict_mode and _money(pool.get("deducted_amount")) > _money(pool.get("actual_funded_amount")) + EPS:
        raise HTTPException(status_code=409, detail="历史抵扣尚未补齐真实银行预付款，暂不能切换严格履约模式")
    plan_total = _money(db.execute(text("""
        SELECT COALESCE(SUM(planned_amount), 0) FROM cf_rd_prepayment_installments
        WHERE access_item_id = :access_item_id
    """), {"access_item_id": access_item_id}).scalar_one())
    if plan_total > _money(pool.get("prepayment_agreed_amount")) + EPS:
        raise HTTPException(status_code=409, detail="分期计划总额超过合同约定预付款")
    actor = _actor(user)
    db.execute(text("""
        INSERT INTO cf_rd_prepayment_lifecycle_settings (
          access_item_id, contract_id, strict_mode, display_name, invoice_policy,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          :access_item_id, :contract_id, :strict_mode, :display_name, :invoice_policy,
          :actor, :actor, NOW(), NOW()
        )
        ON CONFLICT (access_item_id) DO UPDATE SET
          contract_id = EXCLUDED.contract_id,
          strict_mode = EXCLUDED.strict_mode,
          display_name = EXCLUDED.display_name,
          invoice_policy = EXCLUDED.invoice_policy,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
    """), {
        "access_item_id": access_item_id,
        "contract_id": pool.get("contract_id") or "",
        "strict_mode": strict_mode,
        "display_name": display_name,
        "invoice_policy": invoice_policy,
        "actor": actor,
    })
    _audit(db, user, access_item_id, "update_settings", "更新研发预付款履约设置", payload, {"contract_id": pool.get("contract_id")})
    db.commit()
    return pool_detail(access_item_id, db)


@router.post("/pools/{access_item_id}/installments")
def create_installment(
    access_item_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    pool = _pool_or_404(db, access_item_id)
    amount = _money(payload.get("planned_amount"))
    if amount <= EPS:
        raise HTTPException(status_code=422, detail="分期金额必须大于 0")
    trigger_type = str(payload.get("trigger_type") or "manual").strip()
    if trigger_type not in TRIGGER_TYPES:
        raise HTTPException(status_code=422, detail="触发条件类型不支持")
    due_days = int(payload.get("payment_due_days") or 0)
    if due_days < 0 or due_days > 365:
        raise HTTPException(status_code=422, detail="付款期限应为 0-365 个工作日")
    current_total = _money(db.execute(text("""
        SELECT COALESCE(SUM(planned_amount), 0) FROM cf_rd_prepayment_installments
        WHERE access_item_id = :access_item_id
    """), {"access_item_id": access_item_id}).scalar_one())
    agreed = _money(pool.get("prepayment_agreed_amount"))
    if current_total + amount > agreed + EPS:
        raise HTTPException(status_code=409, detail=f"分期计划总额不能超过合同预付款 ¥{agreed:.2f}")
    next_no = int(db.execute(text("""
        SELECT COALESCE(MAX(installment_no), 0) + 1 FROM cf_rd_prepayment_installments
        WHERE access_item_id = :access_item_id
    """), {"access_item_id": access_item_id}).scalar_one())
    installment_id = str(uuid4())
    actor = _actor(user)
    db.execute(text("""
        INSERT INTO cf_rd_prepayment_installments (
          id, access_item_id, contract_id, installment_no, installment_name,
          planned_amount, trigger_type, trigger_note, payment_due_days,
          requires_invoice, note, created_by, updated_by
        ) VALUES (
          :id, :access_item_id, :contract_id, :installment_no, :installment_name,
          :planned_amount, :trigger_type, :trigger_note, :payment_due_days,
          :requires_invoice, :note, :actor, :actor
        )
    """), {
        "id": installment_id,
        "access_item_id": access_item_id,
        "contract_id": pool.get("contract_id") or "",
        "installment_no": next_no,
        "installment_name": str(payload.get("installment_name") or f"第{next_no}期")[:80],
        "planned_amount": amount,
        "trigger_type": trigger_type,
        "trigger_note": str(payload.get("trigger_note") or "")[:500],
        "payment_due_days": due_days,
        "requires_invoice": bool(payload.get("requires_invoice", True)),
        "note": str(payload.get("note") or "")[:1000],
        "actor": actor,
    })
    _audit(db, user, access_item_id, "create_installment", f"新增预付款第 {next_no} 期计划", payload, {"installment_id": installment_id})
    db.commit()
    return pool_detail(access_item_id, db)


@router.put("/installments/{installment_id}")
def update_installment(
    installment_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    row = db.execute(text("SELECT * FROM cf_rd_prepayment_installments WHERE id = :id FOR UPDATE"), {"id": installment_id}).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="预付款分期不存在")
    if row.get("triggered_at") is not None:
        raise HTTPException(status_code=409, detail="已触发的分期不能修改金额或条件")
    access_item_id = str(row["access_item_id"])
    pool = _pool_or_404(db, access_item_id)
    amount = _money(payload.get("planned_amount", row.get("planned_amount")))
    if amount <= EPS:
        raise HTTPException(status_code=422, detail="分期金额必须大于 0")
    trigger_type = str(payload.get("trigger_type", row.get("trigger_type") or "manual"))
    if trigger_type not in TRIGGER_TYPES:
        raise HTTPException(status_code=422, detail="触发条件类型不支持")
    due_days = int(payload.get("payment_due_days", row.get("payment_due_days") or 0))
    other_total = _money(db.execute(text("""
        SELECT COALESCE(SUM(planned_amount), 0) FROM cf_rd_prepayment_installments
        WHERE access_item_id = :access_item_id AND id <> :id
    """), {"access_item_id": access_item_id, "id": installment_id}).scalar_one())
    if other_total + amount > _money(pool.get("prepayment_agreed_amount")) + EPS:
        raise HTTPException(status_code=409, detail="修改后分期计划总额超过合同约定预付款")
    db.execute(text("""
        UPDATE cf_rd_prepayment_installments SET
          installment_name = :installment_name,
          planned_amount = :planned_amount,
          trigger_type = :trigger_type,
          trigger_note = :trigger_note,
          payment_due_days = :payment_due_days,
          requires_invoice = :requires_invoice,
          note = :note,
          updated_by = :actor,
          updated_at = NOW()
        WHERE id = :id
    """), {
        "id": installment_id,
        "installment_name": str(payload.get("installment_name", row.get("installment_name") or ""))[:80],
        "planned_amount": amount,
        "trigger_type": trigger_type,
        "trigger_note": str(payload.get("trigger_note", row.get("trigger_note") or ""))[:500],
        "payment_due_days": due_days,
        "requires_invoice": bool(payload.get("requires_invoice", row.get("requires_invoice"))),
        "note": str(payload.get("note", row.get("note") or ""))[:1000],
        "actor": _actor(user),
    })
    _audit(db, user, access_item_id, "update_installment", "更新预付款分期计划", payload, {"installment_id": installment_id})
    db.commit()
    return pool_detail(access_item_id, db)


@router.delete("/installments/{installment_id}")
def delete_installment(
    installment_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    row = db.execute(text("SELECT * FROM cf_rd_prepayment_installments WHERE id = :id FOR UPDATE"), {"id": installment_id}).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="预付款分期不存在")
    if row.get("triggered_at") is not None:
        raise HTTPException(status_code=409, detail="已触发的分期不能删除")
    access_item_id = str(row["access_item_id"])
    db.execute(text("DELETE FROM cf_rd_prepayment_installments WHERE id = :id"), {"id": installment_id})
    _audit(db, user, access_item_id, "delete_installment", "删除未触发预付款分期", {}, {"installment_id": installment_id})
    db.commit()
    return pool_detail(access_item_id, db)


@router.post("/installments/{installment_id}/trigger")
def trigger_installment(
    installment_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    row = db.execute(text("SELECT * FROM cf_rd_prepayment_installments WHERE id = :id FOR UPDATE"), {"id": installment_id}).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="预付款分期不存在")
    if row.get("triggered_at") is not None:
        return pool_detail(str(row["access_item_id"]), db)
    trigger_date = str(payload.get("trigger_date") or _today_text())[:10]
    due_date = _business_due_date(trigger_date, int(row.get("payment_due_days") or 0))
    db.execute(text("""
        UPDATE cf_rd_prepayment_installments SET
          trigger_date = :trigger_date,
          triggered_at = NOW(),
          triggered_by = :actor,
          due_date = :due_date,
          updated_by = :actor,
          updated_at = NOW()
        WHERE id = :id
    """), {"id": installment_id, "trigger_date": trigger_date, "due_date": due_date, "actor": _actor(user)})
    access_item_id = str(row["access_item_id"])
    _audit(db, user, access_item_id, "trigger_installment", "确认预付款付款节点已触发", {"trigger_date": trigger_date, "due_date": due_date}, {"installment_id": installment_id})
    db.commit()
    return pool_detail(access_item_id, db)


@router.post("/installments/{installment_id}/invoice-ready")
def mark_installment_invoice_ready(
    installment_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    row = db.execute(text("SELECT * FROM cf_rd_prepayment_installments WHERE id = :id FOR UPDATE"), {"id": installment_id}).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="预付款分期不存在")
    if row.get("triggered_at") is None:
        raise HTTPException(status_code=409, detail="付款节点尚未触发，不能确认付款前置发票")
    reference = str(payload.get("invoice_reference") or "")[:200]
    db.execute(text("""
        UPDATE cf_rd_prepayment_installments SET
          invoice_ready_at = NOW(),
          invoice_ready_by = :actor,
          invoice_reference = :reference,
          updated_by = :actor,
          updated_at = NOW()
        WHERE id = :id
    """), {"id": installment_id, "actor": _actor(user), "reference": reference})
    access_item_id = str(row["access_item_id"])
    _audit(db, user, access_item_id, "invoice_precondition_ready", "确认预付款付款前置发票已取得", {"invoice_reference": reference}, {"installment_id": installment_id})
    db.commit()
    return pool_detail(access_item_id, db)


@router.post("/pools/{access_item_id}/freeze")
def freeze_pool(
    access_item_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    pool = _pool_or_404(db, access_item_id)
    reason = str(payload.get("reason") or "合同终止 / 预付款退款处理")[:1000]
    actor = _actor(user)
    db.execute(text("""
        INSERT INTO cf_rd_prepayment_lifecycle_settings (
          access_item_id, contract_id, strict_mode, display_name, invoice_policy,
          frozen_at, freeze_reason, created_by, updated_by
        ) VALUES (
          :access_item_id, :contract_id, FALSE, '研发预付款', 'separate',
          NOW(), :reason, :actor, :actor
        )
        ON CONFLICT (access_item_id) DO UPDATE SET
          frozen_at = NOW(), freeze_reason = EXCLUDED.freeze_reason,
          updated_by = EXCLUDED.updated_by, updated_at = NOW()
    """), {"access_item_id": access_item_id, "contract_id": pool.get("contract_id") or "", "reason": reason, "actor": actor})
    _audit(db, user, access_item_id, "freeze", "冻结研发预付款资金池，停止后续抵扣", {"reason": reason}, {"contract_id": pool.get("contract_id")})
    db.commit()
    return pool_detail(access_item_id, db)


@router.post("/pools/{access_item_id}/unfreeze")
def unfreeze_pool(
    access_item_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    _pool_or_404(db, access_item_id)
    refunded = _money(db.execute(text("SELECT COALESCE(SUM(refund_amount), 0) FROM cf_rd_prepayment_refunds WHERE access_item_id = :id"), {"id": access_item_id}).scalar_one())
    if refunded > EPS:
        raise HTTPException(status_code=409, detail="该资金池已发生退款，不能恢复为正常抵扣状态")
    db.execute(text("""
        UPDATE cf_rd_prepayment_lifecycle_settings
        SET frozen_at = NULL, freeze_reason = '', updated_by = :actor, updated_at = NOW()
        WHERE access_item_id = :id
    """), {"id": access_item_id, "actor": _actor(user)})
    _audit(db, user, access_item_id, "unfreeze", "解除研发预付款冻结")
    db.commit()
    return pool_detail(access_item_id, db)


@router.post("/pools/{access_item_id}/refunds")
def create_refund(
    access_item_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    pool = _pool_or_404(db, access_item_id)
    if not pool.get("frozen"):
        raise HTTPException(status_code=409, detail="登记退款前必须先冻结预付款资金池")
    transaction_id = str(payload.get("bank_transaction_id") or "").strip()
    if not transaction_id:
        raise HTTPException(status_code=422, detail="请选择退款银行流水")
    tx = db.execute(select(BankTransaction).where(BankTransaction.id == transaction_id).with_for_update()).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=404, detail="退款银行流水不存在")
    if _regularly_linked(db, tx):
        raise HTTPException(status_code=409, detail="该银行流水已用于普通账单核销，不能重复登记为预付款退款")
    income = _bank_income(tx)
    if income <= EPS:
        raise HTTPException(status_code=422, detail="预付款退款必须关联真实银行收入流水")
    already = _money(db.execute(text("SELECT COALESCE(SUM(refund_amount), 0) FROM cf_rd_prepayment_refunds WHERE bank_transaction_id = :id"), {"id": transaction_id}).scalar_one())
    bank_available = max(ZERO, income - already)
    requested = _money(payload.get("refund_amount") or min(bank_available, _money(pool.get("refund_due"))))
    if requested <= EPS:
        raise HTTPException(status_code=422, detail="退款登记金额必须大于 0")
    if requested > bank_available + EPS:
        raise HTTPException(status_code=409, detail="登记金额超过该银行收入流水尚未分配金额")
    if requested > _money(pool.get("refund_due")) + EPS:
        raise HTTPException(status_code=409, detail="登记金额超过当前应退预付款余额")
    refund_id = str(uuid4())
    db.execute(text("""
        INSERT INTO cf_rd_prepayment_refunds (
          id, access_item_id, contract_id, bank_transaction_id,
          refund_amount, refund_date, note, created_by
        ) VALUES (
          :id, :access_item_id, :contract_id, :bank_transaction_id,
          :refund_amount, :refund_date, :note, :actor
        )
    """), {
        "id": refund_id,
        "access_item_id": access_item_id,
        "contract_id": pool.get("contract_id") or "",
        "bank_transaction_id": transaction_id,
        "refund_amount": requested,
        "refund_date": tx.trade_date or _today_text(),
        "note": str(payload.get("note") or "")[:1000],
        "actor": _actor(user),
    })
    _audit(db, user, access_item_id, "refund", f"登记研发预付款退款 ¥{requested:.2f}", {"refund_amount": float(requested)}, {"bank_transaction_id": transaction_id, "refund_id": refund_id})
    db.commit()
    return pool_detail(access_item_id, db)


def _invoice_parts(gross_to_allocate: Decimal, invoice_row: dict) -> tuple[Decimal, Decimal, Decimal]:
    gross_total = abs(_money(invoice_row.get("amount_with_tax")))
    net_total = abs(_money(invoice_row.get("invoice_amount")))
    tax_total = abs(_money(invoice_row.get("tax_amount")))
    if gross_total <= EPS:
        gross_total = net_total + tax_total
    if gross_total <= EPS:
        return gross_to_allocate, ZERO, gross_to_allocate
    net = (gross_to_allocate * net_total / gross_total).quantize(CENT, rounding=ROUND_HALF_UP)
    tax = max(ZERO, gross_to_allocate - net)
    return net, tax, gross_to_allocate


@router.post("/pools/{access_item_id}/release-invoices")
def release_invoices_to_deductions(
    access_item_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_permission("funds.manage")),
) -> dict:
    pool = _pool_or_404(db, access_item_id)
    if str(pool.get("invoice_policy") or "separate") != "release_by_deduction":
        raise HTTPException(status_code=409, detail="当前合同未启用“预付发票随抵扣释放”策略")
    deductions = [dict(row) for row in db.execute(text("""
        SELECT * FROM cf_rd_prepayment_deductions
        WHERE access_item_id = :access_item_id
        ORDER BY created_at ASC, id ASC
    """), {"access_item_id": access_item_id}).mappings().all()]
    allocations = [dict(row) for row in db.execute(text("""
        SELECT allocation.id AS allocation_id, allocation.funding_id,
               allocation.invoice_id, allocation.allocated_amount,
               invoice.invoice_amount, invoice.tax_amount, invoice.amount_with_tax,
               invoice.invoice_date
        FROM cf_rd_prepayment_invoice_allocations AS allocation
        JOIN cf_rd_prepayment_fundings AS funding ON funding.id = allocation.funding_id
        JOIN invoice_records AS invoice ON invoice.id = allocation.invoice_id
        WHERE funding.access_item_id = :access_item_id
        ORDER BY invoice.invoice_date ASC NULLS LAST, allocation.created_at ASC
        FOR UPDATE OF allocation
    """), {"access_item_id": access_item_id}).mappings().all()]
    released_by_deduction = {
        str(row["deduction_id"]): _money(row["amount"])
        for row in db.execute(text("""
            SELECT deduction_id, COALESCE(SUM(released_amount), 0) AS amount
            FROM cf_rd_prepayment_invoice_releases
            WHERE access_item_id = :access_item_id
            GROUP BY deduction_id
        """), {"access_item_id": access_item_id}).mappings().all()
    }
    release_count = 0
    released_total = ZERO
    actor = _actor(user)
    for deduction in deductions:
        deduction_id = str(deduction["id"])
        remaining = max(ZERO, _money(deduction.get("deduction_amount")) - released_by_deduction.get(deduction_id, ZERO))
        if remaining <= EPS:
            continue
        for allocation in allocations:
            held = _money(allocation.get("allocated_amount"))
            if held <= EPS or remaining <= EPS:
                continue
            chunk = min(held, remaining)
            invoice_id = str(allocation["invoice_id"])
            bill_id = str(deduction["bill_id"])
            net, tax, gross = _invoice_parts(chunk, allocation)
            existing = db.execute(text("""
                SELECT * FROM bill_invoice_allocations
                WHERE bill_type = 'rd' AND bill_id = :bill_id AND invoice_id = :invoice_id
                  AND status IN ('suggested', 'confirmed')
                LIMIT 1 FOR UPDATE
            """), {"bill_id": bill_id, "invoice_id": invoice_id}).mappings().first()
            if existing:
                db.execute(text("""
                    UPDATE bill_invoice_allocations SET
                      allocated_net_amount = allocated_net_amount + :net,
                      allocated_tax_amount = allocated_tax_amount + :tax,
                      allocated_gross_amount = allocated_gross_amount + :gross,
                      status = 'confirmed', match_type = 'prepayment_release',
                      match_score = 100, confirmed_by = :actor, confirmed_at = NOW(), updated_at = NOW()
                    WHERE id = :id
                """), {"id": existing["id"], "net": net, "tax": tax, "gross": gross, "actor": actor})
            else:
                db.execute(text("""
                    INSERT INTO bill_invoice_allocations (
                      id, bill_type, bill_id, invoice_id,
                      allocated_net_amount, allocated_tax_amount, allocated_gross_amount,
                      status, match_type, match_score, match_reasons,
                      confirmed_by, confirmed_at
                    ) VALUES (
                      :id, 'rd', :bill_id, :invoice_id,
                      :net, :tax, :gross,
                      'confirmed', 'prepayment_release', 100, CAST(:reasons AS jsonb),
                      :actor, NOW()
                    )
                """), {
                    "id": str(uuid4()), "bill_id": bill_id, "invoice_id": invoice_id,
                    "net": net, "tax": tax, "gross": gross, "actor": actor,
                    "reasons": json.dumps(["研发预付款发票随月度抵扣释放"], ensure_ascii=False),
                })
            new_held = max(ZERO, held - chunk)
            if new_held <= EPS:
                db.execute(text("DELETE FROM cf_rd_prepayment_invoice_allocations WHERE id = :id"), {"id": allocation["allocation_id"]})
            else:
                db.execute(text("UPDATE cf_rd_prepayment_invoice_allocations SET allocated_amount = :amount, updated_at = NOW() WHERE id = :id"), {"id": allocation["allocation_id"], "amount": new_held})
            allocation["allocated_amount"] = new_held
            db.execute(text("""
                INSERT INTO cf_rd_prepayment_invoice_releases (
                  id, access_item_id, contract_id, deduction_id, funding_id,
                  invoice_id, bill_id, released_amount, created_by
                ) VALUES (
                  :id, :access_item_id, :contract_id, :deduction_id, :funding_id,
                  :invoice_id, :bill_id, :released_amount, :actor
                )
            """), {
                "id": str(uuid4()), "access_item_id": access_item_id,
                "contract_id": pool.get("contract_id") or "", "deduction_id": deduction_id,
                "funding_id": allocation.get("funding_id") or "", "invoice_id": invoice_id,
                "bill_id": bill_id, "released_amount": chunk, "actor": actor,
            })
            remaining -= chunk
            released_total += chunk
            release_count += 1
        if remaining > EPS and all(_money(item.get("allocated_amount")) <= EPS for item in allocations):
            break
    if released_total > EPS:
        _audit(db, user, access_item_id, "release_invoice", f"释放预付发票覆盖研发月结 ¥{released_total:.2f}", {"released_amount": float(released_total), "release_count": release_count})
    db.commit()
    return {"released_amount": float(released_total), "release_count": release_count, "detail": pool_detail(access_item_id, db)}
