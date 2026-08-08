import unittest
from datetime import date, datetime, timezone
from types import SimpleNamespace

from app.services.workbench_todos import (
    _active_bill,
    _contract_risk_flags,
    _post_review,
    _review_pending,
    build_workbench_todos,
)


class NeverQueryDb:
    def execute(self, *_args, **_kwargs):
        raise AssertionError("no-permission workbench must not query module data")


class WorkbenchTodosTest(unittest.TestCase):
    def test_review_status_helpers_follow_simplified_flow(self):
        pending = SimpleNamespace(status="pending")
        draft = SimpleNamespace(status="draft")
        confirmed = SimpleNamespace(status="confirmed")
        cancelled = SimpleNamespace(status="cancelled")

        self.assertTrue(_review_pending(pending))
        self.assertTrue(_review_pending(draft))
        self.assertFalse(_post_review(pending))
        self.assertTrue(_post_review(confirmed))
        self.assertFalse(_active_bill(cancelled))
        self.assertFalse(_post_review(cancelled))

    def test_contract_expiry_flags_use_30_day_window_and_active_status(self):
        today = date(2026, 8, 8)

        self.assertEqual(
            _contract_risk_flags("2026-08-28", "履行中", today),
            (True, False),
        )
        self.assertEqual(
            _contract_risk_flags("2026-08-28", "已终止", today),
            (False, False),
        )
        self.assertEqual(
            _contract_risk_flags("2026-08-07", "履行中", today),
            (False, True),
        )
        self.assertEqual(
            _contract_risk_flags("2026-08-07", "已完成", today),
            (False, False),
        )
        self.assertEqual(
            _contract_risk_flags("2026-10-01", "履行中", today),
            (False, False),
        )

    def test_no_permission_returns_empty_without_querying_business_tables(self):
        result = build_workbench_todos(
            NeverQueryDb(),
            set(),
            now=datetime(2026, 8, 8, 12, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(result["items"], [])
        self.assertEqual(result["visible_modules"], [])
        self.assertEqual(result["summary"]["total_count"], 0)
        self.assertEqual(result["summary"]["urgent_count"], 0)
        self.assertEqual(result["summary"]["receivable_amount"], 0)
        self.assertEqual(result["summary"]["payable_amount"], 0)


if __name__ == "__main__":
    unittest.main()
