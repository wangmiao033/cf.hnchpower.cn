"""Exercise the production psycopg binding parser without database credentials."""
from pathlib import Path
import unittest

from psycopg import ProgrammingError
from psycopg.adapt import Transformer
from psycopg._queries import PostgresQuery
import sqlparse


class AuditMigrationDriverTests(unittest.TestCase):
    def test_all_075_statements_accept_empty_driver_parameters(self):
        script = (Path(__file__).parents[1] / 'sql/075_bill_actor_audit.sql').read_text()
        for statement in sqlparse.split(script):
            # SQLAlchemy exec_driver_sql passes an empty parameter collection.
            # PGlite alone does not exercise this driver interpolation layer.
            PostgresQuery(Transformer()).convert(statement, {})
        self.assertIn('mod(txid_current(), 4294967296)', script)

    def test_original_modulo_operator_reproduces_production_failure(self):
        with self.assertRaises(ProgrammingError):
            PostgresQuery(Transformer()).convert('SELECT txid_current() % 4294967296', {})
