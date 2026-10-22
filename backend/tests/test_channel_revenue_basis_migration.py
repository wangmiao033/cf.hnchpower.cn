"""Migration and deployment gates are additive and separate from runtime."""
from contextlib import nullcontext
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from psycopg._queries import PostgresQuery
from psycopg.adapt import Transformer
import sqlparse

from app.core.migrations import _migration_paths, run_schema_migrations
from backend.scripts.check_channel_revenue_basis_schema import check_schema


class RevenueBasisMigrationTests(unittest.TestCase):
    def path(self):
        return Path(__file__).parents[1] / "sql/076_channel_revenue_basis.sql"

    def test_registered_additive_script_uses_supported_driver_and_no_data_rewrite(self):
        self.assertIn(self.path().resolve(), [path.resolve() for path in _migration_paths()])
        script = self.path().read_text()
        statements = sqlparse.split(script)
        self.assertEqual(len(statements), 2)
        for statement in statements:
            PostgresQuery(Transformer()).convert(statement, {})
        self.assertIn("ADD COLUMN IF NOT EXISTS", script)
        self.assertIn("IF NOT EXISTS", statements[1])
        self.assertIn("NOT NULL DEFAULT 'pre_discount'", script)
        executable = sqlparse.format(script, strip_comments=True).upper()
        for forbidden in ("UPDATE ", "DELETE ", "DROP ", "TRUNCATE "):
            self.assertNotIn(forbidden, executable)

    def test_registered_migration_second_run_does_not_execute_ddl(self):
        checksums = {}
        connection = Mock()
        def execute(statement, parameters=None):
            sql = str(statement)
            result = Mock()
            if "SELECT checksum" in sql:
                result.scalar_one_or_none.return_value = checksums.get(parameters["name"])
            elif "INSERT INTO app_schema_migrations" in sql:
                checksums[parameters["name"]] = parameters["checksum"]
            return result
        connection.execute.side_effect = execute
        engine = Mock()
        engine.begin.side_effect = lambda: nullcontext(connection)
        with patch("app.core.migrations.should_run_migrations", return_value=True), \
             patch("app.core.migrations.get_engine", return_value=engine), \
             patch("app.core.migrations._migration_paths", return_value=[self.path().with_name("075_bill_actor_audit.sql"), self.path()]):
            run_schema_migrations(only=self.path().name)
            self.assertEqual(connection.exec_driver_sql.call_count, 2)
            run_schema_migrations(only=self.path().name)
            self.assertEqual(connection.exec_driver_sql.call_count, 2)
            self.assertEqual(set(checksums), {self.path().name})

    def test_unknown_target_is_rejected_before_connecting(self):
        with patch("app.core.migrations.should_run_migrations", return_value=True), \
             patch("app.core.migrations.get_engine") as engine:
            with self.assertRaises(ValueError):
                run_schema_migrations(only="../unregistered.sql")
            engine.assert_not_called()

    def test_schema_check_only_reads_metadata_and_fails_closed_if_column_missing(self):
        connection = Mock()
        connection.execute.return_value.mappings.return_value.first.return_value = None
        result = check_schema(connection)
        self.assertFalse(result["ready"])
        for call in connection.execute.call_args_list:
            sql = str(call.args[0]).strip().upper()
            self.assertTrue(sql.startswith("SELECT "))
            self.assertNotIn("UPDATE ", sql)
            self.assertNotIn("ALTER ", sql)

    def test_complete_schema_passes_read_only_gate(self):
        connection = Mock()
        column, constraint = Mock(), Mock()
        column.mappings.return_value.first.return_value = {
            "data_type": "character varying", "character_maximum_length": 24,
            "is_nullable": "NO", "column_default": "'pre_discount'::character varying",
        }
        constraint.mappings.return_value.first.return_value = {
            "convalidated": True,
            "definition": "CHECK (revenue_basis IN ('pre_discount', 'post_discount'))",
        }
        connection.execute.side_effect = [column, constraint]
        self.assertTrue(check_schema(connection)["ready"])


if __name__ == "__main__":
    unittest.main()
