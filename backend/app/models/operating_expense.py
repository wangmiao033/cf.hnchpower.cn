"""经营费用台账 ORM。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base import Base


class OperatingExpense(Base):
    __tablename__ = "operating_expenses"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    expense_month: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    expense_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    game_name: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    vendor_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
