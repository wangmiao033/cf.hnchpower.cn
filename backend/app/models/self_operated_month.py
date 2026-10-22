"""独立月度核对记录与保存审计，不参与公司总账。"""
from datetime import datetime
from sqlalchemy import String, Integer, JSON, DateTime, ForeignKey, CheckConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.base import Base

class SelfOperatedMonth(Base):
    __tablename__ = 'self_operated_months'
    __table_args__ = (CheckConstraint('revision >= 1'),)
    month: Mapped[str] = mapped_column(String(7), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    rows: Mapped[list] = mapped_column(JSON, nullable=False)

class SelfOperatedMonthSave(Base):
    __tablename__ = 'self_operated_month_saves'
    request_key: Mapped[str] = mapped_column(String(36), primary_key=True)
    month: Mapped[str] = mapped_column(String(7), nullable=False)
    digest: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_id: Mapped[str] = mapped_column(String, ForeignKey('auth_users.id', ondelete='RESTRICT'), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    rows: Mapped[list] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
