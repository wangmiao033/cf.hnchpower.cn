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


if __name__ == "__main__":
    unittest.main()
