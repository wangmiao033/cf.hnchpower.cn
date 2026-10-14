"""End-to-end policy tests for an admin-approved ¥0.21 platform tail."""
from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase

from fastapi import HTTPException

from app.api.bill_lifecycle import (
    ApprovedPlatformVarianceRequest,
    confirm_approved_channel_platform_variance,
)
from app.services.channel_platform_variance_approval import (
    assess_channel_platform_variance,
    assert_no_open_contract_exceptions,
)
from app.services.channel_settlement_engine import (
    aggregate_validation,
    calculate_channel_line,
)


def bill_and_lines(p1="2009.46", p2="2792.02"):
    bill = SimpleNamespace(
        status="pending", validation_status="fail", settlement_rule_code="share_only",
        channel_fee_mode="none", tax_mode="none", channel_fee_rate=Decimal("0"),
        validation_tolerance=Decimal("0.05"),
        settlement_adjustment_amount=Decimal("0"), settlement_final_override=None,
    )
    lines = []
    for line_id, game, flow, platform in (
        ("L1", "六界仙尊", "2009.25", p1),
        ("L2", "帝国雄师", "2792.02", p2),
    ):
        item = SimpleNamespace(
            id=line_id, game_name=game, settlement_cycle="2026-08",
            billing_flow=Decimal(flow), discount_factor=Decimal("1"),
            voucher_cost=Decimal("0"), no_worry_cost=Decimal("0"),
            refund_cost=Decimal("0"), test_cost=Decimal("0"),
            welfare_cost=Decimal("0"), coin_cost=Decimal("0"),
            share_rate=Decimal("100"), gateway_cost=Decimal("0"),
            tax_rate=Decimal("0"), settlement_rule_code="share_only",
            channel_fee_mode="none", channel_fee_rate=Decimal("0"),
            tax_mode="none", validation_tolerance=Decimal("0.05"),
            platform_settlement_amount=Decimal(platform),
        )
        for field, value in calculate_channel_line(item, bill).items():
            setattr(item, field, value)
        lines.append(item)
    totals = aggregate_validation(lines, bill)
    bill.system_settlement_amount = totals["system_total"]
    bill.platform_settlement_amount = totals["platform_total"]
    bill.settlement_difference = totals["difference_total"]
    bill.settlement_amount = totals["settlement_total"]
    bill.validation_status = totals["validation_status"]
    return bill, lines


class ChannelPlatformVarianceApprovalTests(TestCase):
    def assert_blocked(self, bill, lines, code):
        with self.assertRaises(HTTPException) as caught:
            assess_channel_platform_variance(bill, lines)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(caught.exception.detail["error"], code)

    def test_exact_august_21_cent_variance_is_approvable_and_not_mutated(self):
        bill, lines = bill_and_lines()
        result = assess_channel_platform_variance(bill, lines)
        self.assertEqual(result["system_amount"], 4801.27)
        self.assertEqual(result["platform_amount"], 4801.48)
        self.assertEqual(result["recorded_settlement_amount"], 4801.48)
        self.assertEqual(result["signed_difference_cents"], -21)
        self.assertEqual(result["absolute_line_difference_cents"], 21)
        self.assertEqual(result["line_ids"], ["L1", "L2"])
        self.assertEqual(len(result["affected_lines"]), 1)
        self.assertEqual(result["affected_lines"][0]["game_name"], "六界仙尊")
        self.assertEqual(bill.validation_status, "fail")  # The audit exception never falsifies validation.

    def test_missing_platform_amount_cannot_be_manual_approved(self):
        bill, lines = bill_and_lines()
        lines[0].platform_settlement_amount = None
        self.assert_blocked(bill, lines, "platform_variance_missing_platform")

    def test_large_line_variance_cannot_hide_behind_offsetting_other_game(self):
        # A 20-yuan overstatement and 19.79-yuan understatement net to -0.21.
        bill, lines = bill_and_lines(p1="2029.25", p2="2772.23")
        self.assertEqual(abs(float(bill.settlement_difference)), 0.21)
        self.assert_blocked(bill, lines, "platform_variance_too_large")

    def test_above_50_cent_real_gap_is_rejected(self):
        bill, lines = bill_and_lines(p1="2009.76")
        self.assert_blocked(bill, lines, "platform_variance_too_large")

    def test_changed_parent_amount_cannot_be_confirmed(self):
        bill, lines = bill_and_lines()
        bill.settlement_amount = Decimal("4801.27")
        self.assert_blocked(bill, lines, "platform_variance_stale_total")

    def test_changed_line_calculation_cannot_reuse_approval(self):
        bill, lines = bill_and_lines()
        lines[0].system_settlement_amount = Decimal("2009.46")
        self.assert_blocked(bill, lines, "platform_variance_stale_line")

    def test_independent_adjustment_needs_a_separate_finance_review(self):
        bill, lines = bill_and_lines()
        bill.settlement_adjustment_amount = Decimal("-498.64")
        self.assert_blocked(bill, lines, "platform_variance_adjusted_bill")

    def test_normal_bill_does_not_use_manual_exception(self):
        bill, lines = bill_and_lines(p1="2009.25")
        self.assert_blocked(bill, lines, "platform_variance_not_required")

    def test_open_contract_exception_blocks_platform_approval(self):
        bill, lines = bill_and_lines()
        with self.assertRaises(HTTPException) as caught:
            assert_no_open_contract_exceptions([
                {"line_id": "old", "game_name": "六界仙尊",
                 "settlement_cycle": "2026-08", "status": "pending"}
            ], lines)
        self.assertEqual(caught.exception.detail["error"], "contract_difference_unresolved")

    def test_resolved_contract_cases_are_kept_as_audit_history(self):
        bill, lines = bill_and_lines()
        assert_no_open_contract_exceptions([
            {"line_id": "old", "game_name": "六界仙尊", "settlement_cycle": "2026-08",
             "status": "resolved", "handling_type": "accept_difference",
             "source_snapshot_json": {"checks": [{"key": "share_rate", "status": "fail"}]}}
        ], lines)

    def test_contract_identity_and_authorization_stay_protected(self):
        _, lines = bill_and_lines()
        with self.assertRaises(HTTPException) as caught:
            assert_no_open_contract_exceptions([
                {"line_id": "L1", "game_name": "六界仙尊", "settlement_cycle": "2026-08",
                 "status": "resolved", "source_snapshot_json": {
                     "checks": [{"key": "authorization", "status": "fail"}]}}
            ], lines)
        self.assertEqual(caught.exception.detail["error"], "contract_identity_failed")

    def test_requires_administrator_before_db_access(self):
        payload = ApprovedPlatformVarianceRequest(
            reason="按真实平台已核对金额结算，尾差保留",
            expected_system_amount=4801.27, expected_platform_amount=4801.48,
            expected_settlement_amount=4801.48, expected_signed_difference_cents=-21,
            expected_line_ids=["L1", "L2"]
        )
        with self.assertRaises(HTTPException) as caught:
            confirm_approved_channel_platform_variance(
                "bill-id", payload, db=SimpleNamespace(),
                user=SimpleNamespace(role="finance"),
            )
        self.assertEqual(caught.exception.status_code, 403)
