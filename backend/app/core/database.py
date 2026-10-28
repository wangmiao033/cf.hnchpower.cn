"""SQLAlchemy engine and connectivity check."""

from __future__ import annotations

from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import get_database_url

_engine: Engine | None = None
_session_factory: sessionmaker | None = None


def get_engine() -> Engine:
    """Singleton SQLAlchemy engine using DATABASE_URL（经 config 规范为 postgresql+psycopg://）。"""
    global _engine, _session_factory
    if _engine is None:
        url = get_database_url()
        # Neon pooler already multiplexes connections. A process-local QueuePool
        # on a short-lived Vercel isolate just holds extra sessions open.
        pool_options: dict[str, object] = {"pool_pre_ping": True}
        if "-pooler" in url:
            pool_options["poolclass"] = NullPool
        _engine = create_engine(url, **pool_options)
        _session_factory = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
    return _engine


def get_session_factory() -> sessionmaker:
    get_engine()
    assert _session_factory is not None
    return _session_factory


def test_db_connection() -> tuple[bool, Any]:
    """
    Run SELECT 1 against the database.

    Returns:
        (True, None) on success, or (False, error_detail) on failure.
    """
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True, None
    except Exception as e:
        return False, str(e)
