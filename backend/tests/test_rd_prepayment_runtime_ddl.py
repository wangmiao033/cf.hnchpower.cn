import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


class RdPrepaymentRuntimeDdlTests(unittest.TestCase):
    def test_rd_prepayment_request_module_is_ddl_free(self):
        source = (REPO_ROOT / "contract_terms" / "rd_prepayment.py").read_text(
            encoding="utf-8"
        ).upper()
        for token in ("CREATE TABLE", "ALTER TABLE", "CREATE INDEX"):
            self.assertNotIn(token, source)
        self.assertIn("RD_PREPAYMENT_SCHEMA_MISSING", source)
        self.assertIn("TO_REGCLASS", source)

    def test_rd_prepayment_deductions_schema_is_versioned_and_registered(self):
        migration = REPO_ROOT / "backend" / "sql" / "060_rd_prepayment_deductions.sql"
        self.assertTrue(migration.exists())
        migration_source = migration.read_text(encoding="utf-8")
        self.assertIn("cf_rd_prepayment_deductions", migration_source)

        registry_source = (
            REPO_ROOT / "backend" / "app" / "core" / "migrations.py"
        ).read_text(encoding="utf-8")
        self.assertIn("range(1, 61)", registry_source)


if __name__ == "__main__":
    unittest.main()
