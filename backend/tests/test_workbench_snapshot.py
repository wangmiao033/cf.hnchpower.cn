import unittest

from app.api.workbench import _count_total_pending
from app.models.reconciliation import ReconciliationRecord


class AggregateResult:
    def one(self):
        return 3, 420.5, "2026-08"


class PendingResult:
    def scalar_one(self):
        return 1


class SnapshotDb:
    def __init__(self):
        self.calls = 0

    def execute(self, statement):
        sql = str(statement.compile(compile_kwargs={"literal_binds": True})).lower()
        self.calls += 1
        if self.calls == 1:
            self.first_sql = sql
            return AggregateResult()
        self.second_sql = sql
        return PendingResult()


class WorkbenchSnapshotTest(unittest.TestCase):
    def test_voided_statuses_are_filtered_from_snapshot_queries(self):
        db = SnapshotDb()
        self.assertEqual(_count_total_pending(db, ReconciliationRecord), (3, 420.5, 1, "2026-08"))
        self.assertEqual(db.calls, 2)
        for sql in (db.first_sql, db.second_sql):
            self.assertIn("not in", sql)
            for value in ("cancelled", "canceled", "void", "deleted"):
                self.assertIn(value, sql)


if __name__ == "__main__":
    unittest.main()
