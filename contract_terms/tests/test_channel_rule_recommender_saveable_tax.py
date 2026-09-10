import unittest

from channel_rule_recommender import _rule_fields, recommend_channel_rules


class ChannelRuleSaveableTaxTests(unittest.TestCase):
    partner = "厦门游戏之家科技有限公司"

    def candidate(self, *, tax=None, fee=5, share=30):
        return {
            "contract_id": "C-3387",
            "contract_name": "3387厦门游戏之家--熊动 合作协议",
            "contract_no": "HT-2024-00013",
            "access_item_id": "A-GAME-1",
            "partner_name": self.partner,
            "partner_short_name": "厦门游戏之家",
            "counterparty": self.partner,
            "product_name": "圣树唤歌",
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

    def test_missing_invoice_tax_uses_neutral_zero_when_tax_does_not_participate(self):
        rule = _rule_fields(self.candidate(tax=None))

        self.assertTrue(rule["fields_complete"])
        self.assertTrue(rule["tax_rate_missing"])
        self.assertEqual(rule["tax_mode"], "none")
        self.assertEqual(rule["tax_rate"], 0.0)

    def test_explicit_zero_invoice_tax_remains_explicit_zero(self):
        rule = _rule_fields(self.candidate(tax=0))

        self.assertFalse(rule["tax_rate_missing"])
        self.assertEqual(rule["tax_rate"], 0.0)

    def test_incomplete_financial_rule_does_not_fake_a_saveable_tax_value(self):
        rule = _rule_fields(self.candidate(tax=None, share=None))

        self.assertFalse(rule["fields_complete"])
        self.assertIsNone(rule["tax_rate"])

    def test_exact_contract_match_returns_saveable_zero_and_keeps_missing_tax_warning(self):
        result = recommend_channel_rules(
            self.partner,
            "厦门游戏之家",
            [{"line_index": 0, "game_name": "圣树唤歌", "settlement_cycle": "2026-02"}],
            [self.candidate(tax=None)],
        )

        row = result["lines"][0]
        self.assertTrue(row["auto_apply"])
        self.assertTrue(row["tax_rate_warning"])
        self.assertEqual(row["recommended"]["tax_mode"], "none")
        self.assertEqual(row["recommended"]["tax_rate"], 0.0)
        self.assertIn("按0记录", row["message"])


if __name__ == "__main__":
    unittest.main()
