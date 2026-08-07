"""银行流水自动核销确认关系。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, JSON, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base import Base


class BankReconciliationMatch(Base):
    __tablename__ = "bank_reconciliation_matches"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    bank_transaction_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    bill_type: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    bill_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    bill_number: Mapped[str | None] = mapped_column(String, nullable=True)
    linked_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False)
    confidence_score: Mapped[float] = mapped_column(Numeric(8, 2), nullable=False, default=0)
    confidence_level: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    match_reasons: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    generated_receipt_id: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="confirmed", index=True)
    original_transaction_type: Mapped[str] = mapped_column(String(32), nullable=False, default="statement_import")
    original_transaction_status: Mapped[str | None] = mapped_column(String, nullable=True)
    confirmed_by: Mapped[str | None] = mapped_column(String, nullable=True)
    confirmed_email: Mapped[str | None] = mapped_column(String, nullable=True)
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reversed_by: Mapped[str | None] = mapped_column(String, nullable=True)
    reversed_email: Mapped[str | None] = mapped_column(String, nullable=True)
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reverse_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
