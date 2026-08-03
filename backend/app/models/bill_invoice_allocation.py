"""账单与发票金额分配。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Numeric, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base import Base


class BillInvoiceAllocation(Base):
    __tablename__ = "bill_invoice_allocations"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    bill_type: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    bill_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    invoice_id: Mapped[str] = mapped_column(
        String, ForeignKey("invoice_records.id", ondelete="CASCADE"), nullable=False, index=True
    )
    allocated_net_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    allocated_tax_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    allocated_gross_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="confirmed")
    match_type: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    match_score: Mapped[float] = mapped_column(Numeric(10, 4), nullable=False, default=0)
    match_reasons: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    confirmed_by: Mapped[str | None] = mapped_column(String, nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
