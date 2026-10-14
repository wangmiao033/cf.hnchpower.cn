"""End-to-end policy tests for an admin-approved ¥0.21 platform tail."""
from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock

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



def xiaomi_september_bill():
    # Screenshot: Xiaomi 2026-09, four game rows; actual receivable ¥475.81,
    # computed ¥535.80 under the saved 50% share / 5% fee rule.
    bill = SimpleNamespace(
        status="pending", validation_status="fail",
        settlement_rule_code="five_percent_gateway_share",
        channel_fee_mode="percent", channel_fee_rate=Decimal("5"),
        tax_mode="none", validation_tolerance=Decimal("0.05"),
        settlement_adjustment_amount=Decimal("0"), settlement_final_override=None,
    )
    lines = []
    for index, (game, flow, platform) in enumerate((
        ("仙域小镇", "6", "2.42"),
        ("六界仙尊", "30", "2.85"),
        ("六界仙尊·手机", "648", "291.27"),
        ("帝国雄师", "444", "179.27"),
    )):
        item = SimpleNamespace(
            id=f"xiaomi-{index}", game_name=game, settlement_cycle="2026-09",
            billing_flow=Decimal(flow), discount_factor=Decimal("1"),
            voucher_cost=Decimal("0"), no_worry_cost=Decimal("0"),
            refund_cost=Decimal("0"), test_cost=Decimal("0"),
            welfare_cost=Decimal("0"), coin_cost=Decimal("0"),
            share_rate=Decimal("50"), gateway_cost=Decimal("0"),
            tax_rate=Decimal("0"),
            settlement_rule_code="five_percent_gateway_share",
            channel_fee_mode="percent", channel_fee_rate=Decimal("5"),
            tax_mode="none", validation_tolerance=Decimal("0.05"),
            platform_settlement_amount=Decimal(platform),
        )
        for key, value in calculate_channel_line(item, bill).items():
            setattr(item, key, value)
        lines.append(item)
    total = aggregate_validation(lines, bill)
    for attr, key in (
        ("system_settlement_amount", "system_total"),
        ("platform_settlement_amount", "platform_total"),
        ("settlement_difference", "difference_total"),
        ("settlement_amount", "settlement_total"),
        ("validation_status", "validation_status"),
    ):
        setattr(bill, attr, total[key])
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


    def test_xiaomi_september_59_99_requires_source_document_not_50_cent_exception(self):
        bill, lines = xiaomi_september_bill()
        self.assert_blocked(bill, lines, "platform_variance_too_large")
        documented = assess_channel_platform_variance(
            bill, lines, allow_documented_variance=True
        )
        self.assertEqual(documented["review_kind"], "documented")
        self.assertEqual(documented["system_amount"], 535.80)
        self.assertEqual(documented["platform_amount"], 475.81)
        self.assertEqual(documented["recorded_settlement_amount"], 475.81)
        self.assertEqual(documented["signed_difference_cents"], 5999)
        self.assertEqual(documented["absolute_line_difference_cents"], 5999)
        self.assertEqual(len(documented["affected_lines"]), 4)
        self.assertEqual(bill.validation_status, "fail")
        self.assertEqual(float(bill.settlement_amount), 475.81)

    def test_xiaomi_missing_or_unverified_document_is_rejected_before_log_or_confirmation(self):
        bill, lines = xiaomi_september_bill()
        doc = assess_channel_platform_variance(bill, lines, allow_documented_variance=True)
        kwargs = {
            "reason": "已核对小米开发者平台九月每个游戏结算凭证",
            "expected_system_amount": doc["system_amount"],
            "expected_platform_amount": doc["platform_amount"],
            "expected_settlement_amount": doc["recorded_settlement_amount"],
            "expected_signed_difference_cents": doc["signed_difference_cents"],
            "expected_line_ids": doc["line_ids"],
        }
        def db_mock():
            db = Mock()
            db.execute.return_value.scalar_one_or_none.return_value = bill
            db.execute.return_value.scalars.return_value.all.return_value = lines
            return db
        actor = SimpleNamespace(role="admin")
        db = db_mock()
        with self.assertRaises(HTTPException) as caught:
            confirm_approved_channel_platform_variance(
                "x-202609", ApprovedPlatformVarianceRequest(**kwargs),
                db=db, user=actor
            )
        self.assertEqual(caught.exception.detail["error"], "documented_platform_attestation_required")
        db.add.assert_not_called()

        db = db_mock()
        with self.assertRaises(HTTPException) as caught:
            confirm_approved_channel_platform_variance(
                "x-202609", ApprovedPlatformVarianceRequest(**kwargs, evidence_confirmed=True),
                db=db, user=actor
            )
        self.assertEqual(caught.exception.detail["error"], "documented_platform_attachment_required")
        db.add.assert_not_called()

        db = db_mock()
        db.execute.return_value.scalar_one_or_none.side_effect = [bill, None]
        with self.assertRaises(HTTPException) as caught:
            confirm_approved_channel_platform_variance(
                "x-202609", ApprovedPlatformVarianceRequest(
                    **kwargs, evidence_confirmed=True, evidence_attachment_id="other-bill"
                ),
                db=db, user=actor
            )
        self.assertEqual(caught.exception.detail["error"], "documented_platform_attachment_missing")
        db.add.assert_not_called()

    def test_offsetting_substantive_differences_still_require_per_game_correction(self):
        bill, lines = bill_and_lines(p1="2029.25", p2="2772.23")
        with self.assertRaises(HTTPException) as caught:
            assess_channel_platform_variance(bill, lines, allow_documented_variance=True)
        self.assertEqual(caught.exception.detail["error"], "platform_variance_offsetting")

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
