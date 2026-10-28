"""QuickSDK month aggregates fold names the same way as the billing UI."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

from fastapi import HTTPException

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_proxy_main():
    proxy_dir = str(REPO_ROOT / "proxy")
    if proxy_dir not in sys.path:
        sys.path.insert(0, proxy_dir)
    spec = importlib.util.spec_from_file_location(
        "caiwu_data_service_main",
        REPO_ROOT / "proxy" / "main.py",
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class QuickFlowAggregateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.proxy = _load_proxy_main()

    def test_product_names_fold_before_the_month_total(self):
        items = self.proxy._fold_quick_rd_lines(
            [
                {"game_name": "六界飞仙005专服12", "channel_name": "", "row_count": 2, "gross_flow": 10},
                {"game_name": "六界飞仙005", "channel_name": "3387游戏", "row_count": 1, "gross_flow": 5},
                {"game_name": "云上征途005折混服", "channel_name": "3387游戏", "row_count": 4, "gross_flow": 99},
            ],
            settlement_month="2026-06",
            q=None,
        )
        folded = {item["game_name"]: item for item in items}
        self.assertEqual(set(folded), {"六界飞仙", "云上征途"})
        self.assertEqual(folded["六界飞仙"]["row_count"], 3)
        self.assertEqual(folded["六界飞仙"]["total_flow"], 15)
        self.assertEqual(folded["六界飞仙"]["channel_count"], 2)
        self.assertEqual(folded["六界飞仙"]["source_game_count"], 2)
        self.assertIn("未填渠道", {folded["六界飞仙"]["top_channel"], "3387游戏"})

    def test_unscoped_raw_flow_read_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            self.proxy._require_quick_flow_scope(
                settlement_month=None,
                game_name=None,
                channel_name=None,
                q=None,
            )
        self.assertEqual(raised.exception.status_code, 422)
        self.proxy._require_quick_flow_scope(settlement_month="2026-06")


if __name__ == "__main__":
    unittest.main()
