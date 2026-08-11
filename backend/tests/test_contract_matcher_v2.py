import unittest

from contract_terms.v2_main import _candidate_options, _evaluate_line_v2


class ContractMatcherV2Test(unittest.TestCase):
    def setUp(self):
        self.bill = {
            "partner_name": "西安烦烈网络科技有限公司",
            "channel_name": "TapTap",
            "settlement_month": "2026-06",
            "channel_fee_rate": 5,
            "server_cost": 0,
        }
        self.line = {
            "line_id": "line-1",
            "game_name": "历史别名完全不同",
            "settlement_cycle": "2026-06",
            "share_rate": 83,
            "tax_rate": 6,
            "test_fee": 0,
            "refund_amount": 0,
            "other_deductions": 0,
        }
        self.candidate = {
            "contract_id": "contract-1",
            "contract_name": "云上征途联合运营协议",
            "contract_no": "HT-001",
            "counterparty": "西安烦烈网络科技有限公司",
            "partner_name": "西安烦烈网络科技有限公司",
            "partner_short_name": "烦烈",
            "access_item_id": "access-1",
            "product_name": "云上征途",
            "channel_name": "TapTap",
            "authorization_start": "2026-01-01",
            "authorization_end": "2026-12-31",
            "share_rate": 83,
            "channel_fee_rate": 5,
            "invoice_tax_rate": 6,
            "testing_fee": None,
            "refund_rule": "退款次月冲抵",
            "deduction_rule": "按合同约定扣除",
            "server_cost_bearer": "研发承担",
            "settlement_mode": "按实付分成",
            "settlement_basis": "实付流水",
            "payment_terms": "T+30",
            "unit_price": None,
            "currency": "CNY",
        }

    def test_same_partner_candidates_remain_available_for_manual_override(self):
        options = _candidate_options(self.bill, self.line, [self.candidate])
        self.assertEqual(len(options), 1)
        self.assertEqual(options[0]["access_item_id"], "access-1")
        self.assertFalse(options[0]["eligible"])

    def test_locked_binding_overrides_low_identity_score_without_hiding_financial_checks(self):
        binding = {
            "bill_type": "channel",
            "bill_id": "bill-1",
            "line_id": "line-1",
            "access_item_id": "access-1",
            "match_method": "manual",
            "note": "人工确认历史别名",
            "confirmed_by": "user-1",
            "confirmed_at": None,
            "created_at": None,
            "updated_at": None,
        }
        result = _evaluate_line_v2(self.bill, self.line, [self.candidate], binding)
        self.assertEqual(result["match"]["access_item_id"], "access-1")
        self.assertTrue(result["match"]["locked"])
        self.assertEqual(result["match"]["match_method"], "manual")
        self.assertEqual(result["status"], "pass")
        check_statuses = {item["key"]: item["status"] for item in result["checks"]}
        self.assertEqual(check_statuses["share_rate"], "pass")
        self.assertEqual(check_statuses["tax_rate"], "pass")
        self.assertEqual(check_statuses["channel_fee_rate"], "pass")

    def test_locked_binding_does_not_suppress_real_financial_difference(self):
        binding = {
            "bill_type": "channel",
            "bill_id": "bill-1",
            "line_id": "line-1",
            "access_item_id": "access-1",
            "match_method": "manual",
            "note": "人工确认历史别名",
            "confirmed_by": "user-1",
            "confirmed_at": None,
            "created_at": None,
            "updated_at": None,
        }
        candidate = {**self.candidate, "share_rate": 80}
        result = _evaluate_line_v2(self.bill, self.line, [candidate], binding)
        self.assertEqual(result["status"], "fail")
        share = next(item for item in result["checks"] if item["key"] == "share_rate")
        self.assertEqual(share["status"], "fail")
        self.assertEqual(share["difference"], 3.0)


if __name__ == "__main__":
    unittest.main()
