#!/usr/bin/env bash
set -euo pipefail

# IMPORTANT: Vercel deployments must remain data-preserving.
# Database schema migrations are NOT part of frontend or backend application
# builds; production migrations must be planned, backed up and run separately
# using backend/scripts/run_schema_migrations.py under an approved procedure.
# Never add database migration invocations to this build script.
if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "Production application build: skipping database schema migrations. No database writes are performed by this build script."
else
  echo "Non-production application build: database schema migrations are not invoked."
fi

npm run build
