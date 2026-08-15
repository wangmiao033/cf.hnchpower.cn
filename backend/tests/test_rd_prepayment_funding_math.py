import unittest
from decimal import Decimal

from app.services.rd_prepayment import financial_payable


class RdPrepaymentFundingMathTests(unittest.TestCase):
    def test_actual_bank_cap_still_reduces_cash_payable(self):
        deduction, payable = financial_payable(100, 60)
        self.assertEqual(deduction, Decimal("60"))
        self.assertEqual(payable, Decimal("40"))

    def test_deduction_never_exceeds_bill(self):
        deduction, payable = financial_payable(50, 200)
        self.assertEqual(deduction, Decimal("50"))
        self.assertEqual(payable, Decimal("0"))


if __name__ == "__main__":
    unittest.main()
