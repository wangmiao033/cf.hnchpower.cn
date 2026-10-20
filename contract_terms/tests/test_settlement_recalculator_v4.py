import unittest

from settlement_recalculator_v4 import calculate_contract_standard_amount_v4


class SettlementBasisGuardTests(unittest.TestCase):
    def base_candidate(self, **overrides):
        candidate = {
            "share_rate": 17,
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


class ChannelFlowRepresentationTests(unittest.TestCase):
    def calculate(self, *, line=None, candidate=None):
        values = {
            "billing_flow": 6,
            "discount_factor": 0.3,
            "billing_flow_basis": "raw",
            "test_fee": 1.8,
            "settlement_amount": 0,
        }
        values.update(line or {})
        terms = {
            "share_rate": 30,
            "channel_fee_rate": 0,
            "invoice_tax_rate": 0,
            "testing_fee": 1.8,
            "settlement_mode": "按实付结算",
            "settlement_basis": "用户实际支付金额",
        }
        terms.update(candidate or {})
        return calculate_contract_standard_amount_v4(
            "channel", {"channel_fee_mode": "none", "tax_mode": "none"}, values, terms
        )

    def test_raw_flow_converts_before_testing_fee_for_actual_paid_contract(self):
        result = self.calculate()
        self.assertEqual(result["status"], "pass")
        self.assertTrue(result["deterministic"])
        self.assertEqual(result["expected_amount"], 0)
        self.assertEqual(result["breakdown"]["effective_flow"], 1.8)
        self.assertEqual(result["breakdown"]["billing_base"], 0)
        self.assertEqual(result["breakdown"]["discount_factor"], 0.3)

    def test_already_folded_flow_with_factor_one_is_not_discounted_again(self):
        result = self.calculate(
            line={"billing_flow": 3045.3, "billing_flow_basis": "actual_paid",
                  "discount_factor": 1, "test_fee": 0, "settlement_amount": 913.59},
            candidate={"testing_fee": 0},
        )
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["expected_amount"], 913.59)
        self.assertEqual(result["breakdown"]["effective_flow"], 3045.3)

    def test_already_paid_flow_does_not_reapply_reference_discount(self):
        for settlement_basis in ("实际支付金额", "折后流水作为结算基数"):
            with self.subTest(settlement_basis=settlement_basis):
                result = self.calculate(
                    line={"billing_flow": 1.8, "billing_flow_basis": "actual_paid"},
                    candidate={"settlement_mode": "流水分成", "settlement_basis": settlement_basis},
                )
                self.assertEqual(result["status"], "pass")
                self.assertEqual(result["expected_amount"], 0)
                self.assertEqual(result["breakdown"]["discount_factor"], 1)

    def test_product_names_never_supply_flow_or_contract_basis(self):
        for name in ("005", "iOS", "0.05折版", "普通版本"):
            with self.subTest(name=name):
                result = self.calculate(line={"game_name": name})
                self.assertEqual(result["expected_amount"], 0)
                unknown = self.calculate(line={"game_name": name, "billing_flow_basis": ""})
                self.assertEqual(unknown["status"], "manual")
                self.assertFalse(unknown["deterministic"])

    def test_unknown_flow_representation_is_manual_not_a_blocking_difference(self):
        for value in (None, "", "unknown", "raw_from_name"):
            with self.subTest(value=value):
                result = self.calculate(line={"billing_flow_basis": value})
                self.assertEqual(result["status"], "manual")
                self.assertFalse(result["deterministic"])
                self.assertEqual(result["breakdown"]["billing_flow_basis"], "unknown")

    def test_unknown_contract_basis_is_manual_even_with_known_flow(self):
        for flow_basis, discount in (("raw", 0.3), ("actual_paid", 1)):
            with self.subTest(flow_basis=flow_basis):
                result = self.calculate(
                    line={"billing_flow_basis": flow_basis, "discount_factor": discount},
                    candidate={"settlement_mode": "流水分成", "settlement_basis": ""},
                )
                self.assertEqual(result["status"], "manual")
                self.assertFalse(result["deterministic"])
        reference = self.calculate(candidate={"settlement_mode": "流水分成", "settlement_basis": ""})
        self.assertEqual(reference["expected_amount"], 0)

    def test_explicit_discounted_contract_converts_raw_flow_once(self):
        result = self.calculate(candidate={"settlement_mode": "流水分成", "settlement_basis": "折后流水"})
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["expected_amount"], 0)

    def test_real_amount_difference_still_fails(self):
        result = self.calculate(line={"settlement_amount": 1.2})
        self.assertEqual(result["status"], "fail")
        self.assertTrue(result["deterministic"])
        self.assertEqual(result["expected_amount"], 0)
        self.assertEqual(result["difference_amount"], 1.2)

    def test_real_nonzero_contract_amount_and_variance_are_preserved(self):
        result = self.calculate(line={"billing_flow": 10, "settlement_amount": 0.5})
        self.assertEqual(result["status"], "fail")
        self.assertTrue(result["deterministic"])
        self.assertEqual(result["expected_amount"], 0.36)
        self.assertEqual(result["difference_amount"], 0.14)

    def test_unit_factor_does_not_need_representation_to_convert(self):
        result = self.calculate(line={"billing_flow": 1.8, "discount_factor": 1, "billing_flow_basis": None})
        self.assertEqual(result["status"], "pass")
        self.assertTrue(result["deterministic"])
        self.assertEqual(result["expected_amount"], 0)

    def test_unstructured_testing_fee_still_requires_manual_review(self):
        result = self.calculate(candidate={"testing_fee": None})
        self.assertEqual(result["status"], "manual")
        self.assertFalse(result["deterministic"])
        self.assertEqual(result["expected_amount"], 0)

    def test_inputs_are_not_mutated(self):
        line = {"billing_flow": 1.8, "discount_factor": 0.3, "billing_flow_basis": "actual_paid"}
        original = dict(line)
        calculate_contract_standard_amount_v4(
            "channel", {"tax_mode": "none"}, line,
            {"share_rate": 30, "channel_fee_rate": 0, "testing_fee": 1.8, "settlement_mode": "按实付结算"},
        )
        self.assertEqual(line, original)


if __name__ == "__main__":
    unittest.main()
