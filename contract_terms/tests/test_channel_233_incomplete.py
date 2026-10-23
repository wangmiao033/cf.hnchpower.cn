import unittest
from settlement_recalculator import calculate_channel_contract_amount


class Incomplete233RecalculationTests(unittest.TestCase):
    def test_contract_cannot_turn_placeholder_zero_into_verified_amount(self):
        for amount in [0, -5.34, 120.02]:
            result = calculate_channel_contract_amount(
                {"settlement_rule_code": "channel_233_incomplete"},
                {"billing_flow": 0, "share_rate": 0, "settlement_amount": amount},
                {"share_rate": 50})
            self.assertFalse(result['deterministic'])
            self.assertFalse(result['supported'])
            self.assertIsNone(result['expected_amount'])
            self.assertEqual(result['status'], 'unvalidated')
