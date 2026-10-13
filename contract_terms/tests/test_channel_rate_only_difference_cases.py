"""Rate-only contract differences must be persisted and waivable with finance approval."""
import unittest
from unittest.mock import Mock, patch

from v4_main import _apply_case_dispositions, _sync_difference_cases


def result(status="pending", handling_type=None, authorization_status="pass"):
    checks = [
        {"key": "authorization", "status": authorization_status, "label": "授权期"},
        {"key": "share_rate", "status": "fail", "label": "分成比例",
         "bill_value": 28, "contract_value": 25},
        {"key": "channel_fee_rate", "status": "fail", "label": "渠道费率",
         "bill_value": 5, "contract_value": 0},
        {"key": "contract_standard_settlement", "status": "pass", "label": "合同金额"},
    ]
    line = {
        "line_id": "L-1",
        "game_name": "云上征途（0.05飞升启航版）",
        "settlement_cycle": "2026-08",
        "status": "fail",
        "checks": checks,
        "contract_amount": {
            "status": "pass",
            "expected_amount": 0.61,
            "actual_amount": 0.65,
            "difference_amount": 0.04,
            "variance_abs": 0.04,
            "variance_direction": "equal",
        },
        "match": {"contract_no": "CN-2026-08"},
    }
    case = {
        "id": "CASE-1",
        "status": status,
        "handling_type": handling_type,
        "difference_amount": 0.04,
    }
    return {
        "bill": {"statement_no": "QD-AUG", "partner_name": "西安商务合作方"},
        "lines": [line],
        "summary": {"fail_count": 1},
        "bill_checks": [],
    }, case


class ChannelRateOnlyDifferenceCasesTest(unittest.TestCase):
    @patch("v4_main._ensure_difference_tables")
    @patch("v4_main._case_for_line", return_value=None)
    @patch("v4_main._case_by_id", return_value={"id": "CASE-1", "status": "pending"})
    @patch("v4_main._event")
    def test_rate_only_case_is_inserted_even_for_four_cent_variance(
        self, event, _get, _find, _tables
    ):
        base, _ = result()
        conn = Mock()
        cases = _sync_difference_cases(conn, "channel", "BILL-1", base)
        self.assertIn("L-1", cases)
        statements = [call.args[0] for call in conn.execute.call_args_list]
        self.assertTrue(any("INSERT INTO cf_contract_difference_cases" in sql for sql in statements))
        self.assertEqual(event.call_args.args[3], "发现合同结算规则差异")
        self.assertIn("分成比例", event.call_args.args[4])

    def test_pending_field_mismatch_stays_blocked(self):
        base, case = result()
        updated = _apply_case_dispositions(base, {"L-1": case})
        self.assertEqual(updated["summary"]["fail_count"], 1)
        self.assertEqual(updated["summary"]["unresolved_difference_lines"], 1)

    def test_accepted_special_settlement_closes_rate_only_mismatch(self):
        base, case = result(status="resolved", handling_type="accept_difference")
        updated = _apply_case_dispositions(base, {"L-1": case})
        self.assertEqual(updated["summary"]["fail_count"], 0)
        self.assertEqual(updated["summary"]["handled_difference_lines"], 1)

    def test_authorization_failure_does_not_become_accepted(self):
        base, case = result(status="resolved", handling_type="accept_difference",
                            authorization_status="fail")
        updated = _apply_case_dispositions(base, {"L-1": case})
        self.assertEqual(updated["summary"]["fail_count"], 1)


if __name__ == "__main__":
    unittest.main()
