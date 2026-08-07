"""银行流水自动核销：高置信匹配、确认与撤销。"""

from __future__ import annotations

from datetime import datetime, timezone
import re
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.bank_reconciliation_match import BankReconciliationMatch
from app.models.bank_transaction import BankTransaction
from app.models.channel import ChannelReceipt, ChannelRecord
from app.models.reconciliation import ReconciliationRecord
from app.models.user import AuthUser
from app.services.monthly_business_dashboard import month_key
from app.services.rd_bank_payment_aggregate import (
    aggregate_rd_payments_for_ids,
    fill_payable_for_row,
)

EPS = 0.01
_BLOCKED_BILL_STATUSES = {
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
_COMPANY_SUFFIXES = (
    "有限责任公司",
    "股份有限公司",
    "有限公司",
    "责任公司",
    "公司",
    "pte.ltd",
    "pte ltd",
    "limited",
    "ltd",
    "inc",
)


def _num(value) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed == parsed else 0.0


def _active_bill(row) -> bool:
    return str(getattr(row, "status", None) or "pending").strip().lower() not in _BLOCKED_BILL_STATUSES


def _normalize_party(value: str | None) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[\s\-—_·,，.。()（）\[\]【】/\\]", "", text)
    for suffix in _COMPANY_SUFFIXES:
        normalized_suffix = re.sub(r"[\s.]", "", suffix.lower())
        if text.endswith(normalized_suffix) and len(text) > len(normalized_suffix) + 1:
            text = text[: -len(normalized_suffix)]
            break
    return text


def _normalize_free_text(value: str | None) -> str:
    return re.sub(r"\s+", "", str(value or "").lower())


def _month_index(value: str | None) -> int | None:
    normalized = month_key(value)
    if not normalized:
        return None
    year, month = (int(part) for part in normalized.split("-"))
    return year * 12 + month


def transaction_direction(row: BankTransaction) -> tuple[str, float, str | None]:
    income = abs(_num(row.income_amount))
    expense = abs(_num(row.expense_amount))
    if income > EPS and expense <= EPS:
        return "collection", income, None
    if expense > EPS and income <= EPS:
        return "payment", expense, None
    return "unknown", abs(_num(row.amount)), "无法判断收支方向，请补齐收入金额或支出金额。"


def _transaction_counterparty(row: BankTransaction, direction: str) -> str:
    return str(row.payer_name if direction == "collection" else row.payee_name or "").strip()


def _transaction_search_text(row: BankTransaction) -> str:
    return _normalize_free_text(
        " ".join(
            str(value or "")
            for value in (
                row.transaction_no,
                row.instruction_no,
                row.summary,
                row.purpose,
                row.remark,
                row.raw_text,
            )
        )
    )


def _raw_confidence(score: float) -> str:
    if score >= 80:
        return "high"
    if score >= 60:
        return "medium"
    return "low"


def _score_candidate(row: BankTransaction, direction: str, amount: float, candidate: dict) -> dict | None:
    outstanding = max(0.0, _num(candidate.get("outstanding_amount")))
    if outstanding <= EPS or amount <= EPS or amount > outstanding + EPS:
        return None

    score = 0.0
    reasons: list[str] = []
    diff = abs(outstanding - amount)
    if diff <= EPS:
        score += 55
        reasons.append("金额与未结余额一致")
    elif outstanding > EPS and diff / outstanding <= 0.01:
        score += 45
        reasons.append("金额与未结余额接近")
    else:
        score += 20
        reasons.append("金额可作为部分结算")

    counterparty = _normalize_party(_transaction_counterparty(row, direction))
    partner = _normalize_party(candidate.get("partner_name"))
    if counterparty and partner:
        if counterparty == partner:
            score += 25
            reasons.append("银行对方户名与合作方一致")
        elif counterparty in partner or partner in counterparty:
            score += 15
            reasons.append("银行对方户名与合作方高度相似")

    bill_number = _normalize_free_text(candidate.get("raw_bill_number"))
    if bill_number and bill_number in _transaction_search_text(row):
        score += 35
        reasons.append("流水摘要命中账单编号")

    tx_idx = _month_index(row.trade_date)
    bill_idx = _month_index(candidate.get("settlement_month"))
    if tx_idx is not None and bill_idx is not None:
        delta = tx_idx - bill_idx
        if delta == 1:
            score += 10
            reasons.append("交易发生在账期后一个月")
        elif delta == 0:
            score += 8
            reasons.append("交易月份与账期一致")
        elif delta == 2:
            score += 6
            reasons.append("交易时间与账期接近")
        elif -1 <= delta <= 3:
            score += 3
            reasons.append("交易时间在合理结算窗口")

    score = min(100.0, round(score, 2))
    return {
        **candidate,
        "score": score,
        "confidence_level": _raw_confidence(score),
        "reasons": reasons,
    }


def _channel_candidates(db: Session) -> list[dict]:
    rows = db.execute(select(ChannelRecord).order_by(ChannelRecord.created_at.desc())).scalars().all()
    out: list[dict] = []
    for row in rows:
        if not _active_bill(row):
            continue
        bill_amount = abs(_num(row.settlement_amount))
        received = max(0.0, _num(row.received_amount))
        outstanding = max(0.0, bill_amount - received)
        if outstanding <= EPS:
            continue
        raw_number = str(row.statement_no or "").strip()
        out.append(
            {
                "bill_type": "channel",
                "bill_id": str(row.id),
                "bill_number": raw_number or f"CH-{str(row.id)[:8]}",
                "raw_bill_number": raw_number,
                "partner_name": str(row.partner_name or row.channel_name or "").strip(),
                "settlement_month": row.settlement_month,
                "game_name": row.game_name,
                "bill_amount": round(bill_amount, 2),
                "outstanding_amount": round(outstanding, 2),
            }
        )
    return out


def _rd_candidates(db: Session) -> list[dict]:
    rows = db.execute(select(ReconciliationRecord).order_by(ReconciliationRecord.created_at.desc())).scalars().all()
    active_rows = [row for row in rows if _active_bill(row)]
    aggregate_map = aggregate_rd_payments_for_ids(db, [str(row.id) for row in active_rows])
    out: list[dict] = []
    for row in active_rows:
        payment = fill_payable_for_row(aggregate_map.get(str(row.id)), row.settlement_amount)
        outstanding = max(0.0, float(payment.unpaid_amount))
        if outstanding <= EPS:
            continue
        bill_amount = abs(_num(row.settlement_amount))
        raw_number = str(row.statement_no or "").strip()
        out.append(
            {
                "bill_type": "rd",
                "bill_id": str(row.id),
                "bill_number": raw_number or f"RD-{str(row.id)[:8]}",
                "raw_bill_number": raw_number,
                "partner_name": str(row.partner_name or "").strip(),
                "settlement_month": row.settlement_month,
                "game_name": row.game_name,
                "bill_amount": round(bill_amount, 2),
                "outstanding_amount": round(outstanding, 2),
            }
        )
    return out


def _candidate_pool(db: Session) -> dict[str, list[dict]]:
    return {"collection": _channel_candidates(db), "payment": _rd_candidates(db)}


def build_transaction_suggestion(row: BankTransaction, pool: dict[str, list[dict]]) -> dict:
    direction, amount, blocked = transaction_direction(row)
    label = {"collection": "回款", "payment": "付款", "unknown": "待判断"}[direction]
    base = {
        "transaction_id": str(row.id),
        "trade_date": row.trade_date,
        "transaction_no": row.transaction_no,
        "direction": direction,
        "direction_label": label,
        "amount": round(amount, 2),
        "currency": row.currency,
        "counterparty_name": _transaction_counterparty(row, direction) if direction != "unknown" else None,
        "summary": row.summary or row.purpose or row.remark,
        "auto_ready": False,
        "confidence_level": "none",
        "top_score": 0,
        "ambiguity_margin": 0,
        "candidates": [],
        "blocked_reason": blocked,
    }
    if blocked or direction == "unknown":
        return base
    if row.currency and str(row.currency).strip().upper() not in {"CNY", "RMB"}:
        base["blocked_reason"] = f"当前仅支持人民币账单自动核销，流水币种为 {row.currency}。"
        return base

    scored = [
        item
        for candidate in pool.get(direction, [])
        if (item := _score_candidate(row, direction, amount, candidate)) is not None
    ]
    scored.sort(key=lambda item: (item["score"], -abs(item["outstanding_amount"] - amount)), reverse=True)
    top = scored[0] if scored else None
    second = scored[1] if len(scored) > 1 else None
    if not top:
        base["confidence_level"] = "low"
        base["blocked_reason"] = "没有找到金额可覆盖且仍有未结余额的账单。"
        return base

    margin = float(top["score"]) - float(second["score"] if second else 0)
    level = "high" if top["score"] >= 80 and margin >= 10 else "medium" if top["score"] >= 60 else "low"
    base.update(
        {
            "auto_ready": level == "high",
            "confidence_level": level,
            "top_score": float(top["score"]),
            "ambiguity_margin": round(margin, 2),
            "candidates": [{key: value for key, value in candidate.items() if key != "raw_bill_number"} for candidate in scored[:5]],
            "blocked_reason": None if level != "low" else "匹配证据不足，请人工选择账单后确认。",
        }
    )
    return base


def _history_row(match: BankReconciliationMatch, tx: BankTransaction | None) -> dict:
    return {
        "match_id": str(match.id),
        "bank_transaction_id": str(match.bank_transaction_id),
        "trade_date": tx.trade_date if tx else None,
        "transaction_no": tx.transaction_no if tx else None,
        "direction": match.direction,
        "direction_label": "回款" if match.direction == "collection" else "付款",
        "bill_type": match.bill_type,
        "bill_id": match.bill_id,
        "bill_number": match.bill_number,
        "linked_amount": round(_num(match.linked_amount), 2),
        "confidence_score": round(_num(match.confidence_score), 2),
        "confidence_level": match.confidence_level,
        "status": match.status,
        "confirmed_email": match.confirmed_email,
        "confirmed_at": match.confirmed_at,
        "reversed_email": match.reversed_email,
        "reversed_at": match.reversed_at,
        "reverse_reason": match.reverse_reason,
    }


def build_dashboard(db: Session, limit: int = 200) -> dict:
    pending_total = int(
        db.execute(
            select(func.count(BankTransaction.id)).where(BankTransaction.type == "statement_import")
        ).scalar_one()
    )
    pending = (
        db.execute(
            select(BankTransaction)
            .where(BankTransaction.type == "statement_import")
            .order_by(BankTransaction.trade_date.desc(), BankTransaction.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    pool = _candidate_pool(db)
    suggestions = [build_transaction_suggestion(row, pool) for row in pending]

    recent_matches = (
        db.execute(
            select(BankReconciliationMatch)
            .where(BankReconciliationMatch.status.in_(("confirmed", "reversed")))
            .order_by(BankReconciliationMatch.updated_at.desc())
            .limit(100)
        )
        .scalars()
        .all()
    )
    tx_ids = list({match.bank_transaction_id for match in recent_matches})
    tx_map = {
        str(row.id): row
        for row in (
            db.execute(select(BankTransaction).where(BankTransaction.id.in_(tx_ids))).scalars().all()
            if tx_ids
            else []
        )
    }
    confirmed = [match for match in recent_matches if match.status == "confirmed"]
    return {
        "stats": {
            "pending_transactions": pending_total,
            "high_confidence": sum(1 for item in suggestions if item["confidence_level"] == "high"),
            "medium_confidence": sum(1 for item in suggestions if item["confidence_level"] == "medium"),
            "unmatched": sum(1 for item in suggestions if item["confidence_level"] in {"low", "none"}),
            "confirmed_matches": len(confirmed),
            "confirmed_amount": round(sum(_num(item.linked_amount) for item in confirmed), 2),
        },
        "suggestions": suggestions,
        "recent_matches": [_history_row(match, tx_map.get(str(match.bank_transaction_id))) for match in recent_matches],
    }


def _recompute_channel_receipts(db: Session, row: ChannelRecord) -> None:
    total = float(
        db.execute(
            select(func.coalesce(func.sum(ChannelReceipt.amount), 0)).where(ChannelReceipt.channel_record_id == row.id)
        ).scalar_one()
        or 0
    )
    row.received_amount = total
    receivable = abs(_num(row.settlement_amount))
    if total + EPS >= receivable:
        row.receipt_status = "paid"
    elif total <= EPS:
        row.receipt_status = "unpaid"
    else:
        row.receipt_status = "partial"
    row.updated_at = datetime.now(timezone.utc)


def _load_specific_candidate(db: Session, tx: BankTransaction, direction: str, amount: float, bill_type: str, bill_id: str) -> dict:
    if direction == "collection" and bill_type == "channel":
        row = db.get(ChannelRecord, bill_id)
        if row is None or not _active_bill(row):
            raise HTTPException(status_code=404, detail="渠道账单不存在或已取消")
        bill_amount = abs(_num(row.settlement_amount))
        outstanding = max(0.0, bill_amount - max(0.0, _num(row.received_amount)))
        candidate = {
            "bill_type": "channel", "bill_id": str(row.id),
            "bill_number": str(row.statement_no or f"CH-{str(row.id)[:8]}"),
            "raw_bill_number": str(row.statement_no or ""),
            "partner_name": str(row.partner_name or row.channel_name or ""),
            "settlement_month": row.settlement_month, "game_name": row.game_name,
            "bill_amount": bill_amount, "outstanding_amount": outstanding,
        }
    elif direction == "payment" and bill_type == "rd":
        row = db.get(ReconciliationRecord, bill_id)
        if row is None or not _active_bill(row):
            raise HTTPException(status_code=404, detail="研发账单不存在或已取消")
        agg = aggregate_rd_payments_for_ids(db, [str(row.id)]).get(str(row.id))
        payment = fill_payable_for_row(agg, row.settlement_amount)
        candidate = {
            "bill_type": "rd", "bill_id": str(row.id),
            "bill_number": str(row.statement_no or f"RD-{str(row.id)[:8]}"),
            "raw_bill_number": str(row.statement_no or ""),
            "partner_name": str(row.partner_name or ""),
            "settlement_month": row.settlement_month, "game_name": row.game_name,
            "bill_amount": abs(_num(row.settlement_amount)),
            "outstanding_amount": max(0.0, float(payment.unpaid_amount)),
        }
    else:
        raise HTTPException(status_code=422, detail="流水收支方向与账单类型不匹配")

    scored = _score_candidate(tx, direction, amount, candidate)
    if scored is None:
        raise HTTPException(status_code=409, detail="流水金额超过账单未结余额，不能直接核销")
    return {**scored, "row": row}


def confirm_match(db: Session, transaction_id: str, bill_type: str, bill_id: str, user: AuthUser) -> dict:
    tx = db.execute(
        select(BankTransaction).where(BankTransaction.id == transaction_id).with_for_update()
    ).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=404, detail="银行流水不存在")
    if tx.type != "statement_import":
        raise HTTPException(status_code=409, detail="该流水已登记或已核销，不能重复匹配")
    active_match = db.execute(
        select(BankReconciliationMatch.id).where(
            BankReconciliationMatch.bank_transaction_id == transaction_id,
            BankReconciliationMatch.status == "confirmed",
        )
    ).scalar_one_or_none()
    if active_match:
        raise HTTPException(status_code=409, detail="该银行流水已经存在有效核销关系")

    direction, amount, blocked = transaction_direction(tx)
    if blocked or direction == "unknown" or amount <= EPS:
        raise HTTPException(status_code=422, detail=blocked or "流水金额无效")
    candidate = _load_specific_candidate(db, tx, direction, amount, bill_type, bill_id)
    row = candidate.pop("row")
    original_type = tx.type
    original_status = tx.status
    generated_receipt_id: str | None = None

    if direction == "payment":
        tx.type = "payment_register"
        tx.reconciliation_type = "rd"
        tx.reconciliation_id = str(row.id)
        tx.reconciliation_no = str(row.statement_no or "") or None
    else:
        generated_receipt_id = str(uuid4())
        db.add(
            ChannelReceipt(
                id=generated_receipt_id,
                channel_record_id=str(row.id),
                amount=amount,
                receipt_date=tx.trade_date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                bank_account=tx.bank_account,
                remark=f"银行流水自动核销 · {tx.transaction_no or tx.id}",
                attachment_url=tx.attachment_url,
            )
        )
        db.flush()
        _recompute_channel_receipts(db, row)
        tx.type = "collection_register"
        tx.reconciliation_type = "channel"
        tx.reconciliation_id = str(row.id)
        tx.reconciliation_no = str(row.statement_no or "") or None

    tx.linked_amount = amount
    tx.status = "matched"
    tx.updated_at = datetime.now(timezone.utc)
    level = _raw_confidence(float(candidate["score"])) if candidate["score"] >= 60 else "manual"
    match = BankReconciliationMatch(
        id=str(uuid4()),
        bank_transaction_id=str(tx.id),
        direction=direction,
        bill_type=bill_type,
        bill_id=str(row.id),
        bill_number=candidate["bill_number"],
        linked_amount=amount,
        confidence_score=float(candidate["score"]),
        confidence_level=level,
        match_reasons={"reasons": candidate["reasons"]},
        generated_receipt_id=generated_receipt_id,
        status="confirmed",
        original_transaction_type=original_type,
        original_transaction_status=original_status,
        confirmed_by=str(user.id),
        confirmed_email=user.email,
        confirmed_at=datetime.now(timezone.utc),
    )
    db.add(match)
    db.commit()
    db.refresh(match)
    db.refresh(tx)
    return {"match": _history_row(match, tx), "message": "银行流水核销成功"}


def reverse_match(db: Session, match_id: str, reason: str, user: AuthUser) -> dict:
    normalized_reason = str(reason or "").strip()
    if len(normalized_reason) < 2:
        raise HTTPException(status_code=422, detail="撤销核销必须填写原因")
    match = db.execute(
        select(BankReconciliationMatch).where(BankReconciliationMatch.id == match_id).with_for_update()
    ).scalar_one_or_none()
    if match is None:
        raise HTTPException(status_code=404, detail="核销记录不存在")
    if match.status != "confirmed":
        raise HTTPException(status_code=409, detail="该核销记录已经撤销")
    tx = db.execute(
        select(BankTransaction).where(BankTransaction.id == match.bank_transaction_id).with_for_update()
    ).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=409, detail="原银行流水不存在，无法自动撤销")

    if match.bill_type == "channel" and match.generated_receipt_id:
        receipt = db.get(ChannelReceipt, match.generated_receipt_id)
        if receipt is not None:
            parent = db.get(ChannelRecord, match.bill_id)
            db.delete(receipt)
            db.flush()
            if parent is not None:
                _recompute_channel_receipts(db, parent)

    tx.type = match.original_transaction_type or "statement_import"
    tx.status = match.original_transaction_status
    tx.reconciliation_id = None
    tx.reconciliation_type = None
    tx.reconciliation_no = None
    tx.linked_amount = None
    tx.updated_at = datetime.now(timezone.utc)

    match.status = "reversed"
    match.reversed_by = str(user.id)
    match.reversed_email = user.email
    match.reversed_at = datetime.now(timezone.utc)
    match.reverse_reason = normalized_reason
    match.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(match)
    db.refresh(tx)
    return {"match": _history_row(match, tx), "message": "已撤销银行流水核销"}


def has_confirmed_match_for_transaction(db: Session, transaction_id: str) -> bool:
    return bool(
        db.execute(
            select(BankReconciliationMatch.id).where(
                BankReconciliationMatch.bank_transaction_id == transaction_id,
                BankReconciliationMatch.status == "confirmed",
            )
        ).scalar_one_or_none()
    )


def has_confirmed_match_for_receipt(db: Session, receipt_id: str) -> bool:
    return bool(
        db.execute(
            select(BankReconciliationMatch.id).where(
                BankReconciliationMatch.generated_receipt_id == receipt_id,
                BankReconciliationMatch.status == "confirmed",
            )
        ).scalar_one_or_none()
    )
