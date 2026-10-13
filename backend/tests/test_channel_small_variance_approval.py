"""Regression tests for audited, scoped channel penny-variance approval."""
from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase

from fastapi import HTTPException

from app.api.bill_lifecycle import ApprovedSmallVarianceRequest, confirm_approved_channel_small_variance
from app.services.channel_small_variance_approval import assess_channel_small_variance_approval


BILL = "aug-2026"


def line(line_id="line-current", *, game="云上征途（0.05飞升启航版）", actual="0.65", share="28", fee="5"):
    return SimpleNamespace(
        id=line_id, game_name=game, settlement_cycle="2026-08",
        settlement_amount=Decimal(actual),
        share_rate=Decimal(share), tax_rate=Decimal("0"),
        channel_fee_rate=Decimal(fee),
    )


def case(case_id="case-old", *, line_id="line-old", status="resolved",
         handling="accept_difference", reason="商务特殊约定", expected="0.61",
         actual="0.65", share=28, fee=5, additional_checks=None):
    return {
        "id": case_id,
        "bill_type": "channel",
        "bill_id": BILL,
        "line_id": line_id,
        "game_name": "云上征途（0.05飞升启航版）",
        "settlement_cycle": "2026-08",
        "expected_amount": Decimal(expected),
        "actual_amount": Decimal(actual),
        "status": status,
        "handling_type": handling,
        "reason_type": reason,
        "description": "按双方结算确认函特殊结算，保留28%分成与5%通道费。",
        "source_snapshot_json": {
            "match": {"authorization_status": "covered"},
            "checks": [
                {"key": "share_rate", "status": "fail", "bill_value": share, "contract_value": 25},
                {"key": "channel_fee_rate", "status": "fail", "bill_value": fee, "contract_value": 0},
                {"key": "contract_standard_settlement", "status": "pass"},
                *(additional_checks or []),
            ]
        }
    }


class ChannelSmallVarianceApprovalTests(TestCase):
    def assert_blocked(self, rows, cases, code=None):
        with self.assertRaises(HTTPException) as caught:
            assess_channel_small_variance_approval(BILL, rows, cases)
        self.assertEqual(caught.exception.status_code, 409)
        if code:
            self.assertEqual(caught.exception.detail["error"], code)

    def test_two_duplicate_historical_approvals_count_only_once(self):
        # This is the user's screenshot: two accepted 0.04 cases for one product.
        rows = [line()]
        cases = [case("latest", line_id="previous-id-2"), case("earlier", line_id="previous-id-1")]
        result = assess_channel_small_variance_approval(BILL, rows, cases)
        self.assertEqual(result["difference_cents"], 4)
        self.assertEqual(len(result["approved_lines"]), 1)
        self.assertEqual(result["approved_lines"][0]["actual_amount"], 0.65)

    def test_blocks_unapproved_or_processing_case_on_current_line(self):
        self.assert_blocked([line()], [case(status="pending", line_id="line-current")],
                            "difference_not_approved")
        self.assert_blocked([line()], [
            case(line_id="historical"),
            case("fresh", line_id="line-current", status="pending", handling=None)
        ], "difference_not_approved")
        self.assert_blocked([line()], [case(status="processing", line_id="line-current")],
                            "difference_not_approved")

    def test_blocks_wrong_actual_share_or_fee_after_new_save(self):
        self.assert_blocked([line(actual="1.65")], [case()], "difference_evidence_stale")
        self.assert_blocked([line(share="25")], [case()], "difference_evidence_stale")
        self.assert_blocked([line(fee="0")], [case()], "difference_evidence_stale")

    def test_blocks_hard_failures_even_if_an_old_approval_exists(self):
        risky = case(additional_checks=[{"key": "authorization", "status": "fail"}])
        self.assert_blocked([line()], [risky], "difference_evidence_stale")
        identity = case(additional_checks=[{"key": "partner_identity", "status": "fail"}])
        self.assert_blocked([line()], [identity], "difference_evidence_stale")
        uncovered = case()
        uncovered["source_snapshot_json"]["match"]["authorization_status"] = "expired"
        self.assert_blocked([line()], [uncovered], "difference_evidence_stale")

    def test_blocks_missing_approval_and_non_special_acceptance(self):
        self.assert_blocked([line()], [], "no_approved_variance")
        self.assert_blocked([line()], [case(reason="其他")], "difference_evidence_stale")
        self.assert_blocked([line()], [case(handling="carry_forward")], "difference_evidence_stale")

    def test_blocks_above_fifty_cents_even_with_approval(self):
        self.assert_blocked([line(actual="1.25")], [case(expected="0.61", actual="1.25")],
                            "variance_too_large")

    def test_does_not_allow_two_rows_with_same_game_and_period(self):
        self.assert_blocked([line("one"), line("two")], [case()],
                            "ambiguous_bill_lines")

    def test_rejects_cross_bill_history(self):
        data = case()
        data["bill_id"] = "other-bill"
        self.assert_blocked([line()], [data], "cross_bill_difference")

    def test_backend_requires_admin_role_before_writing_anything(self):
        with self.assertRaises(HTTPException) as caught:
            confirm_approved_channel_small_variance(
                BILL,
                ApprovedSmallVarianceRequest(reason="确认双方结算函及¥0.04差异"),
                db=SimpleNamespace(),
                user=SimpleNamespace(role="finance")
            )
        self.assertEqual(caught.exception.status_code, 403)


if __name__ == "__main__":
    import unittest
    unittest.main()
