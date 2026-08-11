"""独立服务器成本台账 ORM。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base import Base


class ServerCost(Base):
    __tablename__ = "server_costs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    expense_month: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    expense_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    provider_name: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="cloud_server", index=True)
    amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    game_name: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    payer_entity: Mapped[str | None] = mapped_column(Text, nullable=True)
    payer_partner_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    void_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
