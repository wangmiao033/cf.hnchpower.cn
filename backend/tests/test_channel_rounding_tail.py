from types import SimpleNamespace
import unittest

from app.services.channel_settlement_engine import aggregate_validation, calculate_channel_line


class ChannelRoundingTailTests(unittest.TestCase):
    def setUp(self):
        self.record = SimpleNamespace(
            settlement_rule_code="legacy_fixed_fee_tax",
            channel_fee_mode="fixed",
            channel_fee_rate=0,
            tax_mode="share",
            validation_tolerance=0.05,
        )

    def line(self, flow: float, share_rate: float, tax_rate: float, platform: float):
        return SimpleNamespace(
            billing_flow=flow,
            discount_factor=1,
            voucher_cost=0,
            no_worry_cost=0,
            refund_cost=0,
            test_cost=0,
            welfare_cost=0,
            coin_cost=0,
            share_rate=share_rate,
            tax_rate=tax_rate,
            gateway_cost=0,
            platform_settlement_amount=platform,
        )

    def calculate(self, *args):
        line = self.line(*args)
        result = calculate_channel_line(line, self.record)
        for key, value in result.items():
            setattr(line, key, value)
        return line

    def test_excel_style_final_rounding_tail_uses_precision_total(self):
        lines = [
            self.calculate(360.86, 30, 5, 102.85),
            self.calculate(6.48, 30, 5, 1.85),
            self.calculate(15.55, 30, 5, 4.43),
            self.calculate(1747.17, 22, 0, 384.38),
        ]

        self.assertEqual(
            [float(line.system_settlement_amount) for line in lines],
            [102.85, 1.85, 4.43, 384.38],
        )
        result = aggregate_validation(lines, self.record)

        self.assertEqual(float(result["platform_total"]), 493.51)
        self.assertEqual(float(result["system_total"]), 493.50)
        self.assertEqual(float(result["difference_total"]), -0.01)
        self.assertEqual(float(result["settlement_total"]), 493.50)
        self.assertEqual(result["validation_status"], "pass")
        self.assertTrue(result["rounding_tail_applied"])

    def test_existing_line_tolerance_behavior_is_preserved(self):
        # This is a real platform-vs-system line difference, not an aggregation
        # tail. Existing channel rules may intentionally allow up to 0.05.
        line = self.calculate(360.86, 30, 5, 102.86)
        self.assertEqual(line.validation_status, "pass")

        other_lines = [
            line,
            self.calculate(6.48, 30, 5, 1.85),
            self.calculate(15.55, 30, 5, 4.43),
            self.calculate(1747.17, 22, 0, 384.38),
        ]
        result = aggregate_validation(other_lines, self.record)
        self.assertFalse(result["rounding_tail_applied"])
        self.assertEqual(float(result["system_total"]), 493.51)
        self.assertEqual(float(result["settlement_total"]), 493.52)


if __name__ == "__main__":
    unittest.main()
