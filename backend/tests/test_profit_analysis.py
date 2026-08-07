import unittest
from collections import defaultdict
from types import SimpleNamespace

from fastapi import HTTPException

from app.api.operating_expense import _validate_category, _validate_month
from app.services.profit_analysis import (
    ProfitGameBucket,
    ProfitMonthBucket,
    _add_channel_income,
    _add_expenses,
    _add_rd_costs,
    _derive,
    _game_rows,
)


class ProfitAnalysisTest(unittest.TestCase):
    def test_expense_month_and_category_validation(self):
        self.assertEqual(_validate_month("2026年8月"), "2026-08")
        self.assertEqual(_validate_category("marketing"), "marketing")
        with self.assertRaises(HTTPException):
            _validate_month("not-a-month")
        with self.assertRaises(HTTPException):
            _validate_category("unknown-cost")

    def test_rd_multi_period_cost_is_split_by_line_month(self):
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
        months = defaultdict(ProfitMonthBucket)
        games = defaultdict(lambda: defaultdict(ProfitGameBucket))
        _add_rd_costs(months, games, records)
        self.assertEqual(months["2026-05"].rd_cost, 200)
        self.assertEqual(months["2026-06"].rd_cost, 250)
        self.assertEqual(games["2026-06"]["A"].rd_cost, 250)

    def test_multigame_channel_server_cost_is_allocated_by_settlement_share(self):
        records = [
            SimpleNamespace(
                id="c-1",
                status="completed",
                settlement_month="2026-07",
                settlement_amount=1000,
                server_cost=100,
                game_name="A、B",
                billing_flow=3000,
                line_items=[
                    SimpleNamespace(game_name="A", settlement_amount=300, billing_flow=1000),
                    SimpleNamespace(game_name="B", settlement_amount=700, billing_flow=2000),
                ],
            )
        ]
        months = defaultdict(ProfitMonthBucket)
        games = defaultdict(lambda: defaultdict(ProfitGameBucket))
        _add_channel_income(months, games, records)
        self.assertEqual(months["2026-07"].channel_settlement, 1000)
        self.assertEqual(months["2026-07"].server_cost, 100)
        self.assertAlmostEqual(games["2026-07"]["A"].server_cost_allocated, 30)
        self.assertAlmostEqual(games["2026-07"]["B"].server_cost_allocated, 70)
        self.assertAlmostEqual(games["2026-07"]["A"].channel_settlement, 300)
        self.assertAlmostEqual(games["2026-07"]["B"].channel_settlement, 700)

    def test_operating_expenses_separate_shared_and_product_cost(self):
        expenses = [
            SimpleNamespace(
                expense_month="2026-07",
                amount=120,
                category="marketing",
                game_name="A",
            ),
            SimpleNamespace(
                expense_month="2026-07",
                amount=80,
                category="office",
                game_name=None,
            ),
        ]
        months = defaultdict(ProfitMonthBucket)
        games = defaultdict(lambda: defaultdict(ProfitGameBucket))
        _add_expenses(months, games, expenses)
        bucket = months["2026-07"]
        self.assertEqual(bucket.operating_expense, 200)
        self.assertEqual(bucket.attributed_expense, 120)
        self.assertEqual(bucket.shared_expense, 80)
        self.assertEqual(bucket.category_expenses["marketing"], 120)
        self.assertEqual(games["2026-07"]["A"].attributed_expense, 120)

    def test_company_profit_deducts_all_expenses_but_product_profit_only_attributed(self):
        bucket = ProfitMonthBucket(
            channel_settlement=1000,
            rd_cost=400,
            server_cost=100,
            operating_expense=200,
            shared_expense=80,
            attributed_expense=120,
        )
        derived = _derive(bucket)
        self.assertEqual(derived["pre_expense_contribution"], 500)
        self.assertEqual(derived["operating_profit"], 300)
        self.assertEqual(derived["profit_margin"], 30)

        games = {
            "A": ProfitGameBucket(
                channel_settlement=1000,
                rd_cost=400,
                server_cost_allocated=100,
                attributed_expense=120,
            )
        }
        rows = _game_rows(games)
        self.assertEqual(rows[0]["attributable_profit"], 380)
        self.assertEqual(rows[0]["attributable_margin"], 38)

    def test_cancelled_channel_bill_is_excluded(self):
        records = [
            SimpleNamespace(
                id="c-x",
                status="cancelled",
                settlement_month="2026-07",
                settlement_amount=999,
                server_cost=99,
                game_name="X",
                billing_flow=999,
                line_items=[],
            )
        ]
        months = defaultdict(ProfitMonthBucket)
        games = defaultdict(lambda: defaultdict(ProfitGameBucket))
        _add_channel_income(months, games, records)
        self.assertEqual(months["2026-07"].channel_settlement, 0)
        self.assertEqual(months["2026-07"].server_cost, 0)


if __name__ == "__main__":
    unittest.main()
