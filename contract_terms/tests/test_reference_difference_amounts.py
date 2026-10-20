"""Reference estimates must not masquerade as monetary obligations."""
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from v3_main import _raw_channel_bill
from v4_main import (_case_payload, _requires_difference_case,
                     handle_difference_case, list_difference_cases)


class ReferenceDifferenceTests(unittest.TestCase):
    def case(self, amount=None):
        return {"id": "case", "status": "pending", "expected_amount": 1.2,
                "actual_amount": 0, "difference_amount": -1.2,
                "variance_direction": "under",
                "source_snapshot_json": {"contract_amount": amount or {
                    "status": "manual", "deterministic": False,
                    "expected_amount": 1.2}}}

    def test_reference_payload_preserves_audit_but_marks_uncertainty(self):
        row = self.case()
        output = _case_payload(row)
        self.assertTrue(output["amount_is_reference"])
        self.assertEqual(output["amount_certainty"], "reference")
        self.assertEqual(output["expected_amount"], 1.2)
        self.assertIn("source_snapshot_json", row)  # read only

    def test_deterministic_and_legacy_cases_preserve_compatibility(self):
        self.assertEqual(_case_payload(self.case({"status": "fail", "deterministic": True}))["amount_certainty"], "deterministic")
        self.assertEqual(_case_payload({"id": "old"})["amount_certainty"], "legacy")

    def test_reference_alone_never_creates_monetary_case(self):
        for status in ["manual", "fail"]:
            line = {"contract_amount": {"status": status, "deterministic": False, "expected_amount": 1.2}}
            self.assertFalse(_requires_difference_case("channel", line))
            line["checks"] = [{"key": "channel_fee_rate", "status": "fail", "bill_value": 0, "contract_value": 5}]
            self.assertTrue(_requires_difference_case("channel", line))
        self.assertTrue(_requires_difference_case("channel", {"contract_amount": {"status": "fail", "deterministic": True, "expected_amount": 1.2}}))

    @patch("v4_main._case_by_id")
    @patch("v4_main._ensure_difference_tables")
    @patch("v4_main._database_url", return_value="unused")
    @patch("v4_main._require_permission", return_value="tester")
    @patch("v4_main.psycopg.connect")
    def test_reference_cannot_generate_money_movements(self, connect, _permission, _url, _tables, case_lookup):
        conn = connect.return_value.__enter__.return_value
        case_lookup.return_value = self.case()
        for action in ["create_adjustment", "carry_forward"]:
            with self.assertRaises(HTTPException) as error:
                handle_difference_case(Mock(), "case", {"action": action})
            self.assertEqual(error.exception.status_code, 409)
        conn.execute.assert_not_called()

    @patch("v4_main._ensure_difference_tables")
    @patch("v4_main._database_url", return_value="unused")
    @patch("v4_main._require_permission", return_value="tester")
    @patch("v4_main.psycopg.connect")
    def test_summary_excludes_reference_without_updating_history(self, connect, _permission, _url, _tables):
        conn = connect.return_value.__enter__.return_value
        conn.execute.return_value.fetchall.return_value = [self.case()]
        conn.execute.return_value.fetchone.return_value = {"pending_count": 1}
        result = list_difference_cases(Mock(), bill_type=None, bill_id=None, status=None, limit=200)
        sql = conn.execute.call_args_list[-1].args[0]
        self.assertEqual(sql.count("{contract_amount,status}"), 2)
        self.assertEqual(sql.count("{contract_amount,deterministic}"), 2)
        self.assertEqual(result["summary"]["under_total"], 0)
        self.assertTrue(all("UPDATE" not in call.args[0] for call in conn.execute.call_args_list))

    def test_channel_persisted_flow_semantics_are_explicit(self):
        conn = Mock()
        conn.execute.return_value.fetchone.return_value = {"id": "bill", "billing_flow": 1.8}
        conn.execute.return_value.fetchall.return_value = [{"id": "line", "billing_flow": 6, "discount_factor": .3}]
        _, rows = _raw_channel_bill(conn, "bill")
        self.assertEqual(rows["line"]["billing_flow_basis"], "raw")
        self.assertEqual(rows["line"]["discount_factor"], .3)
        conn.execute.return_value.fetchall.return_value = []
        _, rows = _raw_channel_bill(conn, "bill")
        self.assertEqual(rows["legacy"]["billing_flow_basis"], "actual_paid")
        self.assertEqual(rows["legacy"]["discount_factor"], 1)


if __name__ == "__main__":
    unittest.main()
