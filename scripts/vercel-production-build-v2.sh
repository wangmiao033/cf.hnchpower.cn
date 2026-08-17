#!/usr/bin/env bash
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  if [ -z "${DATABASE_URL:-}" ] && [ -z "${QUICKSDK_DATABASE_URL:-}" ]; then
    echo "ERROR: Production build is missing DATABASE_URL/QUICKSDK_DATABASE_URL." >&2
    exit 1
  fi

  echo "Running serialized production database migrations inside Vercel build..."
  MIGRATION_VENV="/tmp/cf-schema-migration-venv"
  rm -rf "$MIGRATION_VENV"
  python -m venv "$MIGRATION_VENV"
  "$MIGRATION_VENV/bin/python" -m pip install --disable-pip-version-check --quiet -r backend/requirements-migrations.txt
  export PYTHONPATH="backend:."
  export MIGRATION_EXECUTION_CONTEXT="deploy"
  "$MIGRATION_VENV/bin/python" backend/scripts/run_schema_migrations.py
  rm -rf "$MIGRATION_VENV"
else
  echo "Skipping production database migrations for VERCEL_ENV=${VERCEL_ENV:-local}."
fi

npm run build
