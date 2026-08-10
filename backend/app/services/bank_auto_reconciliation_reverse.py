"""银行核销撤销：支持单条分配撤销，并保留同一流水的其他有效分配。"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.bank_reconciliation_match import BankReconciliationMatch
from app.models.bank_transaction import BankTransaction
from app.models.channel import ChannelReceipt, ChannelRecord
from app.models.user import AuthUser
from app.services.bank_auto_reconciliation import _history_row, _recompute_channel_receipts
from app.services.bank_multi_allocation import sync_transaction_projection


def reverse_confirmed_match(db: Session, match_id: str, reason: str, user: AuthUser) -> dict:
    normalized_reason = str(reason or "").strip()
    if len(normalized_reason) < 2:
        raise HTTPException(status_code=422, detail="撤销核销必须填写原因")

    match = db.execute(
        select(BankReconciliationMatch)
        .where(BankReconciliationMatch.id == match_id)
        .with_for_update()
    ).scalar_one_or_none()
    if match is None:
        raise HTTPException(status_code=404, detail="核销记录不存在")
    if match.status != "confirmed":
        raise HTTPException(status_code=409, detail="该核销记录已经撤销")

    tx = db.execute(
        select(BankTransaction)
        .where(BankTransaction.id == match.bank_transaction_id)
        .with_for_update()
    ).scalar_one_or_none()
    if tx is None:
        raise HTTPException(status_code=409, detail="原银行流水不存在，无法自动撤销")

    now = datetime.now(timezone.utc)
    match.status = "reversed"
    match.reversed_by = str(user.id)
    match.reversed_email = user.email
    match.reversed_at = now
    match.reverse_reason = normalized_reason
    match.updated_at = now
    db.flush()

    if match.bill_type == "channel" and match.generated_receipt_id:
        receipt = db.get(ChannelReceipt, match.generated_receipt_id)
        if receipt is not None:
            parent = db.get(ChannelRecord, match.bill_id)
            db.delete(receipt)
            db.flush()
            if parent is not None:
                _recompute_channel_receipts(db, parent)

    # 只重算该流水的兼容投影；还有其他 confirmed 分配时，不恢复整笔银行流水。
    sync_transaction_projection(db, tx)
    db.commit()
    db.refresh(match)
    db.refresh(tx)
    return {"match": _history_row(match, tx), "message": "已撤销该条核销分配"}
