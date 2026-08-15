"""P2 银行资金多对多分配。

bank_reconciliation_matches 继续作为资金分配事实表；bank_transactions 上的
reconciliation_* 仅保留兼容投影，不再作为金额事实来源。
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from app.models.bank_reconciliation_match import BankReconciliationMatch
from app.models.bank_transaction import BankTransaction
from app.models.channel import ChannelReceipt, ChannelRecord
from app.models.reconciliation import ReconciliationRecord
from app.models.user import AuthUser
from app.services.bank_auto_reconciliation import (
    EPS,
    _active_bill,
    _candidate_pool,
    _history_row,
    _raw_confidence,
    _recompute_channel_receipts,
    _score_candidate,
    _transaction_counterparty,
    transaction_direction,
)
from app.services.rd_bank_payment_aggregate import aggregate_rd_payments_for_ids, fill_payable_for_row
from app.services.rd_prepayment import bank_funding_transaction_ids


def _num(value) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed == parsed else 0.0


def active_matches_for_transaction(db: Session, transaction_id: str) -> list[BankReconciliationMatch]:
    return db.execute(
        select(BankReconciliationMatch)
        .where(
            BankReconciliationMatch.bank_transaction_id == transaction_id,
            BankReconciliationMatch.status == "confirmed",
        )
        .order_by(BankReconciliationMatch.confirmed_at.asc(), BankReconciliationMatch.created_at.asc())
    ).scalars().all()


def _totals(matches: list[BankReconciliationMatch]) -> tuple[float, int]:
    return round(sum(max(0.0, _num(item.linked_amount)) for item in matches), 2), len(matches)


def transaction_summary(row: BankTransaction, matches: list[BankReconciliationMatch]) -> dict:
    direction, total, blocked = transaction_direction(row)
    allocated, count = _totals(matches)
    remaining = max(0.0, round(total - allocated, 2))
    status_value = (
        "blocked" if blocked else
        "unallocated" if allocated <= EPS else
        "allocated" if remaining <= EPS else
        "partial"
    )
    return {
        "transaction_id": str(row.id),
        "direction": direction,
        "total_amount": round(total, 2),
        "allocated_amount": allocated,
        "remaining_amount": remaining,
        "allocation_count": count,
        "allocation_status": status_value,
        "bill_numbers": [str(item.bill_number or item.bill_id) for item in matches],
    }


def _p2_candidate(row: BankTransaction, direction: str, remaining: float, candidate: dict) -> dict | None:
    outstanding = max(0.0, _num(candidate.get("outstanding_amount")))
    recommended = min(remaining, outstanding)
    if recommended <= EPS:
        return None
    scored = _score_candidate(row, direction, recommended, candidate)
    if scored is None:
        return None
    reasons = list(scored.get("reasons") or [])
    if remaining > outstanding + EPS:
        reasons.append("该账单结清后仍有流水余额，可继续分配下一张账单")
    elif remaining + EPS < outstanding:
        reasons.append("本次可先部分结算该账单")
    return {
        **scored,
        "recommended_amount": round(recommended, 2),
        "reasons": list(dict.fromkeys(reasons)),
    }


def build_p2_dashboard(db: Session, limit: int = 500) -> dict:
    active_matches = db.execute(
        select(BankReconciliationMatch).where(BankReconciliationMatch.status == "confirmed")
    ).scalars().all()
    grouped: dict[str, list[BankReconciliationMatch]] = defaultdict(list)
    for match in active_matches:
        grouped[str(match.bank_transaction_id)].append(match)

    active_ids = list(grouped)
    predicate = BankTransaction.type == "statement_import"
    if active_ids:
        predicate = or_(predicate, BankTransaction.id.in_(active_ids))
    rows = db.execute(
        select(BankTransaction)
        .where(predicate)
        .order_by(BankTransaction.trade_date.desc(), BankTransaction.created_at.desc())
    ).scalars().all()
    funded_ids = bank_funding_transaction_ids(db)
    if funded_ids:
        rows = [row for row in rows if str(row.id) not in funded_ids]

    pool = _candidate_pool(db)
    suggestions: list[dict] = []
    for row in rows:
        matches = grouped.get(str(row.id), [])
        summary = transaction_summary(row, matches)
        if summary["remaining_amount"] <= EPS:
            continue
        direction, total, blocked = transaction_direction(row)
        remaining = summary["remaining_amount"]
        existing_pairs = {(str(item.bill_type), str(item.bill_id)) for item in matches}
        scored = []
        if not blocked and direction != "unknown" and (not row.currency or str(row.currency).strip().upper() in {"CNY", "RMB"}):
            for candidate in pool.get(direction, []):
                pair = (str(candidate.get("bill_type") or ""), str(candidate.get("bill_id") or ""))
                if pair in existing_pairs:
                    continue
                item = _p2_candidate(row, direction, remaining, candidate)
                if item is not None:
                    scored.append(item)
        scored.sort(key=lambda item: (float(item.get("score") or 0), float(item.get("recommended_amount") or 0)), reverse=True)
        top = scored[0] if scored else None
        second = scored[1] if len(scored) > 1 else None
        top_score = float(top.get("score") or 0) if top else 0
        margin = top_score - (float(second.get("score") or 0) if second else 0)
        level = "high" if top_score >= 80 and margin >= 10 else "medium" if top_score >= 60 else "low" if top else "none"
        suggestions.append({
            "transaction_id": str(row.id),
            "trade_date": row.trade_date,
            "transaction_no": row.transaction_no,
            "direction": direction,
            "direction_label": {"collection": "回款", "payment": "付款", "unknown": "待判断"}.get(direction, "待判断"),
            "amount": round(total, 2),
            **summary,
            "existing_allocations": [{
                "match_id": str(item.id),
                "bill_type": str(item.bill_type),
                "bill_id": str(item.bill_id),
                "bill_number": item.bill_number,
                "linked_amount": round(_num(item.linked_amount), 2),
            } for item in matches],
            "currency": row.currency,
            "counterparty_name": _transaction_counterparty(row, direction) if direction != "unknown" else None,
            "summary": row.summary or row.purpose or row.remark,
            "confidence_level": level,
            "top_score": round(top_score, 2),
            "ambiguity_margin": round(margin, 2),
            "candidates": [{k: v for k, v in item.items() if k != "raw_bill_number"} for item in scored[:8]],
            "blocked_reason": blocked or ("没有找到仍有未结余额的候选账单" if not top else None),
        })
        if len(suggestions) >= limit:
            break

    return {
        "stats": {
            "pending_transactions": len(suggestions),
            "partial_transactions": sum(1 for item in suggestions if item["allocated_amount"] > EPS),
            "remaining_amount": round(sum(item["remaining_amount"] for item in suggestions), 2),
        },
        "suggestions": suggestions,
    }


def _specific_bill(db: Session, direction: str, bill_type: str, bill_id: str) -> tuple[object, dict]:
    if direction == "collection" and bill_type == "channel":
        row = db.get(ChannelRecord, bill_id)
        if row is None or not _active_bill(row):
            raise HTTPException(status_code=404, detail="渠道账单不存在或已取消")
        bill_amount = abs(_num(row.settlement_amount))
        outstanding = max(0.0, bill_amount - max(0.0, _num(row.received_amount)))
        return row, {
            "bill_type": "channel", "bill_id": str(row.id),
            "bill_number": str(row.statement_no or f"CH-{str(row.id)[:8]}"),
            "partner_name": str(row.partner_name or row.channel_name or ""),
            "settlement_month": row.settlement_month, "game_name": row.game_name,
            "bill_amount": bill_amount, "outstanding_amount": outstanding,
        }
    if direction == "payment" and bill_type == "rd":
        row = db.get(ReconciliationRecord, bill_id)
        if row is None or not _active_bill(row):
            raise HTTPException(status_code=404, detail="研发账单不存在或已取消")
        bill_amount = abs(_num(row.settlement_amount))
        agg = aggregate_rd_payments_for_ids(db, [str(row.id)]).get(str(row.id))
        pay = fill_payable_for_row(agg, bill_amount)
        return row, {
            "bill_type": "rd", "bill_id": str(row.id),
            "bill_number": str(row.statement_no or f"RD-{str(row.id)[:8]}"),
            "partner_name": str(row.partner_name or ""),
            "settlement_month": row.settlement_month, "game_name": row.game_name,
            "bill_amount": bill_amount, "outstanding_amount": max(0.0, float(pay.unpaid_amount)),
        }
    raise HTTPException(status_code=422, detail="流水收支方向与账单类型不匹配")


def _allow_projection_sync(db: Session) -> None:
    db.execute(text("SELECT set_config('app.allow_bank_allocation_sync', '1', true)"))


def sync_transaction_projection(db: Session, tx: BankTransaction) -> None:
    matches = active_matches_for_transaction(db, str(tx.id))
    _allow_projection_sync(db)
    if matches:
        direction, total, _ = transaction_direction(tx)
        allocated, _count = _totals(matches)
        first = matches[0]
        tx.type = "payment_register" if direction == "payment" else "collection_register"
        tx.reconciliation_type = str(first.bill_type)
        tx.reconciliation_id = str(first.bill_id)
        numbers = [str(item.bill_number or item.bill_id) for item in matches]
        tx.reconciliation_no = numbers[0] + (f" (+{len(numbers)-1})" if len(numbers) > 1 else "")
        tx.linked_amount = allocated
        tx.status = "matched" if allocated + EPS >= total else "partial_matched"
    else:
        history = db.execute(
            select(BankReconciliationMatch)
            .where(BankReconciliationMatch.bank_transaction_id == str(tx.id))
            .order_by(BankReconciliationMatch.created_at.asc())
            .limit(1)
        ).scalar_one_or_none()
        tx.type = (history.original_transaction_type if history else None) or "statement_import"
        tx.status = history.original_transaction_status if history else None
        tx.reconciliation_type = None
        tx.reconciliation_id = None
        tx.reconciliation_no = None
        tx.linked_amount = None
    tx.updated_at = datetime.now(timezone.utc)
    db.flush()


def allocate_transaction(db: Session, transaction_id: str, allocations: list[dict], user: AuthUser) -> dict:
    tx = db.execute(
        select(BankTransaction).where(BankTransaction.id == transaction_id).with_for_update()
    ).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=404, detail="银行流水不存在")
    if str(tx.id) in bank_funding_transaction_ids(db):
        raise HTTPException(status_code=409, detail="该流水已经登记为研发预付款，不能再分配到普通账单")
    direction, total, blocked = transaction_direction(tx)
    if blocked or direction == "unknown" or total <= EPS:
        raise HTTPException(status_code=422, detail=blocked or "流水金额无效")
    if tx.currency and str(tx.currency).strip().upper() not in {"CNY", "RMB"}:
        raise HTTPException(status_code=422, detail="当前仅支持人民币账单核销")

    existing = active_matches_for_transaction(db, transaction_id)
    allocated, _ = _totals(existing)
    remaining = max(0.0, total - allocated)
    if remaining <= EPS:
        raise HTTPException(status_code=409, detail="该银行流水已经全额核销")

    existing_pairs = {(str(item.bill_type), str(item.bill_id)) for item in existing}
    request_pairs: set[tuple[str, str]] = set()
    normalized: list[tuple[str, str, float]] = []
    request_total = 0.0
    for raw in allocations:
        bill_type = str(raw.get("bill_type") or "").strip()
        bill_id = str(raw.get("bill_id") or "").strip()
        amount = round(_num(raw.get("amount")), 2)
        pair = (bill_type, bill_id)
        if not bill_type or not bill_id or amount <= EPS:
            raise HTTPException(status_code=422, detail="每条分配必须包含账单和大于 0 的金额")
        if pair in existing_pairs or pair in request_pairs:
            raise HTTPException(status_code=409, detail="同一银行流水不能重复分配到同一张账单")
        request_pairs.add(pair)
        normalized.append((bill_type, bill_id, amount))
        request_total += amount
    if request_total > remaining + EPS:
        raise HTTPException(status_code=409, detail=f"本次分配 {request_total:.2f} 超过流水剩余 {remaining:.2f}")

    original_type = existing[0].original_transaction_type if existing else tx.type
    original_status = existing[0].original_transaction_status if existing else tx.status
    created: list[BankReconciliationMatch] = []
    for bill_type, bill_id, amount in normalized:
        row, bill = _specific_bill(db, direction, bill_type, bill_id)
        if amount > float(bill["outstanding_amount"]) + EPS:
            raise HTTPException(status_code=409, detail=f"{bill['bill_number']} 分配金额超过未结余额")
        generated_receipt_id: str | None = None
        if direction == "collection":
            generated_receipt_id = str(uuid4())
            db.add(ChannelReceipt(
                id=generated_receipt_id,
                channel_record_id=str(row.id),
                amount=amount,
                receipt_date=tx.trade_date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                bank_account=tx.bank_account,
                remark=f"银行流水核销分配 · {tx.transaction_no or tx.id}",
                attachment_url=tx.attachment_url,
            ))
            db.flush()
            _recompute_channel_receipts(db, row)

        score_item = _score_candidate(tx, direction, amount, {
            **bill,
            "raw_bill_number": str(getattr(row, "statement_no", None) or ""),
        })
        score = float((score_item or {}).get("score") or 0)
        reasons = list((score_item or {}).get("reasons") or [])
        match = BankReconciliationMatch(
            id=str(uuid4()), bank_transaction_id=str(tx.id), direction=direction,
            bill_type=bill_type, bill_id=str(row.id), bill_number=bill["bill_number"],
            linked_amount=amount, confidence_score=score,
            confidence_level=_raw_confidence(score) if score >= 60 else "manual",
            match_reasons={"reasons": reasons, "p2_multi_allocation": True},
            generated_receipt_id=generated_receipt_id, status="confirmed",
            original_transaction_type=original_type or "statement_import",
            original_transaction_status=original_status,
            confirmed_by=str(user.id), confirmed_email=user.email,
            confirmed_at=datetime.now(timezone.utc),
        )
        db.add(match)
        db.flush()
        created.append(match)

    sync_transaction_projection(db, tx)
    db.commit()
    for match in created:
        db.refresh(match)
    db.refresh(tx)
    return {
        "matches": [_history_row(match, tx) for match in created],
        "transaction": transaction_summary(tx, active_matches_for_transaction(db, transaction_id)),
        "message": f"已完成 {len(created)} 条核销分配",
    }


def transaction_summaries(db: Session, transaction_ids: list[str]) -> list[dict]:
    ids = list(dict.fromkeys(str(value).strip() for value in transaction_ids if str(value).strip()))[:500]
    if not ids:
        return []
    rows = db.execute(select(BankTransaction).where(BankTransaction.id.in_(ids))).scalars().all()
    matches = db.execute(select(BankReconciliationMatch).where(
        BankReconciliationMatch.bank_transaction_id.in_(ids),
        BankReconciliationMatch.status == "confirmed",
    )).scalars().all()
    grouped: dict[str, list[BankReconciliationMatch]] = defaultdict(list)
    for match in matches:
        grouped[str(match.bank_transaction_id)].append(match)
    row_map = {str(row.id): row for row in rows}
    return [transaction_summary(row_map[item_id], grouped.get(item_id, [])) for item_id in ids if item_id in row_map]


def bill_summary(db: Session, bill_type: str, bill_id: str) -> dict:
    if bill_type == "rd":
        row = db.get(ReconciliationRecord, bill_id)
        if row is None:
            raise HTTPException(status_code=404, detail="研发账单不存在")
        bill_amount = abs(_num(row.settlement_amount))
        payment = fill_payable_for_row(aggregate_rd_payments_for_ids(db, [bill_id]).get(bill_id), bill_amount)
        cash_total = max(0.0, float(payment.paid_amount))
        bill_number = str(row.statement_no or f"RD-{bill_id[:8]}")
        partner_name = str(row.partner_name or "")
    elif bill_type == "channel":
        row = db.get(ChannelRecord, bill_id)
        if row is None:
            raise HTTPException(status_code=404, detail="渠道账单不存在")
        bill_amount = abs(_num(row.settlement_amount))
        cash_total = max(0.0, _num(row.received_amount))
        bill_number = str(row.statement_no or f"CH-{bill_id[:8]}")
        partner_name = str(row.partner_name or row.channel_name or "")
    else:
        raise HTTPException(status_code=422, detail="bill_type 仅支持 rd / channel")

    matches = db.execute(
        select(BankReconciliationMatch).where(
            BankReconciliationMatch.bill_type == bill_type,
            BankReconciliationMatch.bill_id == bill_id,
            BankReconciliationMatch.status == "confirmed",
        ).order_by(BankReconciliationMatch.confirmed_at.desc())
    ).scalars().all()
    tx_ids = list({str(item.bank_transaction_id) for item in matches})
    tx_map = {str(tx.id): tx for tx in (
        db.execute(select(BankTransaction).where(BankTransaction.id.in_(tx_ids))).scalars().all() if tx_ids else []
    )}
    allocations = []
    for match in matches:
        tx = tx_map.get(str(match.bank_transaction_id))
        allocations.append({
            "match_id": str(match.id), "bank_transaction_id": str(match.bank_transaction_id),
            "linked_amount": round(_num(match.linked_amount), 2),
            "trade_date": tx.trade_date if tx else None,
            "transaction_no": tx.transaction_no if tx else None,
            "counterparty_name": _transaction_counterparty(tx, match.direction) if tx else None,
            "summary": (tx.summary or tx.purpose or tx.remark) if tx else None,
            "bank_account": tx.bank_account if tx else None,
            "source_bank": tx.source_bank if tx else None,
            "source_file_name": tx.source_file_name if tx else None,
            "source_row_no": tx.source_row_no if tx else None,
            "confirmed_email": match.confirmed_email, "confirmed_at": match.confirmed_at,
        })
    bank_allocated = round(sum(item["linked_amount"] for item in allocations), 2)
    return {
        "bill_type": bill_type, "bill_id": bill_id, "bill_number": bill_number,
        "partner_name": partner_name, "bill_amount": round(bill_amount, 2),
        "bank_allocated_amount": bank_allocated, "cash_total_amount": round(cash_total, 2),
        "remaining_amount": round(max(0.0, bill_amount - cash_total), 2),
        "allocation_count": len(allocations), "allocations": allocations,
    }
