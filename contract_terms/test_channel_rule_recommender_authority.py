import unittest

from channel_rule_recommender import recommend_channel_rules


class ChannelContractAuthorityTests(unittest.TestCase):
    partner = "重庆天盛网络传媒有限责任公司"

    def candidate(
        self,
        *,
        access_id,
        game,
        share=25,
        fee=0,
        tax=0,
        start="2026-01-01",
        end="2026-12-31",
    ):
        return {
            "contract_id": "C-TIANSHENG",
            "contract_name": "重庆天盛渠道合作合同",
            "contract_no": "HT-TS-2026",
            "access_item_id": access_id,
            "partner_name": self.partner,
            "partner_short_name": "天盛（重庆天盛）",
            "counterparty": self.partner,
            "product_name": game,
            "channel_name": "",
            "authorization_start": start,
            "authorization_end": end,
            "share_rate": share,
            "channel_fee_rate": fee,
            "invoice_tax_rate": tax,
            "settlement_mode": "流水分成",
            "settlement_basis": "按平台账单结算",
            "payment_terms": "月结",
        }

    def uniform_candidates(self):
        return [
            self.candidate(access_id="A1", game="龙吟大陆"),
            self.candidate(access_id="A2", game="一起来修仙"),
            self.candidate(access_id="A3", game="云上征途"),
            self.candidate(access_id="A4", game="圣树唤歌"),
        ]

    def test_partner_selection_can_apply_uniform_contract_baseline_before_game_month(self):
        result = recommend_channel_rules(
            self.partner,
            "天盛（重庆天盛）",
            [{"line_index": -1, "game_name": "", "settlement_cycle": ""}],
            self.uniform_candidates(),
        )
        self.assertTrue(result["partner_auto_apply"])
        self.assertEqual(result["partner_rule_status"], "uniform")
        self.assertEqual(result["partner_recommendation"]["share_rate"], 25)
        self.assertEqual(result["partner_recommendation"]["channel_fee_rate"], 0)
        self.assertEqual(result["partner_recommendation"]["tax_rate"], 0)
        self.assertEqual(result["partner_recommendation"]["channel_fee_mode"], "none")
        self.assertEqual(result["total_lines"], 0)

    def test_game_and_month_lock_exact_contract_item(self):
        result = recommend_channel_rules(
            self.partner,
            "天盛（重庆天盛）",
            [{"line_index": 0, "game_name": "圣树唤歌", "settlement_cycle": "2026-01"}],
            self.uniform_candidates(),
        )
        self.assertTrue(result["auto_apply"])
        self.assertEqual(result["matched_lines"], 1)
        row = result["lines"][0]
        self.assertTrue(row["auto_apply"])
        self.assertEqual(row["match"]["access_item_id"], "A4")
        self.assertEqual(row["recommended"]["share_rate"], 25)
        self.assertEqual(row["recommended"]["tax_rate"], 0)
        self.assertEqual(row["recommended"]["channel_fee_rate"], 0)

    def test_exact_identity_can_apply_when_authorization_dates_are_unstructured(self):
        candidates = [
            self.candidate(
                access_id="A1",
                game="龙吟大陆（内置0.1折正版放置手游）",
                start=None,
                end=None,
            )
        ]
        result = recommend_channel_rules(
            self.partner,
            "天盛（重庆天盛）",
            [{"line_index": 0, "game_name": "龙吟大陆", "settlement_cycle": "2026-01"}],
            candidates,
        )
        self.assertTrue(result["auto_apply"])
        row = result["lines"][0]
        self.assertTrue(row["auto_apply"])
        self.assertTrue(row["authorization_warning"])
        self.assertEqual(row["recommended"]["share_rate"], 25)
        self.assertEqual(row["recommended"]["channel_fee_rate"], 0)
        self.assertEqual(row["recommended"]["tax_rate"], 0)
        self.assertIn("授权期未结构化", result["message"])

    def test_explicit_out_of_range_authorization_still_blocks_auto_apply(self):
        candidates = [
            self.candidate(
                access_id="A1",
                game="龙吟大陆",
                start="2025-01-01",
                end="2025-12-31",
            )
        ]
        result = recommend_channel_rules(
            self.partner,
            "天盛（重庆天盛）",
            [{"line_index": 0, "game_name": "龙吟大陆", "settlement_cycle": "2026-01"}],
            candidates,
        )
        self.assertFalse(result["auto_apply"])
        row = result["lines"][0]
        self.assertFalse(row["auto_apply"])
        self.assertIn("不在授权期内", row["message"])

    def test_partner_with_multiple_contract_rules_does_not_guess_baseline(self):
        candidates = self.uniform_candidates()
        candidates[-1] = self.candidate(access_id="A4", game="圣树唤歌", share=30)
        baseline = recommend_channel_rules(
            self.partner,
            "天盛（重庆天盛）",
            [{"line_index": -1, "game_name": "", "settlement_cycle": ""}],
            candidates,
        )
        self.assertFalse(baseline["partner_auto_apply"])
        self.assertEqual(baseline["partner_rule_status"], "ambiguous")
        self.assertIsNone(baseline["partner_recommendation"])

        precise = recommend_channel_rules(
            self.partner,
            "天盛（重庆天盛）",
            [{"line_index": 0, "game_name": "龙吟大陆", "settlement_cycle": "2026-01"}],
            candidates,
        )
        self.assertTrue(precise["auto_apply"])
        self.assertEqual(precise["lines"][0]["recommended"]["share_rate"], 25)

    def test_missing_structured_fee_never_turns_into_false_zero_contract_rule(self):
        candidates = [self.candidate(access_id="A1", game="龙吟大陆", fee=None)]
        result = recommend_channel_rules(
            self.partner,
            "天盛（重庆天盛）",
            [{"line_index": 0, "game_name": "龙吟大陆", "settlement_cycle": "2026-01"}],
            candidates,
        )
        self.assertFalse(result["partner_auto_apply"])
        self.assertEqual(result["partner_rule_status"], "incomplete")
        self.assertFalse(result["lines"][0]["auto_apply"])


if __name__ == "__main__":
    unittest.main()
