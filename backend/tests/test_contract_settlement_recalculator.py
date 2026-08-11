import unittest

from contract_terms.settlement_recalculator import (
    calculate_channel_contract_amount,
    calculate_rd_contract_amount,
    summarize_contract_amounts,
)


class ContractSettlementRecalculatorTest(unittest.TestCase):
    def base_candidate(self):
        return {
            "share_rate": 83,
            "channel_fee_rate": 5,
            "invoice_tax_rate": 6,
            "testing_fee": 10,
            "refund_rule": "退款按实际冲抵",
            "deduction_rule": "按账单实际发生并经双方确认",
            "settlement_mode": "按实付分成",
            "settlement_basis": "实付流水",
            "unit_price": None,
            "minimum_guarantee_amount": None,
        }

    def test_rd_contract_amount_quantifies_under_settlement(self):
        bill = {"channel_fee_rate": 5}
        line = {
            "revenue": 10000,
            "discount_rate": 0.05,
            "coupon_amount": 0,
            "test_fee": 10,
            "extra_fee": 0,
            "header_refund_amount": 0,
            "refund_amount": 0,
            "other_deductions": 0,
            "tax_rate": 6,
            "settlement_amount": 360,
        }
        result = calculate_rd_contract_amount(bill, line, self.base_candidate())
        self.assertTrue(result["deterministic"])
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["expected_amount"], 363.18)
        self.assertEqual(result["difference_amount"], -3.18)
        self.assertEqual(result["variance_direction"], "under")

    def test_rd_text_deduction_keeps_reference_amount_non_blocking(self):
        bill = {"channel_fee_rate": 5}
        line = {
            "revenue": 1000,
            "discount_rate": 1,
            "coupon_amount": 50,
            "test_fee": 10,
            "extra_fee": 20,
            "header_refund_amount": 0,
            "refund_amount": 20,
            "other_deductions": 70,
            "tax_rate": 6,
            "settlement_amount": 700,
        }
        result = calculate_rd_contract_amount(bill, line, self.base_candidate())
        self.assertIsNotNone(result["expected_amount"])
        self.assertFalse(result["deterministic"])
        self.assertEqual(result["status"], "manual")
        self.assertTrue(result["assumptions"])

    def test_channel_contract_amount_matches_percentage_fee_formula(self):
        bill = {
            "channel_fee_rate": 5,
            "channel_fee_mode": "percent",
            "tax_mode": "none",
            "validation_tolerance": 0.05,
        }
        candidate = {
            **self.base_candidate(),
            "testing_fee": 0,
        }
        line = {
            "billing_flow": 1000,
            "discount_factor": 1,
            "voucher_cost": 100,
            "no_worry_cost": 0,
            "refund_amount": 0,
            "test_fee": 0,
            "welfare_cost": 0,
            "coin_cost": 0,
            "other_deductions": 0,
            "gateway_cost": 0,
            "settlement_amount": 709.65,
        }
        result = calculate_channel_contract_amount(bill, line, candidate)
        self.assertTrue(result["deterministic"])
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["expected_amount"], 709.65)
        self.assertEqual(result["difference_amount"], 0.0)

    def test_channel_fixed_fee_without_structured_contract_fee_is_manual(self):
        bill = {
            "channel_fee_rate": 0,
            "channel_fee_mode": "fixed",
            "tax_mode": "none",
        }
        candidate = {
            **self.base_candidate(),
            "channel_fee_rate": None,
            "testing_fee": 0,
        }
        line = {
            "billing_flow": 1000,
            "discount_factor": 1,
            "gateway_cost": 20,
            "settlement_amount": 800,
        }
        result = calculate_channel_contract_amount(bill, line, candidate)
        self.assertEqual(result["status"], "manual")
        self.assertFalse(result["supported"])
        self.assertIsNone(result["expected_amount"])

    def test_unit_price_contract_is_not_guessed(self):
        bill = {"channel_fee_rate": 0}
        candidate = {
            **self.base_candidate(),
            "unit_price": 10,
            "settlement_mode": "CPA",
        }
        line = {
            "revenue": 1000,
            "discount_rate": 1,
            "settlement_amount": 500,
        }
        result = calculate_rd_contract_amount(bill, line, candidate)
        self.assertEqual(result["formula_code"], "unit_price")
        self.assertFalse(result["supported"])
        self.assertIsNone(result["expected_amount"])

    def test_amount_summary_only_blocks_deterministic_differences(self):
        lines = [
            {"contract_amount": {"status": "fail", "deterministic": True, "actual_amount": 90, "expected_amount": 100}},
            {"contract_amount": {"status": "manual", "deterministic": False, "actual_amount": 50, "expected_amount": 55}},
        ]
        summary = summarize_contract_amounts(lines)
        self.assertEqual(summary["status"], "fail")
        self.assertEqual(summary["comparable_lines"], 2)
        self.assertEqual(summary["deterministic_lines"], 1)
        self.assertEqual(summary["blocking_difference_lines"], 1)
        self.assertEqual(summary["difference_amount"], -15.0)


if __name__ == "__main__":
    unittest.main()
