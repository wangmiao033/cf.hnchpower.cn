"""跨模块数据一致性巡检。

只读检查账单、发票、银行核销和归档状态之间是否互相矛盾。
不修改账单金额、不触发状态流转，也不自动修复任何财务事实。
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models.bank_reconciliation_match import BankReconciliationMatch
from app.models.bank_transaction import BankTransaction
from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.channel import ChannelRecord
from app.models.invoice import InvoiceRecord
from app.models.reconciliation import ReconciliationRecord
from app.services.bank_auto_reconciliation import transaction_direction
from app.services.rd_bank_payment_aggregate import aggregate_rd_payments_for_ids, fill_payable_for_row

EPS = 0.01
ACTIVE_ALLOCATION_STATUSES = ("suggested", "confirmed")
ACTIVE_BANK_MATCH_STATUSES = ("confirmed",)
BLOCKED_BILL_STATUSES = {
    "cancelled", "canceled", "deleted", "void", "archived",
    "作废", "已取消", "已删除", "已归档",
}
FINAL_BILL_STATUSES = {"completed", "settled", "reconciled", "verified"}
INVOICE_COMPLETE_STATUSES = {"invoiced", *FINAL_BILL_STATUSES}
SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}


def _num(value: object) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed == parsed else 0.0


def _status(value: object) -> str:
    return str(value or "pending").strip().lower()


def _invoice_gross(invoice: InvoiceRecord) -> float:
    gross = _num(invoice.amount_with_tax)
    return gross if abs(gross) > 0.005 else _num(invoice.invoice_amount) + _num(invoice.tax_amount)


def _invoice_allocatable(invoice: InvoiceRecord) -> bool:
    return str(invoice.tax_status or "normal").strip().lower() not in {"red", "void"} and invoice.status != "作废"


def _bill_amount(bill_type: str, bill) -> float:
    del bill_type
    return round(abs(_num(getattr(bill, "settlement_amount", 0))), 2)


def _bill_number(bill_type: str, bill) -> str:
    raw = str(getattr(bill, "statement_no", None) or "").strip()
    return raw or f"{bill_type.upper()}-{str(getattr(bill, 'id', ''))[:8]}"


def _bill_partner(bill_type: str, bill) -> str:
    value = getattr(bill, "partner_name", None)
    if not value and bill_type == "channel":
        value = getattr(bill, "channel_name", None)
    return str(value or "").strip()


def _issue(
    *,
    key: str,
    severity: str,
    category: str,
    title: str,
    detail: str,
    bill_type: str | None = None,
    bill=None,
    amount: float | None = None,
    target_view: str | None = None,
    source_id: str | None = None,
) -> dict:
    bill_id = str(getattr(bill, "id", "")) if bill is not None else ""
    return {
        "id": key,
        "severity": severity,
        "category": category,
        "title": title,
        "detail": detail,
        "bill_type": bill_type if bill_id else None,
        "bill_id": bill_id or None,
        "bill_number": _bill_number(bill_type or "bill", bill) if bill_id else None,
        "partner_name": _bill_partner(bill_type or "", bill) if bill_id else None,
        "settlement_month": str(getattr(bill, "settlement_month", None) or "") or None if bill_id else None,
        "amount": round(float(amount), 2) if amount is not None else None,
        "target_view": target_view,
        "source_id": source_id,
    }


def _summarize(items: list[dict], bills_scanned: int, allocations_scanned: int, bank_matches_scanned: int, archived_scanned: int) -> dict:
    severity = defaultdict(int)
    categories = defaultdict(int)
    for item in items:
        severity[str(item.get("severity") or "info")] += 1
        categories[str(item.get("category") or "other")] += 1
    return {
        "total": len(items),
        "critical": severity["critical"],
        "warning": severity["warning"],
        "info": severity["info"],
        "healthy": len(items) == 0,
        "bills_scanned": bills_scanned,
        "invoice_allocations_scanned": allocations_scanned,
        "bank_matches_scanned": bank_matches_scanned,
        "archived_bills_scanned": archived_scanned,
        "category_counts": dict(categories),
    }


def build_data_consistency_audit(db: Session, *, limit: int = 500) -> dict:
    """Return cross-module consistency issues without mutating any source fact."""
    rd_rows = list(db.execute(select(ReconciliationRecord)).scalars().all())
    channel_rows = list(db.execute(select(ChannelRecord)).scalars().all())
    bills: dict[tuple[str, str], object] = {
        **{("rd", str(row.id)): row for row in rd_rows},
        **{("channel", str(row.id)): row for row in channel_rows},
    }
    bill_amounts = {key: _bill_amount(key[0], row) for key, row in bills.items()}

    # 资金事实：研发使用现有批量付款聚合；渠道使用账单收款累计字段。
    paid_by_bill: dict[tuple[str, str], float] = {}
    rd_payment_map = aggregate_rd_payments_for_ids(db, [str(row.id) for row in rd_rows]) if rd_rows else {}
    for row in rd_rows:
        key = ("rd", str(row.id))
        payment = fill_payable_for_row(rd_payment_map.get(str(row.id)), bill_amounts[key])
        paid_by_bill[key] = round(max(0.0, _num(payment.paid_amount)), 2)
    for row in channel_rows:
        paid_by_bill[("channel", str(row.id))] = round(max(0.0, abs(_num(row.received_amount))), 2)

    allocation_rows = list(
        db.execute(
            select(BillInvoiceAllocation).where(BillInvoiceAllocation.status.in_(ACTIVE_ALLOCATION_STATUSES))
        ).scalars().all()
    )
    invoice_ids = list({str(row.invoice_id) for row in allocation_rows})
    invoices = {
        str(row.id): row
        for row in (
            db.execute(select(InvoiceRecord).where(InvoiceRecord.id.in_(invoice_ids))).scalars().all()
            if invoice_ids else []
        )
    }
    red_totals = {
        str(original_id): _num(total)
        for original_id, total in (
            db.execute(
                select(
                    InvoiceRecord.original_invoice_id,
                    func.coalesce(func.sum(func.abs(InvoiceRecord.amount_with_tax)), 0),
                ).where(
                    InvoiceRecord.original_invoice_id.in_(invoice_ids),
                    InvoiceRecord.tax_status == "red",
                ).group_by(InvoiceRecord.original_invoice_id)
            ).all()
            if invoice_ids else []
        )
        if original_id
    }

    items: list[dict] = []
    effective_invoice_by_bill: dict[tuple[str, str], float] = defaultdict(float)
    effective_invoice_by_invoice: dict[str, float] = defaultdict(float)
    invoice_capacity: dict[str, float] = {}
    first_bill_by_invoice: dict[str, tuple[str, str]] = {}

    for invoice_id, invoice in invoices.items():
        gross = abs(_invoice_gross(invoice))
        invoice_capacity[invoice_id] = round(max(0.0, gross - red_totals.get(invoice_id, 0.0)), 2)

    for allocation in allocation_rows:
        bill_key = (str(allocation.bill_type), str(allocation.bill_id))
        invoice_id = str(allocation.invoice_id)
        bill = bills.get(bill_key)
        invoice = invoices.get(invoice_id)
        raw_amount = max(0.0, _num(allocation.allocated_gross_amount))
        first_bill_by_invoice.setdefault(invoice_id, bill_key)

        if bill is None:
            items.append(_issue(
                key=f"invoice-orphan-bill:{allocation.id}",
                severity="critical",
                category="reference",
                title="发票分配指向不存在的账单",
                detail=f"分配记录 {allocation.id} 仍为有效状态，但账单 {allocation.bill_type}:{allocation.bill_id} 已不存在。",
                amount=raw_amount,
                target_view="invoice-manage",
                source_id=str(allocation.id),
            ))
            continue
        if invoice is None:
            items.append(_issue(
                key=f"invoice-orphan-invoice:{allocation.id}",
                severity="critical",
                category="reference",
                title="账单存在孤儿发票分配",
                detail=f"账单仍保留分配记录 {allocation.id}，但对应发票 {invoice_id} 已不存在。",
                bill_type=bill_key[0],
                bill=bill,
                amount=raw_amount,
                target_view="invoice-manage" if bill_key[0] == "channel" else "invoice-input",
                source_id=str(allocation.id),
            ))
            continue
        if not _invoice_allocatable(invoice):
            items.append(_issue(
                key=f"invoice-invalid-active:{allocation.id}",
                severity="warning",
                category="invoice",
                title="有效分配仍引用已失效发票",
                detail=f"发票 {getattr(invoice, 'digital_invoice_no', None) or getattr(invoice, 'invoice_no', None) or invoice_id} 已红冲/作废，但分配记录仍处于有效状态。",
                bill_type=bill_key[0],
                bill=bill,
                amount=raw_amount,
                target_view="invoice-manage" if bill_key[0] == "channel" else "invoice-input",
                source_id=invoice_id,
            ))
            continue

        gross = abs(_invoice_gross(invoice))
        red_ratio = min(1.0, red_totals.get(invoice_id, 0.0) / gross) if gross > EPS else 0.0
        effective = raw_amount * (1 - red_ratio)
        effective_invoice_by_bill[bill_key] += effective
        effective_invoice_by_invoice[invoice_id] += effective

    # 单张发票跨多账单分配不得超过红冲后的有效可用金额。
    for invoice_id, allocated in effective_invoice_by_invoice.items():
        capacity = invoice_capacity.get(invoice_id, 0.0)
        if allocated <= capacity + EPS:
            continue
        bill_key = first_bill_by_invoice.get(invoice_id)
        bill = bills.get(bill_key) if bill_key else None
        items.append(_issue(
            key=f"invoice-overused:{invoice_id}",
            severity="critical",
            category="invoice",
            title="发票跨账单分配总额超过可用金额",
            detail=f"该发票有效可用 {capacity:.2f} 元，当前有效分配合计 {allocated:.2f} 元，超出 {allocated - capacity:.2f} 元。",
            bill_type=bill_key[0] if bill_key else None,
            bill=bill,
            amount=allocated - capacity,
            target_view="invoice-manage",
            source_id=invoice_id,
        ))

    bank_matches = list(
        db.execute(
            select(BankReconciliationMatch).where(BankReconciliationMatch.status.in_(ACTIVE_BANK_MATCH_STATUSES))
        ).scalars().all()
    )
    tx_ids = list({str(row.bank_transaction_id) for row in bank_matches})
    transactions = {
        str(row.id): row
        for row in (
            db.execute(select(BankTransaction).where(BankTransaction.id.in_(tx_ids))).scalars().all()
            if tx_ids else []
        )
    }
    bank_by_bill: dict[tuple[str, str], float] = defaultdict(float)
    bank_by_tx: dict[str, float] = defaultdict(float)

    for match in bank_matches:
        bill_key = (str(match.bill_type), str(match.bill_id))
        bill = bills.get(bill_key)
        tx_id = str(match.bank_transaction_id)
        tx = transactions.get(tx_id)
        linked = max(0.0, _num(match.linked_amount))
        if bill is None:
            items.append(_issue(
                key=f"bank-orphan-bill:{match.id}",
                severity="critical",
                category="reference",
                title="银行核销指向不存在的账单",
                detail=f"核销记录 {match.id} 仍为 confirmed，但账单 {match.bill_type}:{match.bill_id} 已不存在。",
                amount=linked,
                target_view="bank-reconciliation",
                source_id=str(match.id),
            ))
        if tx is None:
            items.append(_issue(
                key=f"bank-orphan-transaction:{match.id}",
                severity="critical",
                category="reference",
                title="账单核销引用不存在的银行流水",
                detail=f"核销记录 {match.id} 引用银行流水 {tx_id}，但该流水已不存在。",
                bill_type=bill_key[0] if bill else None,
                bill=bill,
                amount=linked,
                target_view="bank-reconciliation",
                source_id=str(match.id),
            ))
        expected_direction = "collection" if bill_key[0] == "channel" else "payment"
        if bill is not None and str(match.direction) != expected_direction:
            items.append(_issue(
                key=f"bank-direction:{match.id}",
                severity="critical",
                category="funding",
                title="银行核销方向与账单类型冲突",
                detail=f"{bill_key[0] == 'channel' and '渠道应收' or '研发应付'}账单却记录为 {match.direction} 核销，请核对流水方向。",
                bill_type=bill_key[0],
                bill=bill,
                amount=linked,
                target_view="bank-reconciliation",
                source_id=str(match.id),
            ))
        if tx is not None:
            tx_direction, _, _ = transaction_direction(tx)
            if tx_direction != "unknown" and str(match.direction) != tx_direction:
                items.append(_issue(
                    key=f"bank-tx-direction:{match.id}",
                    severity="warning",
                    category="funding",
                    title="核销方向与银行流水收支方向不一致",
                    detail=f"银行流水判断为 {tx_direction}，但核销记录为 {match.direction}。",
                    bill_type=bill_key[0] if bill else None,
                    bill=bill,
                    amount=linked,
                    target_view="bank-reconciliation",
                    source_id=tx_id,
                ))
        if bill is not None:
            bank_by_bill[bill_key] += linked
        if tx is not None:
            bank_by_tx[tx_id] += linked

    for tx_id, allocated in bank_by_tx.items():
        tx = transactions.get(tx_id)
        if tx is None:
            continue
        _, tx_amount, _ = transaction_direction(tx)
        if tx_amount > EPS and allocated > tx_amount + EPS:
            items.append(_issue(
                key=f"bank-overallocated:{tx_id}",
                severity="critical",
                category="funding",
                title="银行流水核销总额超过流水金额",
                detail=f"流水金额 {tx_amount:.2f} 元，当前 confirmed 核销合计 {allocated:.2f} 元，超出 {allocated - tx_amount:.2f} 元。",
                amount=allocated - tx_amount,
                target_view="bank-reconciliation",
                source_id=tx_id,
            ))

    archive_rows = list(
        db.execute(
            text("SELECT bill_type, bill_id, archived_at FROM bill_archive_states")
        ).mappings().all()
    )
    archived_keys = {(str(row["bill_type"]), str(row["bill_id"])) for row in archive_rows}
    for row in archive_rows:
        key = (str(row["bill_type"]), str(row["bill_id"]))
        bill = bills.get(key)
        if bill is None:
            items.append(_issue(
                key=f"archive-orphan:{key[0]}:{key[1]}",
                severity="warning",
                category="reference",
                title="归档状态指向不存在的账单",
                detail=f"归档表仍保留 {key[0]}:{key[1]}，但原账单已不存在。",
                target_view="recon-channel" if key[0] == "channel" else "recon-rd",
                source_id=key[1],
            ))

    # 账单级一致性：状态、发票、资金、归档必须彼此相容。
    for key, bill in bills.items():
        bill_type, bill_id = key
        status_value = _status(getattr(bill, "status", None))
        amount = bill_amounts.get(key, 0.0)
        paid = paid_by_bill.get(key, 0.0)
        invoiced = round(effective_invoice_by_bill.get(key, 0.0), 2)
        bank_linked = round(bank_by_bill.get(key, 0.0), 2)
        is_blocked = status_value in BLOCKED_BILL_STATUSES
        is_archived = key in archived_keys

        if amount > EPS and invoiced > amount + EPS:
            items.append(_issue(
                key=f"bill-invoice-over:{bill_type}:{bill_id}",
                severity="critical",
                category="invoice",
                title="账单发票覆盖超过账单金额",
                detail=f"账单金额 {amount:.2f} 元，当前有效发票分配 {invoiced:.2f} 元，超出 {invoiced - amount:.2f} 元。",
                bill_type=bill_type,
                bill=bill,
                amount=invoiced - amount,
                target_view="invoice-manage" if bill_type == "channel" else "invoice-input",
            ))
        if amount > EPS and paid > amount + EPS:
            items.append(_issue(
                key=f"bill-funding-over:{bill_type}:{bill_id}",
                severity="critical",
                category="funding",
                title="账单累计收付款超过账单金额",
                detail=f"账单金额 {amount:.2f} 元，累计已收/已付 {paid:.2f} 元，超出 {paid - amount:.2f} 元。",
                bill_type=bill_type,
                bill=bill,
                amount=paid - amount,
                target_view="bank-reconciliation",
            ))
        if amount > EPS and bank_linked > amount + EPS:
            items.append(_issue(
                key=f"bill-bank-over:{bill_type}:{bill_id}",
                severity="critical",
                category="funding",
                title="账单银行 allocation 超过账单金额",
                detail=f"账单金额 {amount:.2f} 元，confirmed 银行核销分配 {bank_linked:.2f} 元。",
                bill_type=bill_type,
                bill=bill,
                amount=bank_linked - amount,
                target_view="bank-reconciliation",
            ))

        if is_blocked:
            if invoiced > EPS:
                items.append(_issue(
                    key=f"blocked-invoice:{bill_type}:{bill_id}",
                    severity="critical",
                    category="lifecycle",
                    title="作废账单仍存在有效发票分配",
                    detail=f"账单状态为 {status_value}，但仍有 {invoiced:.2f} 元有效发票分配，应先解除关联或核对历史迁移。",
                    bill_type=bill_type,
                    bill=bill,
                    amount=invoiced,
                    target_view="invoice-manage" if bill_type == "channel" else "invoice-input",
                ))
            if paid > EPS or bank_linked > EPS:
                linked = max(paid, bank_linked)
                items.append(_issue(
                    key=f"blocked-funding:{bill_type}:{bill_id}",
                    severity="critical",
                    category="lifecycle",
                    title="作废账单仍存在资金事实",
                    detail=f"账单状态为 {status_value}，但仍有 {linked:.2f} 元收付款/银行核销事实，请核对是否应恢复账单或撤销关联。",
                    bill_type=bill_type,
                    bill=bill,
                    amount=linked,
                    target_view="bank-reconciliation",
                ))
            continue

        if status_value in INVOICE_COMPLETE_STATUSES and amount > EPS and invoiced + EPS < amount:
            items.append(_issue(
                key=f"status-invoice-gap:{bill_type}:{bill_id}",
                severity="critical" if status_value == "invoiced" else "warning",
                category="lifecycle",
                title="账单状态与发票覆盖不一致",
                detail=f"账单状态为 {status_value}，但发票仅覆盖 {invoiced:.2f}/{amount:.2f} 元，仍差 {amount - invoiced:.2f} 元。",
                bill_type=bill_type,
                bill=bill,
                amount=amount - invoiced,
                target_view="invoice-manage" if bill_type == "channel" else "invoice-input",
            ))

        if is_archived:
            if amount > EPS and paid + EPS < amount:
                items.append(_issue(
                    key=f"archive-funding-gap:{bill_type}:{bill_id}",
                    severity="critical",
                    category="archive",
                    title="已归档账单出现资金缺口",
                    detail=f"账单已归档，但累计已收/已付 {paid:.2f}/{amount:.2f} 元，仍差 {amount - paid:.2f} 元。",
                    bill_type=bill_type,
                    bill=bill,
                    amount=amount - paid,
                    target_view="bank-reconciliation",
                ))
            if amount > EPS and invoiced + EPS < amount:
                items.append(_issue(
                    key=f"archive-invoice-gap:{bill_type}:{bill_id}",
                    severity="warning",
                    category="archive",
                    title="已归档账单发票未完整覆盖",
                    detail=f"账单已归档，但发票覆盖 {invoiced:.2f}/{amount:.2f} 元，建议核对归档依据。",
                    bill_type=bill_type,
                    bill=bill,
                    amount=amount - invoiced,
                    target_view="invoice-manage" if bill_type == "channel" else "invoice-input",
                ))
        elif status_value in FINAL_BILL_STATUSES and amount > EPS and paid + EPS < amount:
            items.append(_issue(
                key=f"final-funding-gap:{bill_type}:{bill_id}",
                severity="critical",
                category="lifecycle",
                title="已完成账单仍存在资金缺口",
                detail=f"账单状态为 {status_value}，但累计已收/已付 {paid:.2f}/{amount:.2f} 元，仍差 {amount - paid:.2f} 元。",
                bill_type=bill_type,
                bill=bill,
                amount=amount - paid,
                target_view="bank-reconciliation",
            ))

    items.sort(key=lambda item: (
        SEVERITY_ORDER.get(str(item.get("severity")), 9),
        str(item.get("category") or ""),
        str(item.get("title") or ""),
    ))
    summary = _summarize(
        items,
        bills_scanned=len(bills),
        allocations_scanned=len(allocation_rows),
        bank_matches_scanned=len(bank_matches),
        archived_scanned=len(archive_rows),
    )
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "items": items[: max(1, min(int(limit or 500), 1000))],
        "truncated": len(items) > max(1, min(int(limit or 500), 1000)),
    }
