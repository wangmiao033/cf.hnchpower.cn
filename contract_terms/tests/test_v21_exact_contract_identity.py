from __future__ import annotations

import unittest

# Importing v21 installs V20 compatibility plus the exact identity fast-path.
import v21_main  # noqa: F401
import channel_rule_recommender


class V21ExactContractIdentityTests(unittest.TestCase):
    def candidate(self, **overrides):
        row = {
            "contract_id": "197bc17d-0380-4b58-b700-d4420564cf1d",
            "contract_name": "爱趣-熊动",
            "contract_no": "",
            "access_item_id": "c98fb436-d40b-4340-81e1-9ce96bf57182",
            "partner_name": "昆山爱趣网络科技有限公司",
            "partner_short_name": "爱趣",
            "counterparty": "昆山爱趣网络科技有限公司",
            "product_name": "一起来修仙005折",
            "channel_name": "爱趣",
            "authorization_start": "2020-01-01",
            "authorization_end": "2028-12-31",
            "share_rate": 23,
            "channel_fee_rate": 0,
            "invoice_tax_rate": 0,
            "access_status": "生效",
            "performance_status": "履约中",
        }
        row.update(overrides)
        return row

    def test_production_aiqu_xiuxian_005_contract_auto_applies(self):
        result = channel_rule_recommender.recommend_channel_rules(
            "昆山爱趣网络科技有限公司",
            "爱趣",
            [{"line_index": 0, "game_name": "一起来修仙005折", "settlement_cycle": "2026-01"}],
            [self.candidate()],
        )

        self.assertEqual(result["matched_lines"], 1)
        self.assertTrue(result["auto_apply"])
        row = result["lines"][0]
        self.assertTrue(row["auto_apply"])
        self.assertEqual(row["match"]["access_item_id"], "c98fb436-d40b-4340-81e1-9ce96bf57182")
        self.assertEqual(row["recommended"]["share_rate"], 23)
        self.assertEqual(row["recommended"]["channel_fee_rate"], 0)
        self.assertIn("游戏与商业版本精确命中", row["match"]["reasons"])

    def test_exact_identity_does_not_cross_explicit_channel(self):
        result = channel_rule_recommender.recommend_channel_rules(
            "昆山爱趣网络科技有限公司",
            "爱趣",
            [{"line_index": 0, "game_name": "一起来修仙005折", "settlement_cycle": "2026-01"}],
            [self.candidate(channel_name="百分")],
        )
        row = result["lines"][0]
        self.assertFalse(row["auto_apply"])
        self.assertIsNone(row["match"])

    def test_exact_identity_still_blocks_out_of_range_month(self):
        result = channel_rule_recommender.recommend_channel_rules(
            "昆山爱趣网络科技有限公司",
            "爱趣",
            [{"line_index": 0, "game_name": "一起来修仙005折", "settlement_cycle": "2030-01"}],
            [self.candidate()],
        )
        row = result["lines"][0]
        self.assertFalse(row["auto_apply"])
        self.assertIsNotNone(row["match"])
        self.assertEqual(row["authorization_status"], "out_of_range")

    def jiuyou_result(self, **overrides):
        candidate = self.candidate(
            partner_name="广州爱九游信息技术有限公司",
            partner_short_name="九游（阿里、久游9游）",
            counterparty="广州爱九游信息技术有限公司",
            product_name="帝国雄师", channel_name="九游",
            share_rate=50, channel_fee_rate=5,
        )
        candidate.update(overrides)
        return channel_rule_recommender.recommend_channel_rules(
            "广州爱九游信息技术有限公司", "九游（阿里、久游9游）",
            [{"game_name": "帝国雄师", "settlement_cycle": "2026-08"}], [candidate],
        )["lines"][0]

    def test_exact_game_accepts_channel_alias_from_linked_partner_short_name(self):
        row = self.jiuyou_result()
        self.assertTrue(row["auto_apply"])
        self.assertEqual(row["recommended"]["share_rate"], 50)
        self.assertEqual(row["recommended"]["channel_fee_rate"], 5)

    def test_channel_alias_never_bridges_an_unlisted_channel(self):
        row = self.jiuyou_result(channel_name="百分")
        self.assertFalse(row["auto_apply"])
        self.assertIsNone(row["match"])

    def test_untrusted_bracketed_channel_name_is_not_stripped(self):
        row = self.jiuyou_result(partner_short_name="九游")
        self.assertFalse(row["auto_apply"])
        self.assertIsNone(row["match"])

    def test_other_decorated_channel_is_not_a_trusted_alias(self):
        row = self.jiuyou_result(channel_name="九游（另一版本）")
        self.assertFalse(row["auto_apply"])
        self.assertIsNone(row["match"])

    def test_trusted_display_name_does_not_merge_conflicting_rules(self):
        candidates = [self.candidate(channel_name="爱趣", share_rate=rate,
                                     partner_short_name="爱趣（测试别名）", access_item_id=f"test-{rate}")
                      for rate in (23, 50)]
        result = channel_rule_recommender.recommend_channel_rules(
            "昆山爱趣网络科技有限公司", "爱趣（测试别名）",
            [{"game_name": "一起来修仙005折", "settlement_cycle": "2026-08"}], candidates,
        )
        self.assertFalse(result["lines"][0]["auto_apply"])
        self.assertIn("结算规则不一致", result["lines"][0]["message"])

    def test_channel_alias_does_not_bypass_period_or_missing_fields(self):
        for overrides in [{"authorization_end": "2026-07-31"}, {"share_rate": None}, {"access_status": "作废"}]:
            with self.subTest(overrides=overrides):
                self.assertFalse(self.jiuyou_result(**overrides)["auto_apply"])


if __name__ == "__main__":
    unittest.main()
