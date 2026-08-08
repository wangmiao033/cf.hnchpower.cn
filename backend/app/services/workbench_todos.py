"""今日待办中心：把高频财务动作聚合成一次服务端查询。"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.orm import Session

from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.channel import ChannelRecord
from app.models.invoice import InvoiceRecord
from app.models.reconciliation import ReconciliationRecord
from app.services.bank_auto_reconciliation import build_dashboard as build_bank_dashboard
from app.services.rd_bank_payment_aggregate import (
    aggregate_rd_payments_for_ids,
    fill_payable_for_row,
)

EPS = 0.01
ACTIVE_ALLOCATION_STATUSES = ("suggested", "confirmed")
BLOCKED_BILL_STATUSES = {
    "cancelled",
    "canceled",
    "deleted",
    "void",
    "archived",
    "作废",
    "已取消",
    "已删除",
    "已归档",
}
REVIEW_PENDING_STATUSES = {"draft", "pending", ""}
FINAL_BILL_STATUSES = {"completed", "settled", "reconciled", "verified"}
CONTRACT_TERMINAL_STATUSES = {
    "已终止",
    "已完成",
    "已失效",
    "已过期",
    "终止",
    "失效",
    "expired",
    "terminated",
    "completed",
    "cancelled",
    "canceled",
}
CONTRACT_ACTIVE_STATUSES = {
    "履行中",
    "生效",
    "执行中",
    "有效",
    "active",
    "effective",
    "performing",
}


def _num(value: Any) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed == parsed else 0.0


def _status(value: Any) -> str:
    return str(value or "pending").strip().lower()


def _active_bill(row: Any) -> bool:
    return _status(getattr(row, "status", None)) not in BLOCKED_BILL_STATUSES


def _review_pending(row: Any) -> bool:
    return _status(getattr(row, "status", None)) in REVIEW_PENDING_STATUSES


def _post_review(row: Any) -> bool:
    return _active_bill(row) and not _review_pending(row)


def _invoice_gross(invoice: InvoiceRecord) -> float:
    gross = _num(invoice.amount_with_tax)
    return gross if abs(gross) > 0.005 else _num(invoice.invoice_amount) + _num(invoice.tax_amount)


def _effective_invoice_allocations(
    db: Session,
    bill_refs: list[tuple[str, str]],
) -> dict[tuple[str, str], float]:
    if not bill_refs:
        return {}

    rd_ids = [bill_id for bill_type, bill_id in bill_refs if bill_type == "rd"]
    channel_ids = [bill_id for bill_type, bill_id in bill_refs if bill_type == "channel"]
    predicates = []
    if rd_ids:
        predicates.append(
            and_(
                BillInvoiceAllocation.bill_type == "rd",
                BillInvoiceAllocation.bill_id.in_(rd_ids),
            )
        )
    if channel_ids:
        predicates.append(
            and_(
                BillInvoiceAllocation.bill_type == "channel",
                BillInvoiceAllocation.bill_id.in_(channel_ids),
            )
        )
    if not predicates:
        return {}

    allocations = db.execute(
        select(BillInvoiceAllocation).where(
            or_(*predicates),
            BillInvoiceAllocation.status.in_(ACTIVE_ALLOCATION_STATUSES),
        )
    ).scalars().all()
    if not allocations:
        return {}

    invoice_ids = list({str(row.invoice_id) for row in allocations})
    invoices = {
        str(row.id): row
        for row in db.execute(
            select(InvoiceRecord).where(InvoiceRecord.id.in_(invoice_ids))
        ).scalars().all()
    }
    red_totals = {
        str(original_id): _num(total)
        for original_id, total in db.execute(
            select(
                InvoiceRecord.original_invoice_id,
                func.coalesce(func.sum(func.abs(InvoiceRecord.amount_with_tax)), 0),
            ).where(
                InvoiceRecord.original_invoice_id.in_(invoice_ids),
                InvoiceRecord.tax_status == "red",
            ).group_by(InvoiceRecord.original_invoice_id)
        ).all()
        if original_id
    }

    allocated: dict[tuple[str, str], float] = defaultdict(float)
    for row in allocations:
        invoice = invoices.get(str(row.invoice_id))
        if invoice is None:
            continue
        tax_status = str(invoice.tax_status or "normal").strip().lower()
        if tax_status in {"red", "void"} or invoice.status == "作废":
            continue
        invoice_gross = abs(_invoice_gross(invoice))
        red_ratio = min(1.0, red_totals.get(str(invoice.id), 0) / invoice_gross) if invoice_gross else 0
        allocated[(str(row.bill_type), str(row.bill_id))] += _num(row.allocated_gross_amount) * (1 - red_ratio)
    return {key: round(value, 2) for key, value in allocated.items()}


def _as_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = str(value).strip()[:10]
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _contract_risk_flags(
    end_date: Any,
    performance_status: Any,
    today: date,
) -> tuple[bool, bool]:
    """Return (expiring_within_30_days, expired_but_still_active)."""
    resolved_end = _as_date(end_date)
    if resolved_end is None:
        return False, False
    performance = str(performance_status or "").strip().lower()
    if today <= resolved_end <= today + timedelta(days=30):
        return performance not in CONTRACT_TERMINAL_STATUSES, False
    if resolved_end < today and performance in CONTRACT_ACTIVE_STATUSES:
        return False, True
    return False, False


def _load_contract_risk(db: Session, today: date) -> dict[str, int]:
    """读取真实合同台账；老项目没有该表时保持工作台可用。"""
    try:
        relation = db.execute(text("SELECT to_regclass('public.cf_contract_records')")).scalar_one_or_none()
    except Exception:
        return {"expiring_30": 0, "expired_active": 0}
    if not relation:
        return {"expiring_30": 0, "expired_active": 0}

    try:
        rows = db.execute(
            text(
                """
                SELECT id, end_date, performance_status
                FROM cf_contract_records
                WHERE end_date IS NOT NULL
                """
            )
        ).mappings().all()
    except Exception:
        return {"expiring_30": 0, "expired_active": 0}

    expiring = 0
    expired_active = 0
    for row in rows:
        is_expiring, is_expired_active = _contract_risk_flags(
            row.get("end_date"),
            row.get("performance_status"),
            today,
        )
        expiring += int(is_expiring)
        expired_active += int(is_expired_active)
    return {"expiring_30": expiring, "expired_active": expired_active}


def _item(
    key: str,
    label: str,
    count: int,
    *,
    amount: float | None,
    severity: str,
    description: str,
    detail: str | None,
    target: str,
    action_label: str,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "count": max(0, int(count or 0)),
        "amount": round(float(amount), 2) if amount is not None else None,
        "severity": severity,
        "description": description,
        "detail": detail,
        "target": target,
        "action_label": action_label,
    }


def build_workbench_todos(
    db: Session,
    permissions: set[str],
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """按当前用户权限返回真正可处理的待办，不泄露无权限模块数据。"""
    generated_at = now or datetime.now(timezone.utc)
    today = generated_at.date()
    visible_modules: list[str] = []
    items: list[dict[str, Any]] = []

    can_recon = "reconciliation.view" in permissions
    can_funds = "funds.view" in permissions
    can_invoices = "invoices.view" in permissions
    can_contracts = "contracts.view" in permissions
    can_anomalies = "anomalies.view" in permissions

    rd_rows: list[ReconciliationRecord] = []
    channel_rows: list[ChannelRecord] = []
    if can_recon or can_funds or can_invoices or can_anomalies:
        rd_rows = list(db.execute(select(ReconciliationRecord)).scalars().all())
        channel_rows = list(db.execute(select(ChannelRecord)).scalars().all())

    active_rd = [row for row in rd_rows if _active_bill(row)]
    active_channel = [row for row in channel_rows if _active_bill(row)]
    pending_rd = [row for row in active_rd if _review_pending(row)]
    pending_channel = [row for row in active_channel if _review_pending(row)]
    post_review_rd = [row for row in active_rd if _post_review(row)]
    post_review_channel = [row for row in active_channel if _post_review(row)]

    if can_recon:
        visible_modules.append("reconciliation")
        rd_pending_amount = sum(abs(_num(row.settlement_amount)) for row in pending_rd)
        channel_pending_amount = sum(abs(_num(row.settlement_amount)) for row in pending_channel)
        if pending_rd:
            items.append(
                _item(
                    "rd_review",
                    "研发账单待核对",
                    len(pending_rd),
                    amount=rd_pending_amount,
                    severity="warning",
                    description="新录入或退回修改的研发账单需要确认核对。",
                    detail="确认后自动锁单，不需要手工推进其他状态。",
                    target="recon-rd",
                    action_label="去核对",
                )
            )
        if pending_channel:
            items.append(
                _item(
                    "channel_review",
                    "渠道账单待核对",
                    len(pending_channel),
                    amount=channel_pending_amount,
                    severity="warning",
                    description="渠道账单仍处于待核对状态。",
                    detail="确认数据无误后完成核对并锁定。",
                    target="recon-channel",
                    action_label="去核对",
                )
            )

    # 资金待办只针对已完成核对的账单，避免同一张待核对账单同时出现“去核对”和“去付款”。
    rd_payment_states: list[tuple[ReconciliationRecord, float, float, float]] = []
    channel_payment_states: list[tuple[ChannelRecord, float, float, float]] = []
    rd_outstanding_rows: list[tuple[ReconciliationRecord, float, float]] = []
    channel_outstanding_rows: list[tuple[ChannelRecord, float, float]] = []
    if can_funds:
        rd_payment_map = aggregate_rd_payments_for_ids(db, [str(row.id) for row in post_review_rd])
        for row in post_review_rd:
            bill_amount = abs(_num(row.settlement_amount))
            payment = fill_payable_for_row(rd_payment_map.get(str(row.id)), bill_amount)
            paid = max(0.0, float(payment.paid_amount))
            outstanding = max(0.0, float(payment.unpaid_amount))
            rd_payment_states.append((row, bill_amount, paid, outstanding))
            if outstanding > EPS:
                rd_outstanding_rows.append((row, outstanding, paid))

        for row in post_review_channel:
            bill_amount = abs(_num(row.settlement_amount))
            received = max(0.0, _num(row.received_amount))
            outstanding = max(0.0, bill_amount - received)
            channel_payment_states.append((row, bill_amount, received, outstanding))
            if outstanding > EPS:
                channel_outstanding_rows.append((row, outstanding, received))

        visible_modules.append("funds")
        rd_payable = sum(item[1] for item in rd_outstanding_rows)
        channel_receivable = sum(item[1] for item in channel_outstanding_rows)
        if rd_outstanding_rows:
            items.append(
                _item(
                    "rd_payable",
                    "研发待付款",
                    len(rd_outstanding_rows),
                    amount=rd_payable,
                    severity="warning",
                    description="已核对研发账单仍有未付余额。",
                    detail="进入银行核销后可优先处理高置信付款匹配。",
                    target="bank-reconciliation",
                    action_label="去付款核销",
                )
            )
        if channel_outstanding_rows:
            items.append(
                _item(
                    "channel_receivable",
                    "渠道待收款",
                    len(channel_outstanding_rows),
                    amount=channel_receivable,
                    severity="warning",
                    description="已核对渠道账单仍有未收余额。",
                    detail="银行流水匹配后会自动更新已收金额。",
                    target="bank-reconciliation",
                    action_label="去回款核销",
                )
            )

        try:
            bank_dashboard = build_bank_dashboard(db, limit=500)
        except Exception:
            bank_dashboard = {"stats": {}, "suggestions": []}
        reviewed_refs = {
            *(('rd', str(row.id)) for row in post_review_rd),
            *(('channel', str(row.id)) for row in post_review_channel),
        }
        high_suggestions = []
        for suggestion in bank_dashboard.get("suggestions") or []:
            if suggestion.get("confidence_level") != "high":
                continue
            candidates = suggestion.get("candidates") or []
            top_candidate = candidates[0] if candidates and isinstance(candidates[0], dict) else {}
            top_ref = (str(top_candidate.get("bill_type") or ""), str(top_candidate.get("bill_id") or ""))
            if top_ref in reviewed_refs:
                high_suggestions.append(suggestion)
        if high_suggestions:
            items.append(
                _item(
                    "bank_auto_ready",
                    "银行高置信待核销",
                    len(high_suggestions),
                    amount=sum(_num(row.get("amount")) for row in high_suggestions),
                    severity="info",
                    description="系统已找到已核对账单的高置信匹配，可直接人工确认。",
                    detail="只展示最近导入流水中的高置信建议；低置信流水仍需人工判断。",
                    target="bank-reconciliation",
                    action_label="去确认核销",
                )
            )

    invoice_over_keys: set[tuple[str, str]] = set()
    input_gap_count = output_gap_count = 0
    input_gap_amount = output_gap_amount = 0.0
    if can_invoices or can_anomalies:
        refs = [
            *(('rd', str(row.id)) for row in post_review_rd),
            *(('channel', str(row.id)) for row in post_review_channel),
        ]
        allocation_map = _effective_invoice_allocations(db, refs)
        for row in post_review_rd:
            bill_amount = abs(_num(row.settlement_amount))
            allocated = allocation_map.get(("rd", str(row.id)), 0.0)
            remaining = max(0.0, bill_amount - allocated)
            if remaining > EPS:
                input_gap_count += 1
                input_gap_amount += remaining
            if allocated > bill_amount + EPS:
                invoice_over_keys.add(("rd", str(row.id)))
        for row in post_review_channel:
            bill_amount = abs(_num(row.settlement_amount))
            allocated = allocation_map.get(("channel", str(row.id)), 0.0)
            remaining = max(0.0, bill_amount - allocated)
            if remaining > EPS:
                output_gap_count += 1
                output_gap_amount += remaining
            if allocated > bill_amount + EPS:
                invoice_over_keys.add(("channel", str(row.id)))

    if can_invoices:
        visible_modules.append("invoices")
        if input_gap_count:
            items.append(
                _item(
                    "input_invoice_gap",
                    "进项发票缺口",
                    input_gap_count,
                    amount=input_gap_amount,
                    severity="warning",
                    description="已核对研发账单尚未被有效进项发票完全覆盖。",
                    detail="红冲和作废发票已从有效覆盖金额中剔除。",
                    target="invoice-input",
                    action_label="去补发票",
                )
            )
        if output_gap_count:
            items.append(
                _item(
                    "output_invoice_gap",
                    "销项发票缺口",
                    output_gap_count,
                    amount=output_gap_amount,
                    severity="warning",
                    description="已核对渠道账单尚未被有效销项发票完全覆盖。",
                    detail="按账单结算金额统计当前未覆盖部分。",
                    target="invoice-manage",
                    action_label="去补发票",
                )
            )

    contract_risk = {"expiring_30": 0, "expired_active": 0}
    if can_contracts or (can_anomalies and can_contracts):
        contract_risk = _load_contract_risk(db, today)
    if can_contracts:
        visible_modules.append("contracts")
        contract_count = contract_risk["expiring_30"] + contract_risk["expired_active"]
        if contract_count:
            items.append(
                _item(
                    "contract_expiry",
                    "合同到期提醒",
                    contract_count,
                    amount=None,
                    severity="critical" if contract_risk["expired_active"] else "warning",
                    description="需要确认续约、终止或补充新合同。",
                    detail=f"30天内到期 {contract_risk['expiring_30']} 份 · 已过期但仍标履行中 {contract_risk['expired_active']} 份",
                    target="contracts",
                    action_label="去看合同",
                )
            )

    risk_keys: set[str] = set()
    risk_exposure = 0.0
    if can_anomalies:
        visible_modules.append("anomalies")
        if can_funds:
            for row, bill_amount, paid, outstanding in rd_payment_states:
                if _status(row.status) in FINAL_BILL_STATUSES and outstanding > EPS:
                    risk_keys.add(f"final-unpaid:rd:{row.id}")
                    risk_exposure += outstanding
                if paid > bill_amount + EPS:
                    risk_keys.add(f"payment-over:rd:{row.id}")
                    risk_exposure += paid - bill_amount
            for row, bill_amount, received, outstanding in channel_payment_states:
                if _status(row.status) in FINAL_BILL_STATUSES and outstanding > EPS:
                    risk_keys.add(f"final-unpaid:channel:{row.id}")
                    risk_exposure += outstanding
                if received > bill_amount + EPS:
                    risk_keys.add(f"payment-over:channel:{row.id}")
                    risk_exposure += received - bill_amount
        if can_invoices:
            risk_keys.update(f"invoice-over:{bill_type}:{bill_id}" for bill_type, bill_id in invoice_over_keys)
        if can_contracts:
            risk_keys.update(f"contract-expired:{index}" for index in range(contract_risk["expired_active"]))
        if risk_keys:
            items.insert(
                0,
                _item(
                    "risk_alerts",
                    "高风险异常",
                    len(risk_keys),
                    amount=risk_exposure if risk_exposure > EPS else None,
                    severity="critical",
                    description="发现已完成但未结清、超额资金/发票或过期履约等高风险信号。",
                    detail="异常中心会给出根因、优先级和处理建议。",
                    target="anomalies",
                    action_label="优先处理",
                ),
            )

    # 风险卡是同一批业务的优先级提示，不重复计入“今日待办”总数。
    action_items = [item for item in items if item["key"] != "risk_alerts"]
    total_count = sum(int(item["count"]) for item in action_items)
    review_count = len(pending_rd) + len(pending_channel) if can_recon else 0
    receivable_amount = sum(item[1] for item in channel_outstanding_rows) if can_funds else 0
    payable_amount = sum(item[1] for item in rd_outstanding_rows) if can_funds else 0
    invoice_gap_amount = input_gap_amount + output_gap_amount if can_invoices else 0

    return {
        "generated_at": generated_at,
        "summary": {
            "total_count": total_count,
            "urgent_count": len(risk_keys) if can_anomalies else 0,
            "review_count": review_count,
            "receivable_amount": round(receivable_amount, 2),
            "payable_amount": round(payable_amount, 2),
            "invoice_gap_amount": round(invoice_gap_amount, 2),
        },
        "items": items,
        "visible_modules": visible_modules,
    }
