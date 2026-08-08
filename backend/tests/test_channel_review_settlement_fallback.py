import unittest
from types import SimpleNamespace

from app.api.bill_lifecycle import _prefer_channel_line_item_settlement


class ChannelReviewSettlementFallbackTest(unittest.TestCase):
    def test_channel_line_items_replace_stale_zero_header_amount(self):
        bill = SimpleNamespace(
            settlement_amount=0,
            line_items=[
                SimpleNamespace(settlement_amount=3092.64),
                SimpleNamespace(settlement_amount=709.88),
            ],
        )

        _prefer_channel_line_item_settlement("channel", bill)

        self.assertAlmostEqual(float(bill.settlement_amount), 3802.52, places=2)

    def test_rd_bill_is_not_modified(self):
        bill = SimpleNamespace(
            settlement_amount=100,
            line_items=[SimpleNamespace(settlement_amount=999)],
        )

        _prefer_channel_line_item_settlement("rd", bill)

        self.assertEqual(float(bill.settlement_amount), 100)

    def test_channel_without_detail_keeps_header_amount(self):
        bill = SimpleNamespace(settlement_amount=88.8, line_items=[])

        _prefer_channel_line_item_settlement("channel", bill)

        self.assertEqual(float(bill.settlement_amount), 88.8)


if __name__ == "__main__":
    unittest.main()
