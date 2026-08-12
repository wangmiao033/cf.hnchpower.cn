from types import SimpleNamespace
import unittest

from app.services.channel_settlement_engine import calculate_channel_line


class XianWeizhen9917SettlementTests(unittest.TestCase):
    def record(self, code="xian_weizhen_9917"):
        return SimpleNamespace(
            settlement_rule_code=code,
            channel_fee_mode="percent",
            channel_fee_rate=5,
            tax_mode="none",
            validation_tolerance=0.05,
        )

    def line(self, *, flow, voucher=0, welfare=0, test=0, platform=None):
        return SimpleNamespace(
            billing_flow=flow,
            discount_factor=1,
            voucher_cost=voucher,
            no_worry_cost=0,
            refund_cost=0,
            test_cost=test,
            welfare_cost=welfare,
            coin_cost=0,
            share_rate=30,
            tax_rate=5,
            gateway_cost=0,
            platform_settlement_amount=platform,
        )

    def test_voucher_and_welfare_are_record_only_but_test_cost_still_deducts(self):
        result = calculate_channel_line(
            self.line(flow=82.40, voucher=51.84, welfare=73.64, test=0.42, platform=23.36),
            self.record(),
        )
        self.assertEqual(float(result["billing_amount"]), 81.98)
        self.assertEqual(float(result["system_settlement_amount"]), 23.36)
        self.assertEqual(float(result["settlement_difference"]), 0.0)
        self.assertEqual(result["validation_status"], "pass")

    def test_seven_uploaded_rows_all_pass_with_379_75_platform_total(self):
        rows = [
            (82.40, 51.84, 73.64, 0.42, 23.36),
            (44.92, 9.72, 6.10, 0, 12.80),
            (0.73, 19.44, 0, 0, 0.21),
            (46.21, 16.20, 0, 0, 13.17),
            (1.49, 9.72, 0, 0, 0.43),
            (12.96, 6.48, 0, 0, 3.69),
            (1144.19, 35.64, 0, 0, 326.09),
        ]
        system_total = 0.0
        platform_total = 0.0
        difference_total = 0.0
        for flow, voucher, welfare, test, platform in rows:
            result = calculate_channel_line(
                self.line(flow=flow, voucher=voucher, welfare=welfare, test=test, platform=platform),
                self.record(),
            )
            self.assertEqual(result["validation_status"], "pass")
            system_total += float(result["system_settlement_amount"])
            platform_total += float(result["platform_settlement_amount"])
            difference_total += float(result["settlement_difference"])

        self.assertAlmostEqual(system_total, 379.74, places=2)
        self.assertAlmostEqual(platform_total, 379.75, places=2)
        self.assertAlmostEqual(difference_total, -0.01, places=2)

    def test_other_rules_keep_voucher_and_welfare_deductions(self):
        result = calculate_channel_line(
            self.line(flow=82.40, voucher=51.84, welfare=73.64, test=0.42, platform=23.36),
            self.record(code="custom"),
        )
        self.assertEqual(float(result["system_settlement_amount"]), -12.40)
        self.assertEqual(result["validation_status"], "fail")


if __name__ == "__main__":
    unittest.main()
