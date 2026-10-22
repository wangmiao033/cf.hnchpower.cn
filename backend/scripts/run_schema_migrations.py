"""CLI entrypoint for serialized production database migrations."""

import argparse

from app.core.migrations import run_schema_migrations, should_run_migrations


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run explicitly authorized schema migrations")
    parser.add_argument("--only", help="Exact registered SQL filename; prevents unrelated pending migrations")
    args = parser.parse_args()
    if not should_run_migrations():
        parser.error("Set MIGRATION_EXECUTION_CONTEXT to manual, cli or deploy before running migrations")
    run_schema_migrations(only=args.only)
    print("schema migrations complete")
