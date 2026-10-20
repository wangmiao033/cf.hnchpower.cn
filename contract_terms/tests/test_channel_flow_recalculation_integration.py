"""Exercise persisted channel flow through the service's amount checks."""
import unittest
from unittest.mock import Mock, patch

from settlement_recalculator_v4 import calculate_contract_standard_amount_v4
from v3_main import _apply_amount_recalculation, _raw_channel_bill
from v4_main import _requires_difference_case


class ChannelFlowRecalculationIntegrationTests(unittest.TestCase):
    def calculate(self, *, row=None, candidate=None, reliable=True, legacy=False):
        values = {"id": "line", "billing_flow": 6, "discount_factor": .3,
                  "test_cost": 1.8, "settlement_amount": 0}
        values.update(row or {})
        conn = Mock()
        conn.execute.return_value.fetchone.return_value = {
            **values, "id": "bill", "channel_fee_mode": "percent",
            "channel_fee_rate": 5, "tax_mode": "none",
        }
        conn.execute.return_value.fetchall.return_value = [] if legacy else [values]
        bill, rows = _raw_channel_bill(conn, "bill")
        terms = {"access_item_id": "contract", "share_rate": 30,
                 "channel_fee_rate": 5, "invoice_tax_rate": 0,
                 "testing_fee": 1.8, "settlement_basis": "用户实际支付金额"}
        terms.update(candidate or {})
        source = {"line_id": "legacy" if legacy else "line", "status": "pass",
                  "checks": [], "match": {"access_item_id": "contract", "confidence": "high", "score": 90},
                  "candidates": [] if reliable else [{"access_item_id": "other", "eligible": True, "score": 89}]}
        with patch("v3_main.calculate_contract_standard_amount", calculate_contract_standard_amount_v4):
            return _apply_amount_recalculation("channel", {"lines": [source]}, bill, rows, [terms])

    def test_raw_flow_five_percent_fee_has_no_false_difference(self):
        result = self.calculate()
        line = result["lines"][0]
        self.assertEqual(line["contract_amount"]["expected_amount"], 0)
        self.assertEqual(line["contract_amount"]["status"], "pass")
        self.assertEqual(line["contract_amount"]["breakdown"]["contract_channel_fee_rate"], 5)
        self.assertEqual(result["amount_summary"]["blocking_difference_lines"], 0)
        self.assertFalse(_requires_difference_case("channel", line))

    def test_folded_line_and_header_produce_same_reference_without_double_discount(self):
        for legacy in (False, True):
            with self.subTest(legacy=legacy):
                result = self.calculate(row={"billing_flow": 3045.3, "discount_factor": 1,
                                              "refund_cost": 9, "settlement_amount": 864.83}, legacy=legacy)
                line = result["lines"][0]
                amount = line["contract_amount"]
                self.assertEqual(amount["expected_amount"], 864.83)
                self.assertEqual(amount["breakdown"]["effective_flow"], 3045.3)
                # Refund clauses remain non-machine-verifiable, as before.
                self.assertEqual(amount["status"], "manual")
                self.assertFalse(amount["deterministic"])
                self.assertFalse(_requires_difference_case("channel", line))

    def test_unknown_contract_and_unreliable_identity_stay_manual(self):
        for options in ({"candidate": {"settlement_basis": ""}}, {"reliable": False}):
            with self.subTest(options=options):
                result = self.calculate(**options)
                line = result["lines"][0]
                self.assertEqual(line["contract_amount"]["expected_amount"], 0)
                self.assertEqual(line["contract_amount"]["status"], "manual")
                self.assertFalse(line["contract_amount"]["deterministic"])
                self.assertEqual(line["status"], "warning")
                self.assertFalse(_requires_difference_case("channel", line))
                self.assertEqual(result["amount_summary"]["blocking_difference_lines"], 0)

    def test_real_difference_still_creates_case(self):
        result = self.calculate(row={"billing_flow": 10, "settlement_amount": .5})
        line = result["lines"][0]
        self.assertEqual(line["contract_amount"]["expected_amount"], .34)
        self.assertEqual(line["contract_amount"]["status"], "fail")
        self.assertTrue(_requires_difference_case("channel", line))


if __name__ == "__main__":
    unittest.main()
