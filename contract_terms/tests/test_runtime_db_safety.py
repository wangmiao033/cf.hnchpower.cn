from __future__ import annotations

import unittest
from unittest.mock import patch

import psycopg
from fastapi import HTTPException

import extended_main
import main


class _Result:
    def __init__(self, *, one=None, rows=None):
        self._one = one
        self._rows = rows or []

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._rows


class _FakeConnection:
    def __init__(self, *, schema_ready=True, deadlock_once=False):
        self.schema_ready = schema_ready
        self.deadlock_once = deadlock_once
        self.candidate_attempts = 0
        self.rollback_count = 0
        self.sql = []

    def execute(self, statement, params=None):
        sql = str(statement)
        self.sql.append(sql)
        if "to_regclass('public.cf_contract_access_terms')" in sql:
            return _Result(one={"name": "cf_contract_access_terms" if self.schema_ready else None})
        if "FROM cf_contract_access_items AS access" in sql:
            self.candidate_attempts += 1
            if self.deadlock_once and self.candidate_attempts == 1:
                raise psycopg.errors.DeadlockDetected("deadlock detected")
            return _Result(rows=[])
        return _Result(rows=[])

    def rollback(self):
        self.rollback_count += 1


class ContractRuntimeDatabaseSafetyTests(unittest.TestCase):
    def test_schema_check_never_executes_runtime_ddl(self):
        conn = _FakeConnection(schema_ready=True)
        main._require_table(conn)
        joined = "\n".join(conn.sql).upper()
        self.assertNotIn("CREATE TABLE", joined)
        self.assertNotIn("CREATE INDEX", joined)
        self.assertNotIn("ALTER TABLE", joined)

    def test_missing_schema_returns_503_instead_of_creating_tables(self):
        conn = _FakeConnection(schema_ready=False)
        with self.assertRaises(HTTPException) as ctx:
            main._require_table(conn)
        self.assertEqual(ctx.exception.status_code, 503)
        joined = "\n".join(conn.sql).upper()
        self.assertNotIn("CREATE", joined)

    def test_candidate_read_retries_one_transient_deadlock(self):
        conn = _FakeConnection(schema_ready=True, deadlock_once=True)
        with patch.object(extended_main.time, "sleep", return_value=None):
            rows = extended_main._candidate_rows(conn)
        self.assertEqual(rows, [])
        self.assertEqual(conn.candidate_attempts, 2)
        self.assertEqual(conn.rollback_count, 1)
        joined = "\n".join(conn.sql).upper()
        self.assertNotIn("CREATE TABLE", joined)
        self.assertNotIn("CREATE INDEX", joined)


if __name__ == "__main__":
    unittest.main()
