"""Run versioned PostgreSQL schema migrations from an explicit migration context."""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path

import sqlparse
from sqlalchemy import text

from app.core.database import get_engine

logger = logging.getLogger(__name__)

MIGRATION_DIR = Path(__file__).resolve().parents[2] / "sql"
MIGRATION_FILES = (
    *tuple(f"{number:03d}" for number in range(1, 52)),
    "neon_repair_missing_columns.sql",
)


def _migration_paths() -> list[Path]:
    paths: list[Path] = []
    for entry in MIGRATION_FILES:
        if entry.endswith(".sql"):
            path = MIGRATION_DIR / entry
        else:
            matches = sorted(MIGRATION_DIR.glob(f"{entry}_*.sql"))
            if not matches:
                continue
            path = matches[0]
        if path.exists():
            paths.append(path)
    return paths


def should_run_migrations() -> bool:
    """Only explicit deploy/manual/CLI jobs may execute schema DDL."""
    context = os.environ.get("MIGRATION_EXECUTION_CONTEXT", "").strip().lower()
    return context in {"deploy", "manual", "cli"}


def run_schema_migrations() -> None:
    """Apply each SQL file once, serialized with a PostgreSQL advisory lock."""
    if not should_run_migrations():
        return

    with get_engine().begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS app_schema_migrations (
                  name TEXT PRIMARY KEY,
                  checksum TEXT NOT NULL,
                  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        )
        connection.execute(
            text("SELECT pg_advisory_xact_lock(hashtext('caiwu_schema_migrations'))")
        )

        for path in _migration_paths():
            script = path.read_text(encoding="utf-8")
            checksum = hashlib.sha256(script.encode("utf-8")).hexdigest()
            applied = connection.execute(
                text(
                    """
                    SELECT checksum
                    FROM app_schema_migrations
                    WHERE name = :name
                    """
                ),
                {"name": path.name},
            ).scalar_one_or_none()
            if applied == checksum:
                continue
            if applied is not None:
                raise RuntimeError(f"Migration changed after apply: {path.name}")

            for statement in sqlparse.split(script):
                statement = statement.strip()
                if statement:
                    connection.exec_driver_sql(statement)

            connection.execute(
                text(
                    """
                    INSERT INTO app_schema_migrations (name, checksum)
                    VALUES (:name, :checksum)
                    """
                ),
                {"name": path.name, "checksum": checksum},
            )
            logger.info("Applied database migration %s", path.name)
