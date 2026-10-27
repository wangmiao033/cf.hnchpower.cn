import unittest

from pydantic import ValidationError

from app.schemas.channel import ChannelLineItemCreate, ChannelRecordCreate, ChannelRecordUpdate
from app.schemas.reconciliation import ReconciliationCreate, ReconciliationLineItemIn


class BillInputBoundsTest(unittest.TestCase):
    def test_rd_line_percentage_bounds(self):
        with self.assertRaises(ValidationError):
            ReconciliationLineItemIn(game_name="测试", revenue=1, discount_rate=1.01)
        with self.assertRaises(ValidationError):
            ReconciliationLineItemIn(game_name="测试", revenue=1, share_ratio=100.01)
        with self.assertRaises(ValidationError):
            ReconciliationLineItemIn(game_name="测试", revenue=1, tax_rate=-0.01)

    def test_rd_header_percentage_bounds(self):
        with self.assertRaises(ValidationError):
            ReconciliationCreate(channel_fee_rate=101)
        with self.assertRaises(ValidationError):
            ReconciliationCreate(discount_value=-0.01)

    def test_channel_line_percentage_bounds(self):
        with self.assertRaises(ValidationError):
            ChannelLineItemCreate(game_name="测试", discount_factor=1.5)
        with self.assertRaises(ValidationError):
            ChannelLineItemCreate(game_name="测试", share_rate=-1)
        with self.assertRaises(ValidationError):
            ChannelLineItemCreate(game_name="测试", tax_rate=101)

    def test_channel_negative_flow_is_valid_for_refunds_and_reversals(self):
        reversal = ChannelLineItemCreate(
            game_name="魔力契约（代金券冲销）",
            billing_flow=-3.24,
            share_rate=30,
            tax_rate=0,
            platform_settlement_amount=-0.92,
        )
        self.assertEqual(reversal.billing_flow, -3.24)

        created = ChannelRecordCreate(
            partner_name="测试渠道",
            settlement_month="2026-09",
            items=[reversal],
        )
        updated = ChannelRecordUpdate(items=[reversal])
        self.assertEqual(created.items[0].billing_flow, -3.24)
        self.assertEqual(updated.items[0].billing_flow, -3.24)

    def test_channel_flow_must_remain_finite(self):
        for invalid in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValidationError):
                    ChannelLineItemCreate(game_name="测试", billing_flow=invalid)

    def test_channel_header_percentage_bounds(self):
        item = ChannelLineItemCreate(game_name="测试")
        with self.assertRaises(ValidationError):
            ChannelRecordCreate(partner_name="合作方", settlement_month="2026-08", channel_fee_rate=101, items=[item])


if __name__ == "__main__":
    unittest.main()
