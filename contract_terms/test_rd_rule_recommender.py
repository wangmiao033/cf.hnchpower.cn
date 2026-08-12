import unittest

from rd_rule_recommender import recommend_rd_rules


class RdRuleRecommenderTests(unittest.TestCase):
    def candidate(self, *, basis="按实付结算", access_id="A1"):
        return {
            "contract_id": f"C-{access_id}",
            "contract_name": "研发联运合同",
            "contract_no": "HT-2026-001",
            "access_item_id": access_id,
            "partner_name": "测试研发有限公司",
            "partner_short_name": "测试研发",
            "counterparty": "测试研发有限公司",
            "product_name": "云上征途",
            "channel_name": "",
            "authorization_start": "2026-01-01",
            "authorization_end": "2026-12-31",
            "share_rate": 80,
            "channel_fee_rate": 0,
            "invoice_tax_rate": 0,
            "testing_fee": 0,
            "settlement_mode": "流水分成",
            "settlement_basis": basis,
            "payment_terms": "月结",
        }

    def line(self, discount=0.1):
        return {
            "line_index": 0,
            "game_name": "云上征途",
            "settlement_cycle": "2026年8月",
            "revenue": 1000,
            "discount_rate": discount,
            "coupon_amount": 0,
            "test_fee": 0,
            "extra_fee": 0,
            "share_ratio": 15,
            "tax_rate": 0,
            "settlement_amount": 15,
        }

    def test_actual_paid_contract_does_not_double_apply_product_discount(self):
        result = recommend_rd_rules("测试研发有限公司", [self.line(0.1)], [self.candidate()])
        row = result["lines"][0]
        self.assertTrue(row["auto_apply"])
        self.assertEqual(row["recommended"]["basis_mode"], "actual_paid")
        self.assertEqual(row["recommended"]["settlement_discount_rate"], 1.0)
        self.assertEqual(row["recommended"]["product_discount_reference"], 0.1)
        self.assertEqual(row["contract_amount"]["expected_amount"], 800.0)

    def test_discounted_flow_contract_keeps_product_discount_in_formula(self):
        result = recommend_rd_rules(
            "测试研发有限公司",
            [self.line(0.1)],
            [self.candidate(basis="按折后流水结算")],
        )
        row = result["lines"][0]
        self.assertTrue(row["auto_apply"])
        self.assertEqual(row["recommended"]["basis_mode"], "discounted_flow")
        self.assertEqual(row["recommended"]["settlement_discount_rate"], 0.1)
        self.assertEqual(row["contract_amount"]["expected_amount"], 80.0)

    def test_ambiguous_basis_with_product_discount_stays_manual_for_amount(self):
        result = recommend_rd_rules(
            "测试研发有限公司",
            [self.line(0.1)],
            [self.candidate(basis="流水分成")],
        )
        row = result["lines"][0]
        self.assertEqual(row["recommended"]["basis_mode"], "ambiguous")
        self.assertFalse(row["contract_amount"]["deterministic"])
        self.assertEqual(row["contract_amount"]["status"], "manual")

    def test_ambiguous_candidates_do_not_auto_apply(self):
        result = recommend_rd_rules(
            "测试研发有限公司",
            [self.line(1)],
            [self.candidate(access_id="A1"), self.candidate(access_id="A2")],
        )
        row = result["lines"][0]
        self.assertFalse(row["auto_apply"])
        self.assertEqual(row["ambiguity_margin"], 0)


if __name__ == "__main__":
    unittest.main()
