import unittest
from collections import defaultdict
from types import SimpleNamespace

from app.services.monthly_business_dashboard import (
    GameBucket,
    MonthBucket,
    _add_channel_records,
    _add_rd_records,
    _derived,
    metric,
    month_key,
    month_window,
)


class MonthlyBusinessDashboardTest(unittest.TestCase):
    def test_month_helpers(self):
        self.assertEqual(month_key("2026年7月"), "2026-07")
        self.assertEqual(month_key("2026-08-01"), "2026-08")
        self.assertEqual(month_window("2026-03", 3), ["2026-01", "2026-02", "2026-03"])

    def test_rd_multi_period_bill_is_split_by_line_cycle(self):
        records = [
            SimpleNamespace(
                id="rd-1",
                status="confirmed",
                settlement_month="2026-06",
                settlement_amount=450,
                game_name="A",
                game_flow=2200,
                line_items=[
                    SimpleNamespace(
                        settlement_cycle="2026-05",
                        settlement_amount=200,
                        revenue=1000,
                        game_name="A",
                    ),
                    SimpleNamespace(
                        settlement_cycle="2026年6月",
                        settlement_amount=250,
                        revenue=1200,
                        game_name="A",
                    ),
                ],
            )
        ]
        buckets = defaultdict(MonthBucket)
        games = defaultdict(lambda: defaultdict(GameBucket))
        _add_rd_records(buckets, games, records)
        self.assertEqual(buckets["2026-05"].rd_settlement, 200)
        self.assertEqual(buckets["2026-06"].rd_settlement, 250)
        self.assertEqual(buckets["2026-05"].rd_bill_ids, {"rd-1"})
        self.assertEqual(games["2026-06"]["A"].rd_flow, 1200)

    def test_cancelled_bills_are_excluded_and_server_cost_enters_contribution(self):
        records = [
            SimpleNamespace(
                id="c1",
                status="completed",
                settlement_month="2026-07",
                settlement_amount=1000,
                server_cost=100,
                received_amount=700,
                game_name="A",
                billing_flow=1500,
                line_items=[],
            ),
            SimpleNamespace(
                id="c2",
                status="cancelled",
                settlement_month="2026-07",
                settlement_amount=999,
                server_cost=999,
                received_amount=999,
                game_name="B",
                billing_flow=999,
                line_items=[],
            ),
        ]
        buckets = defaultdict(MonthBucket)
        games = defaultdict(lambda: defaultdict(GameBucket))
        _add_channel_records(buckets, games, records)
        bucket = buckets["2026-07"]
        bucket.rd_settlement = 400
        derived = _derived(bucket)
        self.assertEqual(bucket.channel_settlement, 1000)
        self.assertEqual(bucket.server_cost, 100)
        self.assertEqual(bucket.channel_outstanding, 300)
        self.assertEqual(derived["contribution"], 500)
        self.assertEqual(derived["contribution_margin"], 50)

    def test_metric_handles_zero_previous_month(self):
        result = metric(100, 0)
        self.assertEqual(result["change_amount"], 100)
        self.assertIsNone(result["change_percent"])
        self.assertEqual(metric(0, 0)["change_percent"], 0)


if __name__ == "__main__":
    unittest.main()
