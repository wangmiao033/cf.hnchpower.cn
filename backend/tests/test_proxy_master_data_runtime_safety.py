from __future__ import annotations

import unittest
from pathlib import Path

from app.core.migrations import _migration_paths


ROOT = Path(__file__).resolve().parents[2]


class ProxyMasterDataRuntimeSafetyTests(unittest.TestCase):
    def test_stable_proxy_guards_do_not_contain_schema_ddl(self):
        source = (ROOT / "proxy" / "stable_main.py").read_text(encoding="utf-8")
        upper = source.upper()
        for forbidden in ("CREATE TABLE", "CREATE INDEX", "ALTER TABLE", "DROP TABLE"):
            self.assertNotIn(forbidden, upper)

    def test_reconciliation_partner_link_service_is_ddl_free(self):
        source = (
            ROOT / "backend" / "app" / "services" / "reconciliation_partner_links.py"
        ).read_text(encoding="utf-8")
        upper = source.upper()
        for forbidden in ("CREATE TABLE", "CREATE INDEX", "ALTER TABLE", "DROP TABLE"):
            self.assertNotIn(forbidden, upper)
        self.assertNotIn("ensure_link_table(", source)

    def test_legacy_ensure_functions_are_replaced_by_read_only_guards(self):
        source = (ROOT / "proxy" / "stable_main.py").read_text(encoding="utf-8")
        self.assertIn("_legacy._ensure_partners_table = _require_partners_table", source)
        self.assertIn("_legacy._ensure_reconciliation_links_table = _require_reconciliation_links_table", source)
        self.assertIn("_legacy._ensure_contracts_table = _require_contracts_table", source)

    def test_partner_contract_schema_is_versioned(self):
        names = {path.name for path in _migration_paths()}
        self.assertIn("052_partner_contract_proxy_schema.sql", names)
        migration = (ROOT / "backend" / "sql" / "052_partner_contract_proxy_schema.sql").read_text(
            encoding="utf-8"
        )
        self.assertIn("CREATE TABLE IF NOT EXISTS cf_reconciliation_partner_links", migration)
        self.assertIn("idx_cf_reconciliation_partner_links_partner", migration)

    def test_vercel_uses_stable_secured_proxy_entrypoint(self):
        config = (ROOT / "vercel.json").read_text(encoding="utf-8")
        self.assertIn('"entrypoint": "stable_secured_main:app"', config)


if __name__ == "__main__":
    unittest.main()
