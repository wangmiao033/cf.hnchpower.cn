import unittest

from channel_rule_recommender import recommend_channel_rules


class HistoricalContractPeriodMatchTests(unittest.TestCase):
    partner = "厦门三七三三网络科技有限公司"
    channel = "3733游戏"

    def candidate(
        self,
        *,
        status="已终止",
        start="2026-01-01",
        end="2026-07-31",
        game="一起来修仙（0.05折）",
    ):
        return {
            "contract_id": "C-3733-HISTORY",
            "contract_name": "3733历史渠道合作合同",
            "contract_no": "HT-3733-HISTORY",
            "access_item_id": "A-3733-XIUXIAN",
            "partner_name": self.partner,
            "partner_short_name": "3733",
            "counterparty": self.partner,
            "product_name": game,
            "channel_name": self.channel,
            "authorization_start": start,
            "authorization_end": end,
            "share_rate": 25,
            "channel_fee_rate": 0,
            "invoice_tax_rate": 0,
            "settlement_mode": "流水分成",
            "settlement_basis": "按平台账单结算",
            "payment_terms": "月结",
            "access_status": status,
            "performance_status": "",
        }

    def recommend(self, cycle, candidate):
        return recommend_channel_rules(
            self.partner,
            self.channel,
            [
                {
                    "line_index": 0,
                    "game_name": "一起来修仙（0.05折）",
                    "settlement_cycle": cycle,
                }
            ],
            [candidate],
        )

    def test_terminated_contract_matches_backdated_bill_when_period_was_covered(self):
        result = self.recommend("2026-07", self.candidate(status="已终止"))
        self.assertTrue(result["auto_apply"])
        row = result["lines"][0]
        self.assertTrue(row["auto_apply"])
        self.assertEqual(row["authorization_status"], "covered")
        self.assertEqual(row["match"]["access_item_id"], "A-3733-XIUXIAN")
        self.assertEqual(row["recommended"]["share_rate"], 25)

    def test_archived_contract_matches_backdated_bill_when_period_was_covered(self):
        result = self.recommend("2026-07", self.candidate(status="已归档"))
        self.assertTrue(result["auto_apply"])
        self.assertEqual(result["lines"][0]["authorization_status"], "covered")

    def test_closed_contract_does_not_match_bill_after_authorization_end(self):
        result = self.recommend("2026-08", self.candidate(status="已终止"))
        self.assertFalse(result["auto_apply"])
        row = result["lines"][0]
        self.assertIsNone(row["match"])
        self.assertIsNone(row["recommended"])
        self.assertIn("未找到匹配", row["message"])

    def test_void_contract_never_matches_even_when_period_is_covered(self):
        result = self.recommend("2026-07", self.candidate(status="已作废"))
        self.assertFalse(result["auto_apply"])
        row = result["lines"][0]
        self.assertIsNone(row["match"])
        self.assertIsNone(row["recommended"])

    def test_closed_contract_without_structured_dates_is_not_revived(self):
        result = self.recommend(
            "2026-07",
            self.candidate(status="已终止", start=None, end=None),
        )
        self.assertFalse(result["auto_apply"])
        self.assertIsNone(result["lines"][0]["match"])


if __name__ == "__main__":
    unittest.main()
