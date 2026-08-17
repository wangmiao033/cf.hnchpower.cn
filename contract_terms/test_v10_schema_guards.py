from __future__ import annotations

import unittest

from fastapi import HTTPException

import v10_main


class _Result:
    def __init__(self, value):
        self.value = value

    def fetchone(self):
        return {"name": self.value}


class _Connection:
    def __init__(self, missing=None):
        self.missing = set(missing or [])
        self.sql = []

    def execute(self, statement, params=None):
        sql = str(statement)
        self.sql.append(sql)
        relation = str((params or [""])[0]).replace("public.", "")
        return _Result(None if relation in self.missing else relation)


class V10SchemaGuardTests(unittest.TestCase):
    def test_historical_runtime_schema_builders_are_patched(self):
        self.assertIs(v10_main._v2._ensure_v2_tables, v10_main._require_v2_tables)
        self.assertIs(v10_main._v2_1._ensure_v2_tables, v10_main._require_v2_tables)
        self.assertIs(v10_main._v3._ensure_v2_tables, v10_main._require_v2_tables)
        self.assertIs(v10_main._v4._ensure_difference_tables, v10_main._require_difference_tables)
        self.assertIs(v10_main._v8._ensure_difference_tables, v10_main._require_difference_tables)
        self.assertIs(v10_main._v9._ensure_rd_entry_tables, v10_main._require_rd_entry_tables)
        self.assertIs(v10_main._rd_prepayment.ensure_rd_prepayment_table, v10_main._require_rd_prepayment_table)

    def test_guards_only_read_catalog(self):
        conn = _Connection()
        v10_main._require_v2_tables(conn)
        v10_main._require_difference_tables(conn)
        v10_main._require_rd_entry_tables(conn)
        v10_main._require_rd_prepayment_table(conn)
        joined = "\n".join(conn.sql).upper()
        for forbidden in ("CREATE TABLE", "CREATE INDEX", "ALTER TABLE", "DROP TABLE"):
            self.assertNotIn(forbidden, joined)

    def test_missing_schema_returns_retryable_503(self):
        conn = _Connection({"cf_contract_adjustments"})
        with self.assertRaises(HTTPException) as ctx:
            v10_main._require_difference_tables(conn)
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertTrue(ctx.exception.detail["retryable"])
        self.assertIn("cf_contract_adjustments", ctx.exception.detail["missing_tables"])

    def test_structured_variant_overrides_conflicting_name_variant(self):
        result = v10_main._project_variant_into_name({
            "product_name": "圣树唤歌（0.05折）",
            "commercial_variant": "0.1 折",
        })
        self.assertEqual(result["commercial_variant"], "0.1折")
        self.assertEqual(result["product_name"], "圣树唤歌（0.1折）")

    def test_empty_structured_variant_keeps_legacy_name(self):
        original = {"product_name": "圣树唤歌（0.05折）", "commercial_variant": ""}
        result = v10_main._project_variant_into_name(original)
        self.assertEqual(result, original)


if __name__ == "__main__":
    unittest.main()
