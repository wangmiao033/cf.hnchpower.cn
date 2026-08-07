"""用户级权限覆盖 ORM。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base import Base


class UserPermissionOverride(Base):
    __tablename__ = "auth_user_permission_overrides"
    __table_args__ = (
        UniqueConstraint("user_id", "permission", name="uq_auth_user_permission_override"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("auth_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    permission: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    effect: Mapped[str] = mapped_column(String(16), nullable=False)  # allow / deny
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
