"""Regression: two voucher fields, no legacy re-interpretation."""
import unittest
from decimal import Decimal
from types import SimpleNamespace

from app.schemas.channel import ChannelLineItemCreate
from app.services.channel_settlement_engine import (
    ANJIU_PRE_DISCOUNT_DEDUCTION_RULE,
    XIAN_WEIZHEN_9917_RULE,
    calculate_channel_line,
    voucher_cost_for_storage,
)


class ChannelSplitVoucherTests(unittest.TestCase):
    def make_rule(self, code="five_percent_gateway_share"):
        return SimpleNamespace(
            settlement_rule_code=code,
            channel_fee_mode="percent", channel_fee_rate=5,
            tax_mode="none", validation_tolerance=0.05,
        )

    def make_line(self, *, face=None, direct=None, legacy=0, flow=74312, discount=0.005):
        return SimpleNamespace(
            billing_flow=flow, discount_factor=discount, voucher_cost=legacy,
            voucher_face_value=face, voucher_direct_cost=direct,
            no_worry_cost=0, refund_cost=0, test_cost=0, welfare_cost=0,
            coin_cost=0, share_rate=30, tax_rate=0, gateway_cost=0,
            platform_settlement_amount=104.97,
        )

    def test_face_value_matches_real_august_statement(self):
        rule = self.make_rule()
        row = self.make_line(face=648, direct=0)
        self.assertEqual(voucher_cost_for_storage(row, rule), Decimal("3.24"))
        result = calculate_channel_line(row, rule)
        self.assertEqual(result["system_settlement_amount"], Decimal("104.97"))
        self.assertEqual(result["validation_status"], "pass")

    def test_direct_voucher_is_not_discounted_again(self):
        rule = self.make_rule()
        row = self.make_line(face=0, direct=3.24)
        self.assertEqual(voucher_cost_for_storage(row, rule), Decimal("3.24"))
        self.assertEqual(calculate_channel_line(row, rule)["system_settlement_amount"], Decimal("104.97"))

    def test_both_voucher_types_in_one_game(self):
        rule = self.make_rule()
        row = self.make_line(face=648, direct=10)
        self.assertEqual(voucher_cost_for_storage(row, rule), Decimal("13.24"))
        self.assertEqual(calculate_channel_line(row, rule)["system_settlement_amount"], Decimal("102.12"))

    def test_legacy_row_preserves_original_amount(self):
        rule = self.make_rule()
        row = self.make_line(legacy=3.24)
        self.assertEqual(voucher_cost_for_storage(row, rule), Decimal("3.24"))
        self.assertEqual(calculate_channel_line(row, rule)["system_settlement_amount"], Decimal("104.97"))

    def test_anjiu_legacy_and_split_face_keep_same_result(self):
        rule = self.make_rule(ANJIU_PRE_DISCOUNT_DEDUCTION_RULE)
        row = self.make_line(face=7776, direct=0, flow=3534002)
        row.platform_settlement_amount = 5024.87
        row.tax_rate = 0
        self.assertEqual(voucher_cost_for_storage(row, rule), Decimal("7776.00"))
        self.assertEqual(calculate_channel_line(row, rule)["system_settlement_amount"], Decimal("5024.87"))
        row.voucher_face_value = None
        row.voucher_direct_cost = None
        row.voucher_cost = 7776
        self.assertEqual(calculate_channel_line(row, rule)["system_settlement_amount"], Decimal("5024.87"))

    def test_anjiu_direct_coupon_remains_post_discount(self):
        rule = self.make_rule(ANJIU_PRE_DISCOUNT_DEDUCTION_RULE)
        row = self.make_line(face=648, direct=10, flow=74312)
        self.assertEqual(voucher_cost_for_storage(row, rule), Decimal("2648.00"))
        self.assertEqual(calculate_channel_line(row, rule)["billing_amount"], Decimal("358.32"))

    def test_xian_weizhen_records_but_does_not_deduct(self):
        rule = self.make_rule(XIAN_WEIZHEN_9917_RULE)
        row = self.make_line(face=648, direct=10)
        self.assertEqual(calculate_channel_line(row, rule)["billing_amount"], Decimal("371.56"))

    def test_schema_old_rows_stay_null_and_new_rows_keep_inputs(self):
        legacy = ChannelLineItemCreate()
        self.assertIsNone(legacy.voucher_face_value)
        self.assertIsNone(legacy.voucher_direct_cost)
        new = ChannelLineItemCreate(voucher_face_value=648, voucher_direct_cost=10)
        self.assertEqual(new.voucher_face_value, 648)
        self.assertEqual(new.voucher_direct_cost, 10)


if __name__ == "__main__":
    unittest.main()
