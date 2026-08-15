import unittest
from decimal import Decimal

from app.services.rd_prepayment import financial_payable


class RdPrepaymentTests(unittest.TestCase):
    def test_full_prepayment_deduction_keeps_zero_cash_payable(self):
        deduction, payable = financial_payable(20, 50)
        self.assertEqual(deduction, Decimal("20"))
        self.assertEqual(payable, Decimal("0"))

    def test_partial_prepayment_leaves_cash_payable(self):
        deduction, payable = financial_payable(20, 12)
        self.assertEqual(deduction, Decimal("12"))
        self.assertEqual(payable, Decimal("8"))

    def test_negative_settlement_never_recharges_prepayment(self):
        deduction, payable = financial_payable(-20, 12)
        self.assertEqual(deduction, Decimal("0"))
        self.assertEqual(payable, Decimal("20"))


if __name__ == "__main__":
    unittest.main()
