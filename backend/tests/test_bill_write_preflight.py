"""Common financial-write preflight protects both channel and RD from stale edits."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock

from fastapi import HTTPException

from app.api.channel import update_channel_record
from app.api.reconciliation import update_reconciliation
from app.schemas.channel import ChannelRecordUpdate
from app.schemas.reconciliation import ReconciliationUpdate
from app.services.bill_write_preflight import prepare_bill_financial_update

NOW = datetime(2026, 10, 14, 11, 5, 3, 123456, timezone.utc)


def persisted(status="pending"):
    return SimpleNamespace(status=status, updated_at=NOW)


class BillWritePreflightTest(TestCase):
    def assert_conflict(self, kind, row, update, code):
        with self.assertRaises(HTTPException) as raised:
            prepare_bill_financial_update(kind, row, update)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail["error"], code)
        self.assertEqual(raised.exception.detail["current_status"], row.status)
        return raised.exception.detail

    def test_pending_channel_and_rd_accept_the_correct_revision(self):
        for kind in ("channel", "rd"):
            fields = prepare_bill_financial_update(kind, persisted(), {
                "status": "pending",
                "remark": "本期核对说明",
                "expected_updated_at": NOW
            })
            self.assertEqual(fields, {"remark": "本期核对说明"})

    def test_locked_bill_rejects_stale_pending_editor_before_mutation(self):
        for kind in ("channel", "rd"):
            row = persisted("confirmed")
            details = self.assert_conflict(kind, row, {
                "status": "pending",
                "items": [{"game_name": "六界仙尊"}],
                "expected_updated_at": NOW
            }, "use_status_transition")
            self.assertIn("已核对", details["message"])
            self.assertIn("退回待核对", details["message"])
            self.assertEqual(row.status, "confirmed")
            self.assertEqual(row.updated_at, NOW)

    def test_locked_bill_blocks_full_financial_update_even_with_same_status(self):
        for kind in ("channel", "rd"):
            self.assert_conflict(kind, persisted("confirmed"), {
                "status": "confirmed", "settlement_month": "2026-08",
                "items": [], "expected_updated_at": NOW
            }, "bill_locked")

    def test_locked_bill_may_only_receive_nonfinancial_description(self):
        for kind in ("channel", "rd"):
            cleaned = prepare_bill_financial_update(kind, persisted("confirmed"), {
                "status": "confirmed", "remark": "补充审计说明", "expected_updated_at": NOW
            })
            self.assertEqual(cleaned, {"remark": "补充审计说明"})

    def test_concurrent_financial_edit_returns_409_and_preserves_saved_data(self):
        for kind in ("channel", "rd"):
            row = persisted()
            detail = self.assert_conflict(kind, row, {
                "status": "pending",
                "settlement_month": "2026-07",
                "expected_updated_at": NOW - timedelta(seconds=15)
            }, "bill_version_conflict")
            self.assertEqual(detail["current_status"], "pending")
            self.assertEqual(row.updated_at, NOW)

    def test_revision_precision_and_timezone_do_not_make_a_false_conflict(self):
        other_zone = timezone(timedelta(hours=8))
        token = NOW.astimezone(other_zone)
        for kind in ("channel", "rd"):
            cleaned = prepare_bill_financial_update(kind, persisted(), {
                "remark": "安全修改", "expected_updated_at": token
            })
            self.assertEqual(cleaned, {"remark": "安全修改"})

    def test_previous_integrations_without_revision_cannot_bypass_lifecycle_lock(self):
        for kind in ("channel", "rd"):
            self.assertEqual(prepare_bill_financial_update(kind, persisted(), {
                "remark": "更新备注"
            }), {"remark": "更新备注"})
            self.assert_conflict(kind, persisted("invoiced"), {
                "items": []
            }, "bill_locked")

    def test_channel_route_rejects_locked_financial_write_before_any_commit(self):
        db = Mock()
        db.execute.return_value.scalar_one_or_none.return_value = persisted("confirmed")
        with self.assertRaises(HTTPException) as raised:
            update_channel_record(
                "bill-id",
                ChannelRecordUpdate(
                    status="pending", remark="编辑草稿",
                    items=[{"game_name": "游戏", "billing_flow": 100}],
                    expected_updated_at=NOW
                ),
                db=db,
            )
        self.assertEqual(raised.exception.detail["error"], "use_status_transition")
        db.commit.assert_not_called()
        db.flush.assert_not_called()

    def test_rd_route_rejects_locked_financial_write_before_any_commit(self):
        db = Mock()
        db.execute.return_value.scalar_one_or_none.return_value = persisted("confirmed")
        with self.assertRaises(HTTPException) as raised:
            update_reconciliation(
                "bill-id",
                ReconciliationUpdate(
                    status="pending", remark="编辑草稿",
                    items=[{"game_name": "游戏", "revenue": 100}],
                    expected_updated_at=NOW
                ),
                db=db,
            )
        self.assertEqual(raised.exception.detail["error"], "use_status_transition")
        db.commit.assert_not_called()
        db.flush.assert_not_called()
