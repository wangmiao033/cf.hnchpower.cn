import unittest

from v8_main import _apply_confirmation_policy
from v4_main import _requires_difference_case


class DifferenceConfirmationPolicyTests(unittest.TestCase):
    def result(self, handling_type, case_status="processing", authorization_status="pass"):
        return {
            "summary": {
                "binding_count": 1,
                "amount_status": "fail",
                "amount_comparable_lines": 1,
                "amount_deterministic_lines": 1,
                "amount_expected": 100,
                "amount_actual": 90,
                "amount_difference": -10,
            },
            "lines": [
                {
                    "line_id": "L1",
                    "status": "fail",
                    "contract_amount": {"status": "fail"},
                    "difference_case": {
                        "status": case_status,
                        "handling_type": handling_type,
                    },
                    "checks": [
                        {
                            "key": "authorization",
                            "status": authorization_status,
                        },
                        {
                            "key": "contract_standard_settlement",
                            "status": "fail",
                        },
                    ],
                }
            ],
            "bill_checks": [],
        }

    def test_edit_bill_keeps_confirmation_blocked_until_difference_disappears(self):
        updated = _apply_confirmation_policy(self.result("edit_bill"))
        self.assertEqual(updated["summary"]["fail_count"], 1)
        self.assertEqual(updated["summary"]["unresolved_difference_lines"], 1)

    def test_adjustment_allows_current_bill_to_continue(self):
        updated = _apply_confirmation_policy(self.result("adjustment"))
        self.assertEqual(updated["summary"]["fail_count"], 0)
        self.assertEqual(updated["summary"]["handled_difference_lines"], 1)

    def test_accepted_difference_allows_current_bill_to_continue(self):
        updated = _apply_confirmation_policy(self.result("accept_difference", case_status="resolved"))
        self.assertEqual(updated["summary"]["fail_count"], 0)
        self.assertEqual(updated["lines"][0]["status"], "pass")

    def test_authorization_failure_remains_blocking(self):
        updated = _apply_confirmation_policy(
            self.result("carry_forward", authorization_status="fail")
        )
        self.assertEqual(updated["summary"]["fail_count"], 1)
        self.assertEqual(updated["summary"]["unresolved_difference_lines"], 1)

    def rate_only_result(self, handling_type=None, status="pending", authorization="pass"):
        result = self.result(handling_type, case_status=status, authorization_status=authorization)
        line = result["lines"][0]
        line["contract_amount"] = {
            "status": "pass", "actual_amount": 0.65, "expected_amount": 0.61
        }
        line["checks"][1]["status"] = "pass"
        line["checks"].extend([
            {"key": "share_rate", "status": "fail", "bill_value": 28, "contract_value": 25},
            {"key": "channel_fee_rate", "status": "fail", "bill_value": 5, "contract_value": 0},
        ])
        return result

    def test_channel_rate_only_mismatch_gets_a_case_even_if_amount_is_within_tolerance(self):
        result = self.rate_only_result()
        self.assertTrue(_requires_difference_case("channel", result["lines"][0]))
        self.assertFalse(_requires_difference_case("rd", result["lines"][0]))

    def test_rate_only_mismatch_still_blocks_before_explicit_confirmation(self):
        result = self.rate_only_result()
        updated = _apply_confirmation_policy(result)
        self.assertEqual(updated["summary"]["fail_count"], 1)
        self.assertEqual(updated["summary"]["unresolved_difference_lines"], 1)

    def test_explicit_special_settlement_accepts_28_percent_share_and_5_percent_fee(self):
        result = self.rate_only_result("accept_difference", status="resolved")
        updated = _apply_confirmation_policy(result)
        self.assertEqual(updated["summary"]["fail_count"], 0)
        self.assertEqual(updated["summary"]["handled_difference_lines"], 1)
        self.assertEqual(updated["lines"][0]["status"], "pass")

    def test_special_settlement_cannot_override_contract_authorization_failure(self):
        result = self.rate_only_result("accept_difference", status="resolved", authorization="fail")
        updated = _apply_confirmation_policy(result)
        self.assertEqual(updated["summary"]["fail_count"], 1)

    def test_special_settlement_cannot_override_unrelated_identity_failure(self):
        result = self.rate_only_result("accept_difference", status="resolved")
        result["lines"][0]["checks"].append({"key": "partner_identity", "status": "fail"})
        updated = _apply_confirmation_policy(result)
        self.assertEqual(updated["summary"]["fail_count"], 1)


if __name__ == "__main__":
    unittest.main()
