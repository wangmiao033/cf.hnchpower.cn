import unittest

from channel_rule_recommender import recommend_channel_rules


class ChannelRuleRecommenderP0Tests(unittest.TestCase):
    partner = "厦门游戏之家科技有限公司"

    def candidate(self, access_id, game, *, fee, share=30, tax=None):
        return {
            "contract_id": "C-3387",
            "contract_name": "3387厦门游戏之家--熊动 合作协议",
            "contract_no": "HT-2024-00013",
            "access_item_id": access_id,
            "partner_name": self.partner,
            "partner_short_name": "厦门游戏之家",
            "counterparty": self.partner,
            "product_name": game,
            "channel_name": "",
            "authorization_start": "2024-10-01",
            "authorization_end": "2028-12-31",
            "share_rate": share,
            "channel_fee_rate": fee,
            "invoice_tax_rate": tax,
            "settlement_mode": "流水分成",
            "settlement_basis": "按平台账单结算",
            "payment_terms": "月结",
            "access_status": "生效",
            "performance_status": "履约中",
        }

    def test_exact_game_with_missing_fee_is_not_replaced_by_other_game_baseline(self):
        candidates = [
            self.candidate("A-DRAGON", "龙吟大陆", fee=0, tax=0),
            self.candidate("A-TREE", "圣树唤歌", fee=None, tax=0),
        ]

        result = recommend_channel_rules(
            self.partner,
            "厦门游戏之家",
            [{"line_index": 0, "game_name": "圣树唤歌", "settlement_cycle": "2026-01"}],
            candidates,
        )

        row = result["lines"][0]
        self.assertEqual(row["match"]["access_item_id"], "A-TREE")
        self.assertIsNone(row["recommended"]["channel_fee_rate"])
        self.assertFalse(row["auto_apply"])
        self.assertFalse(result["partner_auto_apply"])
        self.assertIsNone(result["partner_recommendation"])

    def test_mixed_contract_fees_survive_missing_invoice_tax(self):
        candidates = [
            self.candidate("A-DRAGON", "龙吟大陆", fee=0),
            self.candidate("A-TREE", "圣树唤歌", fee=6),
            self.candidate("A-CULTIVATE", "一起来修仙", fee=6),
        ]

        result = recommend_channel_rules(
            self.partner,
            "厦门游戏之家",
            [
                {"line_index": 0, "game_name": "龙吟大陆", "settlement_cycle": "2026-01"},
                {"line_index": 1, "game_name": "圣树唤歌", "settlement_cycle": "2026-01"},
                {"line_index": 2, "game_name": "一起来修仙", "settlement_cycle": "2026-01"},
            ],
            candidates,
        )

        self.assertEqual(
            [line["recommended"]["channel_fee_rate"] for line in result["lines"]],
            [0, 6, 6],
        )
        self.assertTrue(all(line["auto_apply"] for line in result["lines"]))
        self.assertTrue(all(line["tax_rate_warning"] for line in result["lines"]))
        self.assertFalse(result["auto_apply"])


if __name__ == "__main__":
    unittest.main()
