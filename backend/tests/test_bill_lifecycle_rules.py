import unittest

from fastapi import HTTPException

from app.services.bill_lifecycle import (
    _transition_requires_reason,
    assert_update_allowed,
    is_financially_locked,
    status_label,
    transition_label,
)


class BillLifecycleRulesTest(unittest.TestCase):
    def test_status_labels_and_lock_boundary(self):
        self.assertEqual(status_label("pending"), "待核对")
        self.assertEqual(status_label("confirmed"), "已核对")
        self.assertFalse(is_financially_locked("pending"))
        self.assertTrue(is_financially_locked("confirmed"))
        self.assertTrue(is_financially_locked("cancelled"))

    def test_locked_bill_rejects_financial_update_but_allows_remark(self):
        cleaned = assert_update_allowed(
            "rd",
            "confirmed",
            {"status": "confirmed", "remark": "补充说明"},
        )
        self.assertEqual(cleaned, {"remark": "补充说明"})

        with self.assertRaises(HTTPException) as context:
            assert_update_allowed("rd", "confirmed", {"settlement_amount": 100})
        self.assertEqual(context.exception.status_code, 409)
        self.assertEqual(context.exception.detail["error"], "bill_locked")

    def test_direct_status_change_must_use_transition_endpoint(self):
        with self.assertRaises(HTTPException) as context:
            assert_update_allowed("channel", "pending", {"status": "confirmed"})
        self.assertEqual(context.exception.status_code, 409)
        self.assertEqual(context.exception.detail["error"], "use_status_transition")

    def test_return_and_cancel_require_reason(self):
        self.assertTrue(_transition_requires_reason("confirmed", "pending"))
        self.assertTrue(_transition_requires_reason("pending", "cancelled"))
        self.assertFalse(_transition_requires_reason("pending", "confirmed"))
        self.assertEqual(transition_label("rd", "confirmed", "invoiced"), "发票已收齐")
        self.assertEqual(transition_label("channel", "confirmed", "invoiced"), "发票已开齐")


if __name__ == "__main__":
    unittest.main()
