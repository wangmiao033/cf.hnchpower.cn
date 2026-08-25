from types import SimpleNamespace
import unittest

from app.services.profit_analysis import _channel_business_total


class ChannelSettlementAdjustmentAnalyticsTests(unittest.TestCase):
    def test_adjusted_bill_keeps_business_line_total_for_profit_analysis(self):
        record = SimpleNamespace(
            settlement_amount=376.00,
            settlement_adjustment_amount=-498.64,
            settlement_final_override=376.00,
            line_items=[
                SimpleNamespace(settlement_amount=430.52),
                SimpleNamespace(settlement_amount=444.08),
            ],
        )
        self.assertAlmostEqual(_channel_business_total(record), 874.60, places=2)

    def test_normal_bill_still_uses_parent_settlement(self):
        record = SimpleNamespace(
            settlement_amount=874.60,
            settlement_adjustment_amount=0,
            settlement_final_override=None,
            line_items=[SimpleNamespace(settlement_amount=430.52), SimpleNamespace(settlement_amount=444.08)],
        )
        self.assertAlmostEqual(_channel_business_total(record), 874.60, places=2)


if __name__ == "__main__":
    unittest.main()
