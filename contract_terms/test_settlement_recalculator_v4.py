import unittest

from settlement_recalculator_v4 import calculate_contract_standard_amount_v4


class SettlementBasisGuardTests(unittest.TestCase):
    def base_candidate(self, **overrides):
        candidate = {
            "share_rate": 83,
            "channel_fee_rate": 0,
            "invoice_tax_rate": 0,
            "testing_fee": 0,
            "settlement_mode": "流水分成",
            "settlement_basis": "",
        }
        candidate.update(overrides)
        return candidate

    def base_line(self, **overrides):
        line = {
            "revenue": 1000,
            "discount_rate": 0.05,
            "coupon_amount": 0,
            "test_fee": 0,
            "extra_fee": 0,
            "header_refund_amount": 0,
            "refund_amount": 0,
            "other_deductions": 0,
            "tax_rate": 0,
            "settlement_amount": 830,
        }
        line.update(overrides)
        return line

    def test_actual_paid_contract_does_not_apply_product_discount_twice(self):
        result = calculate_contract_standard_amount_v4(
            "rd",
            {"channel_fee_rate": 0},
            self.base_line(),
            self.base_candidate(
                settlement_mode="按实付结算",
                settlement_basis="用户实际支付金额",
            ),
        )

        self.assertEqual(result["status"], "pass")
        self.assertTrue(result["deterministic"])
        self.assertEqual(result["expected_amount"], 830)
        self.assertEqual(result["breakdown"]["bill_discount_reference"], 0.05)
        self.assertEqual(result["breakdown"]["contract_settlement_basis"], "actual_paid")

    def test_ambiguous_basis_with_discount_is_manual_not_blocking(self):
        result = calculate_contract_standard_amount_v4(
            "rd",
            {"channel_fee_rate": 0},
            self.base_line(settlement_amount=41.5),
            self.base_candidate(settlement_mode="流水分成", settlement_basis=""),
        )

        self.assertEqual(result["status"], "manual")
        self.assertFalse(result["deterministic"])
        self.assertEqual(result["expected_amount"], 830)
        self.assertIn("必须人工确认", result["message"])

    def test_explicit_discounted_flow_contract_uses_discount_factor(self):
        result = calculate_contract_standard_amount_v4(
            "rd",
            {"channel_fee_rate": 0},
            self.base_line(settlement_amount=41.5),
            self.base_candidate(
                settlement_mode="流水分成",
                settlement_basis="折后流水作为结算基数",
            ),
        )

        self.assertEqual(result["status"], "pass")
        self.assertTrue(result["deterministic"])
        self.assertEqual(result["expected_amount"], 41.5)
        self.assertEqual(result["breakdown"]["contract_settlement_basis"], "discounted_flow")


if __name__ == "__main__":
    unittest.main()
