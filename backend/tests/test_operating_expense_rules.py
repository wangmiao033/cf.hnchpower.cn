import unittest

from fastapi import HTTPException

from app.api.operating_expense import _validate_category, _validate_month


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


if __name__ == "__main__":
    unittest.main()
