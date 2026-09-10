import unittest

from rd_rule_recommender import recommend_rd_rules


class RdPrepaymentRecommenderTests(unittest.TestCase):
    def candidate(self, *, available=500, agreed=1000):
        return {
            "contract_id": "C1",
            "contract_name": "研发联运合同",
            "contract_no": "HT-2026-PREPAY",
            "access_item_id": "A1",
            "partner_name": "测试研发有限公司",
            "partner_short_name": "测试研发",
            "counterparty": "测试研发有限公司",
            "product_name": "云上征途",
            "channel_name": "",
            "authorization_start": "2026-01-01",
            "authorization_end": "2026-12-31",
            "share_rate": 20,
            "channel_fee_rate": 0,
            "invoice_tax_rate": 0,
            "testing_fee": 0,
            "settlement_mode": "流水分成",
            "settlement_basis": "按实付结算",
            "payment_terms": "月结",
            "prepayment_amount": agreed,
            "prepayment_used_amount": agreed - available,
            "prepayment_available_amount": available,
        }

    def line(self, *, index=0, revenue=100):
        return {
            "line_index": index,
            "game_name": "云上征途",
            "settlement_cycle": "2026年8月",
            "revenue": revenue,
            "discount_rate": 1,
            "coupon_amount": 0,
            "test_fee": 0,
            "extra_fee": 0,
            "share_ratio": 20,
            "tax_rate": 0,
            "channel_fee_rate": 0,
            "settlement_amount": revenue * 0.2,
        }

    def test_full_deduction_keeps_contract_settlement_as_cost(self):
        result = recommend_rd_rules("测试研发有限公司", [self.line()], [self.candidate()])
        row = result["lines"][0]
        self.assertEqual(row["contract_amount"]["expected_amount"], 20.0)
        self.assertEqual(row["recommended"]["prepayment_deduction"], 20.0)
        self.assertEqual(row["recommended"]["actual_payable"], 0.0)
        self.assertEqual(row["recommended"]["prepayment_available_after"], 480.0)

    def test_partial_deduction_leaves_cash_payable(self):
        result = recommend_rd_rules(
            "测试研发有限公司",
            [self.line()],
            [self.candidate(available=12, agreed=1000)],
        )
        row = result["lines"][0]
        self.assertEqual(row["recommended"]["prepayment_deduction"], 12.0)
        self.assertEqual(row["recommended"]["actual_payable"], 8.0)


if __name__ == "__main__":
    unittest.main()
