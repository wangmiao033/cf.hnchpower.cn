"""Runtime pooled URLs, direct migrations, and preview isolation."""

from __future__ import annotations

import hashlib
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.pool import NullPool

from app.core.config import get_database_url
from app.core.neon_database_url import (
    ProductionDatabaseGuardError,
    assert_runtime_database_scope,
    resolve_migration_database_url,
    resolve_runtime_database_url,
    rewrite_neon_endpoint,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
HELPER_COPIES = (
    REPO_ROOT / "backend/app/core/neon_database_url.py",
    REPO_ROOT / "proxy/neon_database_url.py",
    REPO_ROOT / "contract_ai/neon_database_url.py",
    REPO_ROOT / "contract_terms/neon_database_url.py",
)
DIRECT = "postgresql://app_user:p%40ss@ep-example.eu-central-1.aws.neon.tech:5432/neondb?sslmode=require"
POOLED = "postgresql://app_user:p%40ss@ep-example-pooler.eu-central-1.aws.neon.tech:5432/neondb?sslmode=require"
PRODUCTION = (
    "postgresql://app_user:secret@ep-withered-mouse-06737032.c-3.us-east-1.aws.neon.tech/neondb"
    "?sslmode=require"
)
OTHER_DB = "postgresql://app_user:secret@db.internal.example:5432/finance"


class NeonDatabaseUrlTests(unittest.TestCase):
    def test_helper_copies_stay_identical(self):
        digests = {hashlib.sha256(path.read_bytes()).hexdigest() for path in HELPER_COPIES}
        self.assertEqual(len(digests), 1)

    def test_rewrite_only_changes_neon_endpoint_label(self):
        pooled = rewrite_neon_endpoint(DIRECT, pooled=True)
        self.assertIn("ep-example-pooler.eu-central-1.aws.neon.tech:5432", pooled)
        self.assertIn("app_user:p%40ss@", pooled)
        self.assertTrue(pooled.endswith("/neondb?sslmode=require"))
        self.assertEqual(rewrite_neon_endpoint(pooled, pooled=True), pooled)
        self.assertEqual(rewrite_neon_endpoint(pooled, pooled=False), DIRECT)
        self.assertEqual(rewrite_neon_endpoint(OTHER_DB, pooled=True), OTHER_DB)
        self.assertEqual(rewrite_neon_endpoint("", pooled=True), "")

    def test_runtime_prefers_the_selected_primary_pooled_sibling(self):
        quicksdk = "postgresql://qk:secret@ep-shared.neon.tech/neondb"
        chosen = resolve_runtime_database_url({
            "DATABASE_URL": DIRECT,
            "DATABASE_URL_POOLED": POOLED,
            "QUICKSDK_DATABASE_URL": quicksdk,
            "QUICKSDK_DATABASE_URL_POOLED": quicksdk.replace("ep-shared", "ep-shared-pooler"),
        })
        self.assertIn("ep-example-pooler", chosen)
        self.assertNotIn("ep-shared", chosen)

        only_quicksdk = resolve_runtime_database_url({
            "QUICKSDK_DATABASE_URL": quicksdk,
        })
        self.assertIn("ep-shared-pooler.neon.tech", only_quicksdk)

    def test_migration_uses_direct_and_strips_pooler(self):
        direct = resolve_migration_database_url({
            "DATABASE_URL": POOLED,
            "DATABASE_URL_DIRECT": DIRECT,
            "QUICKSDK_DATABASE_URL_DIRECT": "postgresql://qk:secret@ep-other.neon.tech/neondb",
        })
        self.assertEqual(direct, DIRECT)
        stripped = resolve_migration_database_url({"QUICKSDK_DATABASE_URL": POOLED})
        self.assertIn("@ep-example.eu-central-1.aws.neon.tech", stripped)
        self.assertNotIn("-pooler", stripped)

    def test_production_node_requires_an_explicit_production_marker(self):
        with self.assertRaises(ProductionDatabaseGuardError) as raised:
            assert_runtime_database_scope(PRODUCTION, {})
        message = str(raised.exception)
        self.assertNotIn("secret", message)
        self.assertNotIn("postgresql://", message)
        self.assertNotIn("withered-mouse", message)

        for env in (
            {"VERCEL_ENV": "preview"},
            {"VERCEL_ENV": "development"},
            {"APP_ENV": "development"},
            {"APP_ENV": "dev"},
            {"APP_ENV": "preview"},
            {"APP_ENV": "staging"},
            {"VERCEL_ENV": "preview", "APP_ENV": "production"},
        ):
            with self.assertRaises(ProductionDatabaseGuardError):
                resolve_runtime_database_url({**env, "DATABASE_URL": PRODUCTION})

        assert_runtime_database_scope(PRODUCTION, {"VERCEL_ENV": "production"})
        assert_runtime_database_scope(PRODUCTION, {"APP_ENV": "production"})
        allowed = resolve_runtime_database_url({
            "APP_ENV": "production",
            "DATABASE_URL": PRODUCTION,
        })
        self.assertIn("withered-mouse-06737032-pooler", allowed)

        overridden = resolve_runtime_database_url({
            "ALLOW_SHARED_PRODUCTION_DATABASE": "1",
            "DATABASE_URL": PRODUCTION,
        })
        self.assertIn("-pooler", overridden)
        assert_runtime_database_scope(PRODUCTION, {
            "APP_ENV": "development",
            "ALLOW_SHARED_PRODUCTION_DATABASE": "true",
        })
        with self.assertRaises(ProductionDatabaseGuardError):
            resolve_migration_database_url({"DATABASE_URL": PRODUCTION})

    def test_config_switches_pooler_with_migration_context(self):
        runtime_env = {
            "DATABASE_URL": DIRECT,
            "QUICKSDK_DATABASE_URL": "",
            "DATABASE_URL_POOLED": "",
            "DATABASE_URL_DIRECT": "",
            "MIGRATION_EXECUTION_CONTEXT": "",
            "VERCEL_ENV": "production",
            "APP_ENV": "production",
        }
        with patch.dict(os.environ, runtime_env, clear=False):
            runtime = get_database_url()
        self.assertTrue(runtime.startswith("postgresql+psycopg://"))
        self.assertIn("-pooler", runtime)

        runtime_env["MIGRATION_EXECUTION_CONTEXT"] = "deploy"
        with patch.dict(os.environ, runtime_env, clear=False):
            migration = get_database_url()
        self.assertNotIn("-pooler", migration)
        self.assertIn("ep-example.eu-central-1.aws.neon.tech", migration)

    def test_pooled_engine_does_not_keep_a_local_queue(self):
        import app.core.database as database

        previous_engine = database._engine
        previous_factory = database._session_factory
        database._engine = None
        database._session_factory = None
        try:
            with patch.dict(
                os.environ,
                {
                    "DATABASE_URL": DIRECT,
                    "QUICKSDK_DATABASE_URL": "",
                    "DATABASE_URL_POOLED": "",
                    "DATABASE_URL_DIRECT": "",
                    "MIGRATION_EXECUTION_CONTEXT": "",
                    "VERCEL_ENV": "production",
                    "APP_ENV": "production",
                },
                clear=False,
            ):
                engine = database.get_engine()
                self.assertIn("-pooler", str(engine.url))
                self.assertIsInstance(engine.pool, NullPool)
                engine.dispose()
        finally:
            database._engine = previous_engine
            database._session_factory = previous_factory


if __name__ == "__main__":
    unittest.main()
