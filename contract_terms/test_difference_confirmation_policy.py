import unittest

from v7_main import _apply_confirmation_policy


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


if __name__ == "__main__":
    unittest.main()
