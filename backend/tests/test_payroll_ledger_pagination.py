"""Pagination and concurrency regression checks for financial payroll ledgers."""

from __future__ import annotations

import unittest
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.operating_expense import (
    _lock_payroll_company_month,
    list_payroll_batches,
)
from app.core.base import Base
from app.models.operating_expense import OperatingExpense, PayrollBatch


class PayrollLedgerPaginationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(
            self.engine,
            tables=[OperatingExpense.__table__, PayrollBatch.__table__],
        )
        self.db = Session(self.engine)
        for number, (month, company, gross, withheld, tax, review, paid) in enumerate([
            ("2026-08", "广州熊动科技有限公司", 15000, 1770.48, 822.95, "reviewed", False),
            ("2026-08", "广州超凡响应网络科技有限公司", 23900, 2281.92, 50.38, "pending_review", False),
            ("2026-07", "广州超凡响应网络科技有限公司", 24150, 2281.92, 51.55, "reviewed", True),
        ], 1):
            expense = OperatingExpense(
                id=f"expense-{number}", expense_month=month, category="payroll",
                expense_kind="payroll", amount=gross,
                payment_status="paid" if paid else "unpaid", invoice_status="none",
                source="payroll_import", vendor_name=company,
            )
            batch = PayrollBatch(
                id=f"batch-{number}", operating_expense_id=expense.id,
                expense_month=month, company_name=company, employee_count=1,
                gross_salary=gross, employee_deduction_total=withheld,
                income_tax_total=tax, net_salary_total=round(gross - withheld - tax, 2),
                review_status=review, validation_status="valid",
            )
            self.db.add_all([expense, batch])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def read(self, **kwargs):
        return list_payroll_batches(
            db=self.db, month=None, payment_status=None, payroll_status=None,
            q=None, limit=1, offset=0, **kwargs
        )

    def test_total_and_summary_not_cut_at_page_size(self):
        first = self.read()
        second = list_payroll_batches(
            db=self.db, month=None, payment_status=None, payroll_status=None,
            q=None, limit=1, offset=1
        )
        self.assertEqual(first.total, 3)
        self.assertEqual(second.total, 3)
        self.assertEqual(len(first.items), 1)
        self.assertEqual(len(second.items), 1)
        self.assertNotEqual(first.items[0].id, second.items[0].id)
        self.assertEqual(first.gross_salary_total, 63050)
        self.assertEqual(second.gross_salary_total, 63050)
        self.assertEqual(first.employee_deduction_total, 6334.32)
        self.assertEqual(first.income_tax_total, 924.88)
        self.assertEqual(first.net_salary_total, 55790.80)
        self.assertEqual(first.confirmed_net_salary_total, round(12406.57 + 21816.53, 2))
        self.assertEqual((first.pending_review_count, first.reviewed_count, first.paid_count), (1, 1, 1))

    def test_filters_update_aggregate_and_total(self):
        august = list_payroll_batches(
            db=self.db, month="2026-08", payment_status=None, payroll_status=None,
            q=None, limit=1, offset=0
        )
        self.assertEqual(august.total, 2)
        self.assertEqual(august.gross_salary_total, 38900)
        paid = list_payroll_batches(
            db=self.db, month=None, payment_status=None, payroll_status="paid",
            q=None, limit=1, offset=0
        )
        self.assertEqual(paid.total, 1)
        self.assertEqual((paid.paid_count, paid.pending_review_count), (1, 0))

    def test_advisory_lock_only_for_postgres(self):
        logged = []
        db_pg = SimpleNamespace(
            get_bind=lambda: SimpleNamespace(dialect=SimpleNamespace(name="postgresql")),
            execute=lambda query, params: logged.append((str(query), params)),
        )
        _lock_payroll_company_month(db_pg, "2026-08", "公司甲")
        self.assertEqual(len(logged), 1)
        self.assertIn("pg_advisory_xact_lock", logged[0][0])
        self.assertIn("2026-08", logged[0][1]["lock_key"])

        db_sqlite = SimpleNamespace(
            get_bind=lambda: SimpleNamespace(dialect=SimpleNamespace(name="sqlite")),
            execute=lambda *_args, **_kwargs: self.fail("SQLite should not use PostgreSQL locks"),
        )
        _lock_payroll_company_month(db_sqlite, "2026-08", "公司乙")


if __name__ == "__main__":
    unittest.main()
