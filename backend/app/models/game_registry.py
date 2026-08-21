"""V4 game registry: canonical games and channel/month settlement rules."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.base import Base


class GameRegistryGame(Base):
    __tablename__ = "game_registry_games"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    canonical_name: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    normalized_name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    rules: Mapped[list["ChannelGameRule"]] = relationship(
        "ChannelGameRule", back_populates="game", cascade="all, delete-orphan"
    )


class ChannelGameRule(Base):
    __tablename__ = "channel_game_rules"
    __table_args__ = (
        UniqueConstraint(
            "partner_name", "channel_name", "game_id", "start_month", name="uq_channel_game_rule_period"
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    game_id: Mapped[str] = mapped_column(
        String, ForeignKey("game_registry_games.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    partner_name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    channel_name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    start_month: Mapped[str] = mapped_column(String(7), nullable=False)
    end_month: Mapped[str | None] = mapped_column(String(7), nullable=True)
    share_rate: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    tax_rate: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    channel_fee_rate: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    settlement_rule_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    channel_fee_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    tax_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    source_month_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_first_bill_id: Mapped[str | None] = mapped_column(String, nullable=True)
    source_last_bill_id: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    game: Mapped[GameRegistryGame] = relationship("GameRegistryGame", back_populates="rules")
