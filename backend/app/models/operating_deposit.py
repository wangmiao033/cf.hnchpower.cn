"""押金 / 保证金台账 ORM。

押金属于资产性往来，不进入经营费用和利润计算。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base import Base


class OperatingDeposit(Base):
    __tablename__ = "operating_deposits"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    deposit_type: Mapped[str] = mapped_column(String(32), nullable=False, default="office", index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    counterparty: Mapped[str | None] = mapped_column(Text, nullable=True)
    amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    paid_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    expected_refund_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="held", index=True)
    refund_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
