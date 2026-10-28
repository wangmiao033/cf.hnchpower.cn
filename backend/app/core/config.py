"""Load environment from backend/.env and expose DATABASE_URL."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# backend/ directory (parent of app/)
_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(_BACKEND_ROOT / ".env")


def normalize_database_url(url: str) -> str:
    """
    将常规 PostgreSQL URI 转为 SQLAlchemy 的 psycopg (v3) 方言 URL。

    SQLAlchemy 对 ``postgresql://`` 默认选用 psycopg2 驱动；本项目依赖 ``psycopg[binary]``（v3），
    必须使用 ``postgresql+psycopg://``，否则会尝试导入不存在的 ``psycopg2``。
    """
    u = url.strip()
    if u.startswith("postgresql+psycopg://"):
        return u
    if u.startswith("postgresql://"):
        return "postgresql+psycopg://" + u.removeprefix("postgresql://")
    # 部分托管方可能给出 postgres://，与 postgresql:// 等价
    if u.startswith("postgres://"):
        return "postgresql+psycopg://" + u.removeprefix("postgres://")
    return u


def get_database_url() -> str:
    """Return the shared PostgreSQL URI used by both Vercel services.

    API runtimes use the Neon pooled host. Explicit migration jobs use the
    direct host so DDL is not sent through the pooler.
    """
    from app.core.neon_database_url import (
        migration_context_active,
        resolve_migration_database_url,
        resolve_runtime_database_url,
    )

    raw = (
        resolve_migration_database_url()
        if migration_context_active()
        else resolve_runtime_database_url()
    )
    return normalize_database_url(raw)
