import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from app.services.bill_archive import AUTO_ARCHIVE_DAYS, archive_eligibility, auto_archive_bill_if_ready


class BillArchiveRulesTest(unittest.TestCase):
    def make_bill(self, status="confirmed", amount=100):
        return SimpleNamespace(
            id="bill-1",
            status=status,
            settlement_amount=amount,
            created_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
            updated_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
        )

    def test_channel_auto_archive_window_remains_seven_days(self):
        self.assertEqual(AUTO_ARCHIVE_DAYS, 7)

    @patch("app.services.bill_archive._last_activity_at")
    @patch("app.services.bill_archive.bill_financial_state")
    def test_confirmed_paid_channel_bill_is_archivable(self, financial_state, last_activity):
        financial_state.return_value = SimpleNamespace(
            bill_amount=100,
            payment_phase="paid",
        )
        last_activity.return_value = datetime(2026, 8, 1, tzinfo=timezone.utc)

        eligible, reason, closure_at = archive_eligibility(object(), "channel", self.make_bill())

        self.assertTrue(eligible)
        self.assertEqual(reason, "已结清，可归档")
        self.assertEqual(closure_at, datetime(2026, 8, 1, tzinfo=timezone.utc))

    @patch("app.services.bill_archive._last_activity_at")
    @patch("app.services.bill_archive.bill_financial_state")
    def test_rd_bill_requires_invoice_and_payment_before_archive(self, financial_state, last_activity):
        financial_state.return_value = SimpleNamespace(
            bill_amount=100,
            payment_phase="paid",
            invoice_coverage_status="complete",
        )
        last_activity.return_value = datetime(2026, 8, 1, tzinfo=timezone.utc)

        eligible, reason, closure_at = archive_eligibility(object(), "rd", self.make_bill())

        self.assertTrue(eligible)
        self.assertIn("发票已收齐", reason)
        self.assertIn("付款已结清", reason)
        self.assertEqual(closure_at, datetime(2026, 8, 1, tzinfo=timezone.utc))

    @patch("app.services.bill_archive.bill_financial_state")
    def test_rd_bill_does_not_archive_before_invoice_is_complete(self, financial_state):
        financial_state.return_value = SimpleNamespace(
            bill_amount=100,
            payment_phase="paid",
            invoice_coverage_status="partial",
        )

        eligible, reason, _ = archive_eligibility(object(), "rd", self.make_bill())

        self.assertFalse(eligible)
        self.assertIn("发票尚未收齐", reason)

    @patch("app.services.bill_archive.bill_financial_state")
    def test_pending_bill_cannot_archive_even_when_paid(self, financial_state):
        financial_state.return_value = SimpleNamespace(
            bill_amount=100,
            payment_phase="paid",
            invoice_coverage_status="complete",
        )
        eligible, reason, _ = archive_eligibility(object(), "rd", self.make_bill(status="pending"))
        self.assertFalse(eligible)
        self.assertIn("尚未完成核对", reason)

    @patch("app.services.bill_archive.bill_financial_state")
    def test_unpaid_bill_cannot_archive(self, financial_state):
        financial_state.return_value = SimpleNamespace(bill_amount=100, payment_phase="partial")
        eligible, reason, _ = archive_eligibility(object(), "channel", self.make_bill())
        self.assertFalse(eligible)
        self.assertIn("收款尚未结清", reason)

    @patch("app.services.bill_archive.bill_financial_state")
    def test_zero_settlement_is_not_auto_archived(self, financial_state):
        financial_state.return_value = SimpleNamespace(
            bill_amount=0,
            payment_phase="paid",
            invoice_coverage_status="complete",
        )
        eligible, reason, _ = archive_eligibility(object(), "rd", self.make_bill(amount=0))
        self.assertFalse(eligible)
        self.assertIn("零结算", reason)

    @patch("app.services.bill_archive._load_bill")
    @patch("app.services.bill_archive._manual_unarchive_blocks_auto", return_value=True)
    @patch("app.services.bill_archive._is_archived", return_value=False)
    def test_manual_unarchive_prevents_immediate_rd_auto_rearchive(
        self,
        _is_archived,
        manual_unarchive_blocks_auto,
        load_bill,
    ):
        result = auto_archive_bill_if_ready(object(), "rd", "bill-1")

        self.assertFalse(result)
        manual_unarchive_blocks_auto.assert_called_once()
        load_bill.assert_not_called()


if __name__ == "__main__":
    unittest.main()
