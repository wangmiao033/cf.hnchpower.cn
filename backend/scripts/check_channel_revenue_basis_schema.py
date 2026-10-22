"""Read-only deployment gate for migration 076; never runs from application startup."""
from __future__ import annotations

import json
import sys

from sqlalchemy import text

from app.core.database import get_engine


def check_schema(connection) -> dict:
    column = connection.execute(text("""
        SELECT data_type, character_maximum_length, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'channel_record_line_items'
          AND column_name = 'revenue_basis'
    """)).mappings().first()
    constraint = connection.execute(text("""
        SELECT c.convalidated, pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'channel_record_line_items'
          AND c.conname = 'channel_line_revenue_basis_check' AND c.contype = 'c'
    """)).mappings().first()
    checks = {
        "column_exists": column is not None,
        "column_type": bool(column and column["data_type"] == "character varying" and column["character_maximum_length"] == 24),
        "legacy_default": bool(column and "'pre_discount'" in str(column["column_default"])),
        "not_null": bool(column and column["is_nullable"] == "NO"),
        "valid_basis_constraint": bool(
            constraint and constraint["convalidated"]
            and "'pre_discount'" in constraint["definition"]
            and "'post_discount'" in constraint["definition"]
        ),
    }
    return {"ready": all(checks.values()), "migration": "076_channel_revenue_basis.sql", "checks": checks}


def main() -> int:
    try:
        with get_engine().connect() as connection:
            with connection.begin():
                connection.execute(text("SET TRANSACTION READ ONLY"))
                result = check_schema(connection)
    except Exception:
        # Never echo an exception containing a production URL or credentials.
        print(json.dumps({"ready": False, "error": "Unable to inspect configured database schema; no changes were made."}))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["ready"] else 1


if __name__ == "__main__":
    sys.exit(main())
