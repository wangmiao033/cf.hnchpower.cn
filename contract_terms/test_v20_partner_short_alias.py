from __future__ import annotations

import unittest

# Importing v20 installs V19 discount normalization plus the trusted short-name bridge.
import v20_main  # noqa: F401
import channel_rule_recommender
import matcher


class V20PartnerShortAliasTests(unittest.TestCase):
    def candidate(self, *, product_name="一起来修仙0.05折", short_name="爱趣"):
        return {
            "contract_id": "C-AIQU",
            "contract_name": "爱趣渠道合作合同",
            "contract_no": "HT-AIQU",
            "access_item_id": "A-AIQU-005",
            # Legacy/master data can contain only the short finance name here.
            "partner_name": short_name,
            "partner_short_name": short_name,
            "counterparty": "",
            "product_name": product_name,
            "channel_name": "",
            "authorization_start": "2025-01-01",
            "authorization_end": "2026-12-31",
            "share_rate": 30,
            "channel_fee_rate": 0,
            "invoice_tax_rate": 0,
            "access_status": "",
            "performance_status": "",
        }

    def test_aiqu_legal_name_and_short_alias_match_005_discount_contract(self):
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
        self.assertEqual(row["match"]["access_item_id"], "A-AIQU-005")
        self.assertEqual(row["recommended"]["share_rate"], 30)
        self.assertEqual(row["recommended"]["channel_fee_rate"], 0)

        scored = matcher.score_candidate(
            {
                "partner_name": "昆山爱趣网络科技有限公司",
                "channel_name": "爱趣",
                "settlement_month": "2026-01",
            },
            {"game_name": "一起来修仙005折", "settlement_cycle": "2026-01"},
            self.candidate(),
        )
        self.assertTrue(scored["eligible"])
        self.assertEqual(scored.get("partner_match_method"), "trusted_short_alias")
        self.assertEqual(scored.get("partner_short_alias"), "爱趣")
        self.assertIn("商业版本一致（0.05折）", scored["reasons"])

    def test_unrelated_two_character_short_alias_does_not_cross_partner(self):
        result = channel_rule_recommender.recommend_channel_rules(
            "昆山爱趣网络科技有限公司",
            "爱趣",
            [{"line_index": 0, "game_name": "一起来修仙005折", "settlement_cycle": "2026-01"}],
            [self.candidate(short_name="爱玩")],
        )
        self.assertEqual(result["matched_lines"], 0)
        self.assertFalse(result["auto_apply"])

    def test_short_alias_does_not_bypass_discount_version_conflict(self):
        scored = matcher.score_candidate(
            {
                "partner_name": "昆山爱趣网络科技有限公司",
                "channel_name": "爱趣",
                "settlement_month": "2026-01",
            },
            {"game_name": "一起来修仙005折", "settlement_cycle": "2026-01"},
            self.candidate(product_name="一起来修仙0.1折"),
        )
        self.assertFalse(scored["eligible"])


if __name__ == "__main__":
    unittest.main()
