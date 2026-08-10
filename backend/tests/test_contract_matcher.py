import unittest

from contract_terms.matcher import evaluate_line, score_candidate, summarize_results


class ContractMatcherTest(unittest.TestCase):
    def setUp(self):
        self.bill = {
            "partner_name": "西安烦烈网络科技有限公司",
            "channel_name": "TapTap",
            "settlement_month": "2026-06",
            "channel_fee_rate": 5,
            "server_cost": 0,
        }
        self.line = {
            "line_id": "l1",
            "game_name": "云上征途（0.05折）",
            "settlement_cycle": "2026-06",
            "share_rate": 83,
            "tax_rate": 6,
            "test_fee": 5,
            "refund_amount": 0,
            "other_deductions": 0,
        }
        self.candidate = {
            "contract_id": "c1",
            "contract_name": "云上征途联合运营协议",
            "contract_no": "HT-001",
            "counterparty": "西安烦烈网络科技有限公司",
            "partner_name": "西安烦烈网络科技有限公司",
            "partner_short_name": "烦烈",
            "access_item_id": "a1",
            "product_name": "云上征途",
            "channel_name": "TapTap",
            "authorization_start": "2026-01-01",
            "authorization_end": "2026-12-31",
            "share_rate": 83,
            "channel_fee_rate": 5,
            "invoice_tax_rate": 6,
            "testing_fee": 5,
            "refund_rule": "退款次月冲抵",
            "deduction_rule": "仅扣除合同约定费用",
            "server_cost_bearer": "研发承担",
            "settlement_mode": "按实付分成",
            "settlement_basis": "实付流水",
            "payment_terms": "T+30",
            "unit_price": None,
            "currency": "CNY",
        }

    def test_high_confidence_match_and_pass(self):
        match = score_candidate(self.bill, self.line, self.candidate)
        self.assertEqual(match["confidence"], "high")
        self.assertEqual(match["authorization_status"], "covered")
        result = evaluate_line(self.bill, self.line, [self.candidate])
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["match"]["access_item_id"], "a1")
        self.assertTrue(all(item["status"] == "pass" for item in result["checks"]))

    def test_share_and_tax_difference_fail(self):
        candidate = {**self.candidate, "share_rate": 80, "invoice_tax_rate": 5}
        result = evaluate_line(self.bill, self.line, [candidate])
        self.assertEqual(result["status"], "fail")
        failed = {item["key"] for item in result["checks"] if item["status"] == "fail"}
        self.assertIn("share_rate", failed)
        self.assertIn("tax_rate", failed)

    def test_deduction_without_contract_rule_needs_review(self):
        line = {**self.line, "refund_amount": 20, "other_deductions": 10}
        candidate = {**self.candidate, "refund_rule": "", "deduction_rule": ""}
        result = evaluate_line(self.bill, line, [candidate])
        self.assertEqual(result["status"], "warning")
        missing = {item["key"] for item in result["checks"] if item["status"] == "missing"}
        self.assertEqual(missing, {"refund_rule", "deduction_rule"})

    def test_out_of_authorization_range_fails(self):
        candidate = {**self.candidate, "authorization_end": "2026-05-31"}
        result = evaluate_line(self.bill, self.line, [candidate])
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["match"]["confidence"], "medium")
        self.assertEqual(
            next(item for item in result["checks"] if item["key"] == "authorization")["status"],
            "fail",
        )

    def test_unmatched_and_summary(self):
        result = evaluate_line(self.bill, {**self.line, "game_name": "完全不同的游戏"}, [self.candidate])
        self.assertEqual(result["status"], "unmatched")
        summary = summarize_results([result])
        self.assertEqual(summary["unmatched_count"], 1)
        self.assertEqual(summary["overall_status"], "warning")
        self.assertFalse(summary["can_auto_confirm"])


if __name__ == "__main__":
    unittest.main()
