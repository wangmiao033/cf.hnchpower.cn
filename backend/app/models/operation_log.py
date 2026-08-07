"""业务操作审计日志 ORM。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base import Base


class OperationLog(Base):
    __tablename__ = "operation_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    entity_number: Mapped[str | None] = mapped_column(String, nullable=True)
    action: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    actor_email: Mapped[str | None] = mapped_column(String, nullable=True)
    changes: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    metadata_json: Mapped[dict] = mapped_column(
        "metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
