import unittest
from collections import defaultdict
from types import SimpleNamespace

from app.services.profit_analysis import (
    ProfitGameBucket,
    ProfitMonthBucket,
    _add_server_costs,
    _derive,
)


class StandaloneServerCostProfitTest(unittest.TestCase):
    def test_product_and_shared_server_costs_have_distinct_product_behavior(self):
        costs = [
            SimpleNamespace(
                status="active",
                expense_month="2026-07",
                amount=300,
                game_name="云上征途005小混",
            ),
            SimpleNamespace(
                status="active",
                expense_month="2026-07",
                amount=200,
                game_name=None,
            ),
            SimpleNamespace(
                status="void",
                expense_month="2026-07",
                amount=999,
                game_name="云上征途",
            ),
        ]
        months = defaultdict(ProfitMonthBucket)
        games = defaultdict(lambda: defaultdict(ProfitGameBucket))

        _add_server_costs(months, games, costs)

        bucket = months["2026-07"]
        self.assertEqual(bucket.server_cost, 500)
        self.assertEqual(bucket.standalone_server_cost, 500)
        self.assertEqual(bucket.attributed_server_cost, 300)
        self.assertEqual(bucket.shared_server_cost, 200)
        self.assertEqual(bucket.server_cost_count, 2)
        self.assertEqual(games["2026-07"]["云上征途"].server_cost_allocated, 300)

    def test_company_profit_deducts_shared_server_cost_too(self):
        bucket = ProfitMonthBucket(
            channel_settlement=2000,
            rd_cost=800,
            server_cost=500,
            operating_expense=200,
        )
        derived = _derive(bucket)
        self.assertEqual(derived["pre_expense_contribution"], 700)
        self.assertEqual(derived["operating_profit"], 500)
        self.assertEqual(derived["profit_margin"], 25)


if __name__ == "__main__":
    unittest.main()
