from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.core.migrations import _migration_paths, should_run_migrations


class MigrationExecutionContextTests(unittest.TestCase):
    def test_vercel_runtime_never_auto_migrates_even_with_legacy_flag(self):
        with patch.dict(
            os.environ,
            {"VERCEL": "1", "AUTO_MIGRATE_DB": "true", "MIGRATION_EXECUTION_CONTEXT": ""},
            clear=False,
        ):
            self.assertFalse(should_run_migrations())

    def test_deploy_context_explicitly_allows_migrations(self):
        with patch.dict(
            os.environ,
            {"VERCEL": "1", "AUTO_MIGRATE_DB": "false", "MIGRATION_EXECUTION_CONTEXT": "deploy"},
            clear=False,
        ):
            self.assertTrue(should_run_migrations())

    def test_latest_contract_schema_migrations_are_versioned(self):
        names = {path.name for path in _migration_paths()}
        self.assertIn("048_contract_access_terms.sql", names)
        self.assertIn("049_contract_reconciliation_v2.sql", names)
        self.assertIn("050_contract_difference_workflow.sql", names)
        self.assertIn("051_rd_contract_entry.sql", names)


if __name__ == "__main__":
    unittest.main()
