import unittest

from fastapi import HTTPException

from types import SimpleNamespace

from app.api.operating_expense import (
    _payroll_workflow_status,
    _validate_category,
    _validate_month,
    _validate_payroll_review_status,
    _validate_payroll_workflow_status,
)


class OperatingExpenseRulesTest(unittest.TestCase):
    def test_month_normalization(self):
        self.assertEqual(_validate_month("2026-7"), "2026-07")
        self.assertEqual(_validate_month("2026年7月"), "2026-07")

    def test_invalid_month_is_rejected(self):
        with self.assertRaises(HTTPException) as context:
            _validate_month("July 2026")
        self.assertEqual(context.exception.status_code, 422)

    def test_supported_categories(self):
        self.assertEqual(_validate_category("marketing"), "marketing")
        self.assertEqual(_validate_category("PAYROLL"), "payroll")

    def test_unknown_category_is_rejected(self):
        with self.assertRaises(HTTPException) as context:
            _validate_category("random-cost")
        self.assertEqual(context.exception.status_code, 422)
        self.assertEqual(context.exception.detail["error"], "invalid_expense_category")

    def test_payroll_review_statuses(self):
        self.assertEqual(_validate_payroll_review_status("pending_review"), "pending_review")
        self.assertEqual(_validate_payroll_review_status("REVIEWED"), "reviewed")
        self.assertEqual(_validate_payroll_workflow_status("paid"), "paid")
        with self.assertRaises(HTTPException):
            _validate_payroll_review_status("paid")

    def test_payroll_workflow_prioritizes_actual_payment(self):
        batch = SimpleNamespace(review_status="pending_review")
        expense = SimpleNamespace(payment_status="unpaid")
        self.assertEqual(_payroll_workflow_status(batch, expense), "pending_review")
        batch.review_status = "reviewed"
        self.assertEqual(_payroll_workflow_status(batch, expense), "reviewed")
        expense.payment_status = "paid"
        self.assertEqual(_payroll_workflow_status(batch, expense), "paid")


if __name__ == "__main__":
    unittest.main()
