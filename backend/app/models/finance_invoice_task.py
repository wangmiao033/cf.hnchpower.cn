"""Finance workbench invoice task ORM."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base import Base


class FinanceInvoiceTask(Base):
    __tablename__ = "finance_invoice_tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    task_no: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    bill_type: Mapped[str] = mapped_column(String(16), nullable=False, default="channel", index=True)
    bill_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    source_kind: Mapped[str] = mapped_column(String(32), nullable=False, default="bill")
    cumulative_batch_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("channel_cumulative_settlement_batches.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    direction: Mapped[str] = mapped_column(String(16), nullable=False, default="output")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    requested_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    allocated_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    bill_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    partner_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    game_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    settlement_month: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_by_id: Mapped[str | None] = mapped_column(String, nullable=True)
    submitted_by_email: Mapped[str | None] = mapped_column(String, nullable=True)
    submitted_by_name: Mapped[str | None] = mapped_column(String, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    assigned_to_id: Mapped[str | None] = mapped_column(String, nullable=True)
    assigned_to_email: Mapped[str | None] = mapped_column(String, nullable=True)
    assigned_to_name: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by_id: Mapped[str | None] = mapped_column(String, nullable=True)
    completed_by_email: Mapped[str | None] = mapped_column(String, nullable=True)
    completed_by_name: Mapped[str | None] = mapped_column(String, nullable=True)
    invoice_id: Mapped[str | None] = mapped_column(String, ForeignKey("invoice_records.id", ondelete="SET NULL"), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
