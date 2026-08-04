from types import SimpleNamespace
import unittest

from app.api.bill_invoice_allocation import _overview, _score_invoice_bill


class InvoiceMatchingTest(unittest.TestCase):
    def invoice(self, **overrides):
        values = {
            "id": "invoice-1",
            "invoice_direction": "output",
            "digital_invoice_no": "26442000008015786206",
            "invoice_no": None,
            "buyer_name": "厦门三七三三网络科技有限公司",
            "title": None,
            "seller_name": "广州熊动科技有限公司",
            "amount_with_tax": 4706.25,
            "invoice_amount": 4439.86,
            "tax_amount": 266.39,
            "tax_status": "normal",
            "status": "已开",
            "invoice_date": "2026-07-14",
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_exact_company_amount_and_next_month_scores_high(self):
        bill = SimpleNamespace(
            id="bill-1",
            partner_name="厦门三七三三网络科技有限公司",
            channel_name="三七三三",
            settlement_month="2026年6月",
            settlement_amount=4706.26,
            status="pending",
        )

        score, reasons, difference = _score_invoice_bill(
            self.invoice(), bill, 4706.26, 4706.25
        )

        self.assertEqual(score, 0.95)
        self.assertEqual(difference, 0.01)
        self.assertIn("往来单位精确匹配", reasons)
        self.assertIn("金额一致（±0.02元）", reasons)
        self.assertIn("次月开票", reasons)

    def test_red_invoice_has_no_allocatable_remaining_amount(self):
        summary = _overview(
            self.invoice(tax_status="red", amount_with_tax=-189.26),
            allocated=0,
            allocation_count=0,
        )

        self.assertEqual(summary.invoice_amount, 0)
        self.assertEqual(summary.remaining_amount, 0)


if __name__ == "__main__":
    unittest.main()
