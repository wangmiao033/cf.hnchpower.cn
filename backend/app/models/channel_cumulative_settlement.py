"""Channel cumulative-settlement policy and batch ORM models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.base import Base


class ChannelCumulativeSettlementPolicy(Base):
    __tablename__ = "channel_cumulative_settlement_policies"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    partner_key: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    partner_name: Mapped[str] = mapped_column(Text, nullable=False)
    settlement_mode: Mapped[str] = mapped_column(String(24), nullable=False, default="periodic")
    threshold_basis: Mapped[str] = mapped_column(String(32), nullable=False, default="billing_flow")
    threshold_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    scope: Mapped[str] = mapped_column(String(24), nullable=False, default="partner")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ChannelCumulativeSettlementBatch(Base):
    __tablename__ = "channel_cumulative_settlement_batches"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    batch_no: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    partner_key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    partner_name: Mapped[str] = mapped_column(Text, nullable=False)
    threshold_basis: Mapped[str] = mapped_column(String(32), nullable=False)
    threshold_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    basis_total: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    settlement_total: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    period_start: Mapped[str | None] = mapped_column(String(16), nullable=True)
    period_end: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="ready", index=True)
    created_by_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    invoice_task_id: Mapped[str | None] = mapped_column(String, nullable=True)
    invoice_id: Mapped[str | None] = mapped_column(String, ForeignKey("invoice_records.id", ondelete="SET NULL"), nullable=True)
    invoiced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list["ChannelCumulativeSettlementBatchItem"]] = relationship(
        "ChannelCumulativeSettlementBatchItem",
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by="ChannelCumulativeSettlementBatchItem.settlement_month",
    )


class ChannelCumulativeSettlementBatchItem(Base):
    __tablename__ = "channel_cumulative_settlement_batch_items"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    batch_id: Mapped[str] = mapped_column(String, ForeignKey("channel_cumulative_settlement_batches.id", ondelete="CASCADE"), nullable=False, index=True)
    bill_id: Mapped[str] = mapped_column(String, ForeignKey("channel_records.id", ondelete="RESTRICT"), nullable=False, index=True)
    settlement_month: Mapped[str | None] = mapped_column(String(16), nullable=True)
    basis_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    settlement_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    release_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    batch: Mapped[ChannelCumulativeSettlementBatch] = relationship("ChannelCumulativeSettlementBatch", back_populates="items")
