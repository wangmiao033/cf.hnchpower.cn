import unittest

from app.services.invoice_archive import (
    ARCHIVE_TOLERANCE,
    invoice_archive_eligibility_from_values,
)


class InvoiceArchiveRulesTest(unittest.TestCase):
    def eligible(self, **overrides):
        payload = {
            "invoice_amount": 100.0,
            "allocated_amount": 100.0,
            "tax_status": "normal",
            "display_status": "已开",
            "red_adjustment_amount": 0.0,
        }
        payload.update(overrides)
        return invoice_archive_eligibility_from_values(**payload)

    def test_complete_normal_invoice_can_archive(self):
        ok, reason = self.eligible()
        self.assertTrue(ok)
        self.assertIn("可归档", reason)

    def test_partial_invoice_stays_active(self):
        ok, reason = self.eligible(allocated_amount=99.0)
        self.assertFalse(ok)
        self.assertIn("未完整覆盖", reason)

    def test_overallocated_invoice_stays_active(self):
        ok, reason = self.eligible(allocated_amount=100.02)
        self.assertFalse(ok)
        self.assertIn("超额", reason)

    def test_one_cent_tolerance_is_allowed(self):
        ok, _ = self.eligible(allocated_amount=100.0 - ARCHIVE_TOLERANCE)
        self.assertTrue(ok)

    def test_red_or_void_invoice_stays_active(self):
        self.assertFalse(self.eligible(tax_status="red")[0])
        self.assertFalse(self.eligible(tax_status="void", display_status="作废")[0])

    def test_original_invoice_with_red_adjustment_stays_active(self):
        ok, reason = self.eligible(red_adjustment_amount=10.0)
        self.assertFalse(ok)
        self.assertIn("红冲", reason)

    def test_zero_amount_invoice_stays_active(self):
        ok, reason = self.eligible(invoice_amount=0, allocated_amount=0)
        self.assertFalse(ok)
        self.assertIn("零金额", reason)


if __name__ == "__main__":
    unittest.main()
