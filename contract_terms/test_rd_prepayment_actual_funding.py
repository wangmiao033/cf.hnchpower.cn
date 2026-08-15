import unittest
from decimal import Decimal

from rd_prepayment import _money


class RdPrepaymentActualFundingTests(unittest.TestCase):
    def test_money_rounds_to_financial_cent(self):
        self.assertEqual(_money("12.345"), Decimal("12.35"))

    def test_money_rejects_invalid_values(self):
        self.assertEqual(_money("not-a-number"), Decimal("0.00"))


if __name__ == "__main__":
    unittest.main()
