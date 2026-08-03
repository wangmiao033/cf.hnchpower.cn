"""发票台账 ORM 模型。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Numeric, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base import Base


class InvoiceRecord(Base):
    __tablename__ = "invoice_records"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    invoice_direction: Mapped[str] = mapped_column(String(16), nullable=False, default="output")
    invoice_type: Mapped[str | None] = mapped_column(String, nullable=True)
    digital_invoice_no: Mapped[str | None] = mapped_column(String, nullable=True)
    invoice_code: Mapped[str | None] = mapped_column(String, nullable=True)
    invoice_no: Mapped[str | None] = mapped_column(String, nullable=True)
    invoice_identity_key: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    buyer_name: Mapped[str | None] = mapped_column(String, nullable=True)
    buyer_tax_no: Mapped[str | None] = mapped_column(String, nullable=True)
    seller_name: Mapped[str | None] = mapped_column(String, nullable=True)
    seller_tax_no: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    tax_no: Mapped[str | None] = mapped_column(String, nullable=True)
    invoice_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    tax_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    amount_with_tax: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    invoice_date: Mapped[str | None] = mapped_column(String, nullable=True)
    issuer: Mapped[str | None] = mapped_column(String, nullable=True)
    invoice_source: Mapped[str | None] = mapped_column(String, nullable=True)
    tax_status: Mapped[str] = mapped_column(String(32), nullable=False, default="normal")
    original_invoice_id: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str | None] = mapped_column(String, nullable=True, default="未开")
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    verified_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    verified_record_ids: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
