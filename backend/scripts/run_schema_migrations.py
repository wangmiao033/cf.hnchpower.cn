"""CLI entrypoint for serialized production database migrations."""

from app.core.migrations import run_schema_migrations


if __name__ == "__main__":
    run_schema_migrations()
    print("schema migrations complete")
