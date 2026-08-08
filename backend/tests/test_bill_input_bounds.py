import unittest

from pydantic import ValidationError

from app.schemas.channel import ChannelLineItemCreate, ChannelRecordCreate
from app.schemas.reconciliation import ReconciliationCreate, ReconciliationLineItemIn


class BillInputBoundsTest(unittest.TestCase):
    def test_rd_line_percentage_bounds(self):
        with self.assertRaises(ValidationError):
            ReconciliationLineItemIn(game_name="测试", discount_rate=1.01)
        with self.assertRaises(ValidationError):
            ReconciliationLineItemIn(game_name="测试", share_ratio=100.01)
        with self.assertRaises(ValidationError):
            ReconciliationLineItemIn(game_name="测试", tax_rate=-0.01)

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

    def test_channel_header_percentage_bounds(self):
        item = ChannelLineItemCreate(game_name="测试")
        with self.assertRaises(ValidationError):
            ChannelRecordCreate(partner_name="合作方", settlement_month="2026-08", channel_fee_rate=101, items=[item])


if __name__ == "__main__":
    unittest.main()
