"""银行核销撤销：先解除确认态，再恢复资金记录，兼容数据库防旁路触发器。"""

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


def reverse_confirmed_match(db: Session, match_id: str, reason: str, user: AuthUser) -> dict:
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

    now = datetime.now(timezone.utc)
    # 先解除 confirmed，随后数据库资金保护触发器才允许恢复流水/删除自动收款。
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

    tx.type = match.original_transaction_type or "statement_import"
    tx.status = match.original_transaction_status
    tx.reconciliation_id = None
    tx.reconciliation_type = None
    tx.reconciliation_no = None
    tx.linked_amount = None
    tx.updated_at = now

    db.commit()
    db.refresh(match)
    db.refresh(tx)
    return {"match": _history_row(match, tx), "message": "已撤销银行流水核销"}
