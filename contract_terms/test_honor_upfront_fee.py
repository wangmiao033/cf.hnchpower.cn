import unittest

from channel_rule_recommender import recommend_channel_rules


class HonorUpfrontChannelFeeTests(unittest.TestCase):
    def test_honor_contract_uses_gross_flow_upfront_fee_rule(self):
        candidate = {
            "contract_id": "C-HONOR",
            "contract_name": "荣耀渠道合作协议",
            "contract_no": "HT-HONOR",
            "access_item_id": "A-HONOR-GAME",
            "partner_name": "荣耀",
            "partner_short_name": "荣耀",
            "counterparty": "荣耀",
            "product_name": "创世封神",
            "channel_name": "荣耀",
            "authorization_start": "2026-01-01",
            "authorization_end": "2026-12-31",
            "share_rate": 50,
            "channel_fee_rate": 5,
            "invoice_tax_rate": 0,
            "settlement_mode": "流水分成",
            "settlement_basis": "按平台账单结算",
            "payment_terms": "月结",
            "access_status": "生效",
            "performance_status": "履约中",
        }
        result = recommend_channel_rules(
            "荣耀",
            "荣耀",
            [{"line_index": 0, "game_name": "创世封神", "settlement_cycle": "2026-02"}],
            [candidate],
        )
        row = result["lines"][0]
        self.assertTrue(row["auto_apply"])
        self.assertEqual(row["recommended"]["settlement_rule_code"], "honor_upfront_percent_fee")
        self.assertEqual(row["recommended"]["channel_fee_rate"], 5)
        self.assertEqual(row["recommended"]["share_rate"], 50)
        self.assertEqual(row["recommended"]["tax_rate"], 0)


if __name__ == "__main__":
    unittest.main()
