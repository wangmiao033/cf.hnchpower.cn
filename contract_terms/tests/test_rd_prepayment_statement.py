import unittest

from rd_prepayment import plan_prepayment_deductions


def _line(**kwargs):
    base = {
        "settlement": 0,
        "access_item_id": "",
        "agreed": 0,
        "used": 0,
        "funded": 0,
        "funding_count": 0,
    }
    base.update(kwargs)
    return base


class StatementPrepaymentPlanTests(unittest.TestCase):
    def test_longyin_january_statement_balance_without_contract_pool(self):
        planned = plan_prepayment_deductions([
            _line(settlement="4026.00", statement_prepayment_deduction="436.07"),
            _line(settlement="144.15", statement_prepayment_deduction="0"),
            _line(settlement="147.45", statement_prepayment_deduction="0"),
        ])
        self.assertEqual(float(planned[0]["deduction"]), 436.07)
        self.assertEqual(float(planned[1]["deduction"]), 0.0)
        self.assertEqual(float(planned[2]["deduction"]), 0.0)
        payable = sum(float(row["actual_payable"]) for row in planned)
        self.assertEqual(round(payable, 2), 3881.53)

    def test_statement_balance_cannot_exceed_settlement(self):
        planned = plan_prepayment_deductions([
            _line(settlement="100.00", statement_prepayment_deduction="436.07"),
        ])
        self.assertEqual(float(planned[0]["deduction"]), 100.0)
        self.assertEqual(float(planned[0]["actual_payable"]), 0.0)

    def test_statement_balance_is_capped_by_contract_pool(self):
        planned = plan_prepayment_deductions([
            _line(
                settlement="4317.60",
                access_item_id="A1",
                agreed="1000.00",
                used="900.00",
                statement_prepayment_deduction="436.07",
            ),
        ])
        self.assertEqual(float(planned[0]["deduction"]), 100.0)
        self.assertEqual(float(planned[0]["actual_payable"]), 4217.6)

    def test_statement_balance_uses_the_line_that_owns_the_pool(self):
        planned = plan_prepayment_deductions([
            _line(settlement="100.00", statement_prepayment_deduction="436.07"),
            _line(
                settlement="4217.60",
                access_item_id="A1",
                agreed="500.00",
                statement_prepayment_deduction="0",
            ),
        ])
        self.assertEqual(float(planned[0]["deduction"]), 0.0)
        self.assertEqual(float(planned[1]["deduction"]), 436.07)

    def test_contract_pool_still_auto_deducts_in_line_order(self):
        planned = plan_prepayment_deductions([
            _line(settlement="300.00", access_item_id="A1", agreed="500.00"),
            _line(settlement="300.00", access_item_id="A1", agreed="500.00"),
        ])
        self.assertEqual(float(planned[0]["deduction"]), 300.0)
        self.assertEqual(float(planned[1]["deduction"]), 200.0)
        self.assertEqual(float(planned[1]["available_before"]), 200.0)


if __name__ == "__main__":
    unittest.main()
