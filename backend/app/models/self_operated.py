"""大熊游戏独立订单和文件导入审计；不修改原渠道账单或研发账单。"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger, CheckConstraint, Date, DateTime, ForeignKey, Index,
    Integer, String, func, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.base import Base


class SelfOperatedImportBatch(Base):
    __tablename__ = "self_operated_import_batches"
    __table_args__ = (
        CheckConstraint("submitted_count BETWEEN 1 AND 5000", name="ck_self_operated_batch_submitted"),
        CheckConstraint("inserted_count >= 0", name="ck_self_operated_batch_inserted"),
        CheckConstraint("duplicate_count >= 0", name="ck_self_operated_batch_duplicate"),
        CheckConstraint("inserted_count + duplicate_count = submitted_count", name="ck_self_operated_batch_counts"),
        Index("idx_self_operated_batches_created", "created_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    request_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    payload_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    source_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    source_label: Mapped[str] = mapped_column(String(32), default="daxiong", nullable=False)
    submitted_by_user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="RESTRICT"), nullable=False
    )
    submitted_count: Mapped[int] = mapped_column(Integer, nullable=False)
    inserted_count: Mapped[int] = mapped_column(Integer, nullable=False)
    duplicate_count: Mapped[int] = mapped_column(Integer, nullable=False)
    inserted_game_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    inserted_coin_cents: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    orders: Mapped[list["SelfOperatedOrder"]] = relationship(back_populates="batch")


class SelfOperatedOrder(Base):
    __tablename__ = "self_operated_orders"
    __table_args__ = (
        UniqueConstraint("source_label", "external_order_id", name="uq_self_operated_source_external_order"),
        CheckConstraint("source_label = 'daxiong'", name="ck_self_operated_order_source"),
        CheckConstraint("order_kind IN ('game','coin')", name="ck_self_operated_order_kind"),
        CheckConstraint("amount_cents BETWEEN 1 AND 999999999999", name="ck_self_operated_amount"),
        Index("idx_self_operated_orders_month_kind", "settlement_month", "order_kind"),
        Index("idx_self_operated_orders_game_month", "settlement_month", "game_id", "game_name"),
        Index("idx_self_operated_orders_batch", "import_batch_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    source_label: Mapped[str] = mapped_column(String(32), default="daxiong", nullable=False)
    external_order_id: Mapped[str] = mapped_column(String(160), nullable=False)
    game_id: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    game_name: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    order_kind: Mapped[str] = mapped_column(String(8), nullable=False)
    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    paid_date: Mapped[date] = mapped_column(Date, nullable=False)
    settlement_month: Mapped[str] = mapped_column(String(7), nullable=False)
    import_batch_id: Mapped[str] = mapped_column(
        String, ForeignKey("self_operated_import_batches.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    batch: Mapped[SelfOperatedImportBatch] = relationship(back_populates="orders")
