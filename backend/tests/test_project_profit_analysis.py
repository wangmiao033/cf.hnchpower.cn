from __future__ import annotations

import unittest

from app.services.profit_analysis import ProfitGameBucket
from app.services.project_profit_analysis import _has_value, _month_row


class ProjectProfitAnalysisTests(unittest.TestCase):
    def test_month_row_uses_only_attributable_costs(self) -> None:
        bucket = ProfitGameBucket(
            channel_settlement=100.0,
            rd_cost=20.0,
            server_cost_allocated=5.0,
            attributed_expense=10.0,
        )

        row = _month_row("2026-08", bucket)

        self.assertEqual(row["total_attributable_cost"], 35.0)
        self.assertEqual(row["gross_profit"], 65.0)
        self.assertEqual(row["gross_margin"], 65.0)

    def test_cost_only_project_is_kept(self) -> None:
        bucket = ProfitGameBucket(rd_cost=4000.0)
        self.assertTrue(_has_value(bucket))

        row = _month_row("2026-08", bucket)
        self.assertEqual(row["gross_profit"], -4000.0)
        self.assertEqual(row["gross_margin"], 0)


if __name__ == "__main__":
    unittest.main()
