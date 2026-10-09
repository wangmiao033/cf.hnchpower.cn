"""Generic expense routes must not alter or delete payroll-linked ledger rows."""

import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.base import Base
from app.api.operating_expense import (
    delete_operating_expense, update_operating_expense,
)
from app.models.operating_expense import OperatingExpense, PayrollBatch
from app.schemas.operating_expense import OperatingExpenseUpdate


class PayrollExpenseMutationSafetyTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(
            self.engine, tables=[OperatingExpense.__table__, PayrollBatch.__table__]
        )
        self.db = Session(self.engine)

        wage = OperatingExpense(
            id="wage-1", expense_month="2026-08", category="payroll",
            expense_kind="payroll", source="payroll_import",
            amount=15000, payment_status="unpaid", invoice_status="none",
        )
        batch = PayrollBatch(
            id="batch-1", operating_expense_id="wage-1",
            expense_month="2026-08", company_name="熊动",
            employee_count=1, gross_salary=15000,
            employee_deduction_total=1770.48, income_tax_total=822.95,
            net_salary_total=12406.57, review_status="reviewed",
            validation_status="valid",
        )
        self.db.add_all([wage, batch])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_generic_delete_rejects_payroll_source_without_removing_batch(self):
        with self.assertRaises(HTTPException) as error:
            delete_operating_expense("wage-1", db=self.db)
        self.assertEqual(error.exception.status_code, 409)
        self.assertIsNotNone(self.db.get(OperatingExpense, "wage-1"))
        self.assertIsNotNone(self.db.get(PayrollBatch, "batch-1"))

    def test_generic_update_rejects_payroll_source_without_changing_gross(self):
        with self.assertRaises(HTTPException) as error:
            update_operating_expense(
                "wage-1", OperatingExpenseUpdate(amount=99), db=self.db
            )
        self.assertEqual(error.exception.status_code, 409)
        self.db.expire_all()
        self.assertEqual(float(self.db.get(OperatingExpense, "wage-1").amount), 15000)

    def test_regular_miscellaneous_expenses_remain_editable(self):
        row = OperatingExpense(
            id="other-1", expense_month="2026-08",
            category="other", expense_kind="other", source="manual",
            amount=100, payment_status="paid", invoice_status="none",
        )
        self.db.add(row)
        self.db.commit()
        result = update_operating_expense(
            "other-1", OperatingExpenseUpdate(amount=110), db=self.db
        )
        self.assertEqual(result.amount, 110)


if __name__ == "__main__":
    unittest.main()
