from types import SimpleNamespace
import unittest

from app.services.channel_settlement_engine import calculate_channel_line


class ChannelSettlementEngineTests(unittest.TestCase):
    def setUp(self):
        self.record = SimpleNamespace(
            settlement_rule_code="xiaomi_percent_fee",
            channel_fee_mode="percent",
            channel_fee_rate=5,
            tax_mode="none",
            validation_tolerance=0.05,
        )

    def line(self, flow, voucher, platform, tax=6):
        return SimpleNamespace(
            billing_flow=flow,
            discount_factor=1,
            voucher_cost=voucher,
            no_worry_cost=0,
            refund_cost=0,
            test_cost=0,
            welfare_cost=0,
            coin_cost=0,
            share_rate=50,
            tax_rate=tax,
            gateway_cost=0,
            platform_settlement_amount=platform,
        )

    def test_xiaomi_rows_match_platform_with_rounding_tolerance(self):
        cases = [
            (5122, 769.2, 2067.61, 2067.58),
            (6, 0, 2.85, 2.85),
            (530, 79.5, 213.99, 213.99),
            (6, 0.9, 2.42, 2.42),
        ]
        platform_total = system_total = 0
        for flow, voucher, platform, expected_system in cases:
            result = calculate_channel_line(self.line(flow, voucher, platform), self.record)
            self.assertEqual(float(result["system_settlement_amount"]), expected_system)
            self.assertEqual(result["validation_status"], "pass")
            self.assertEqual(float(result["settlement_amount"]), platform)
            platform_total += platform
            system_total += expected_system
        self.assertAlmostEqual(platform_total, 2286.87, places=2)
        self.assertAlmostEqual(system_total, 2286.84, places=2)

    def test_large_mismatch_fails_validation(self):
        result = calculate_channel_line(self.line(5122, 769.2, 2171.40), self.record)
        self.assertEqual(result["validation_status"], "fail")
        self.assertAlmostEqual(float(result["settlement_difference"]), -103.82, places=2)


if __name__ == "__main__":
    unittest.main()
