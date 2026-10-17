from __future__ import annotations

import unittest

from channel_rule_recommender import _discount_factor_from_game_name, recommend_channel_rules


class ChannelRuleRecommenderAnjiuDiscountTests(unittest.TestCase):
    def test_discount_factor_is_parsed_from_game_name(self):
        self.assertEqual(_discount_factor_from_game_name("一起来修仙（0.05折）"), 0.005)
        self.assertEqual(_discount_factor_from_game_name("云上征途3折大混服"), 0.3)

    def test_prefers_exact_discount_variant_for_yunshang(self):
        bill_partner = "广东安久科技有限公司"
        bill_channel = "游戏fan（安久）"
        lines = [{"line_index": 0, "game_name": "云上征途3折大混服", "settlement_cycle": "2026-07"}]
        candidates = [
            {
                "access_item_id": "generic",
                "contract_id": "c1",
                "contract_name": "安久合同",
                "partner_name": "广东安久科技有限公司",
                "channel_name": "游戏fan（安久）",
                "product_name": "云上征途",
                "authorization_start": "2026-01-01",
                "authorization_end": "2026-12-31",
                "share_rate": 30,
                "channel_fee_rate": 5,
                "invoice_tax_rate": 0,
                "access_status": "生效",
            },
            {
                "access_item_id": "exact-3zhe",
                "contract_id": "c1",
                "contract_name": "安久合同",
                "partner_name": "广东安久科技有限公司",
                "channel_name": "游戏fan（安久）",
                "product_name": "云上征途3折大混服",
                "authorization_start": "2026-01-01",
                "authorization_end": "2026-12-31",
                "share_rate": 25,
                "channel_fee_rate": 0,
                "invoice_tax_rate": 0,
                "access_status": "生效",
            },
        ]

        result = recommend_channel_rules(bill_partner, bill_channel, lines, candidates)
        row = result["lines"][0]
        self.assertEqual(row["match"]["access_item_id"], "exact-3zhe")
        self.assertEqual(row["recommended"]["share_rate"], 25)
        self.assertEqual(row["recommended"]["channel_fee_rate"], 0)
        self.assertEqual(row["recommended"]["discount_factor"], 0.3)


if __name__ == "__main__":
    unittest.main()
