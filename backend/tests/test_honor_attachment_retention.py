"""Honor approval retains its original statement and serializes deletion."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import unittest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from app.api.bill_attachment import delete_attachment
from app.models.bill_attachment import BillAttachment
from app.models.reconciliation import ReconciliationRecord


def sql(statement):
    return str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


class HonorAttachmentRetentionTests(unittest.TestCase):
    def test_approved_source_cannot_be_deleted_and_parent_is_locked_first(self):
        for action in ("honor_official_statement_confirm", "platform_documented_variance_confirm"):
            with self.subTest(action=action):
                self._assert_approved_source_is_retained(action)

    def _assert_approved_source_is_retained(self, action):
        db = Mock()
        calls = []
        item = SimpleNamespace(id="proof", bill_type="channel", bill_id="bill", file_url="private-proof")
        db.get.return_value = item

        def execute(statement):
            query = sql(statement)
            calls.append(query)
            if len(calls) == 1:
                self.assertIn("channel_records", query)
                self.assertIn("FOR UPDATE", query)
                return Mock(scalar_one_or_none=Mock(return_value=SimpleNamespace(id="bill")))
            self.assertIn("operation_logs", query)
            self.assertIn(action, query)
            self.assertIn("proof", query)
            self.assertIn("bill", query)
            return Mock(scalar_one_or_none=Mock(return_value="approval"))

        db.execute.side_effect = execute
        with patch("app.api.bill_attachment.delete_private_blob", new_callable=AsyncMock) as storage:
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(delete_attachment("channel", "bill", "proof", db=db))
            self.assertEqual(raised.exception.detail["error"], "settlement_evidence_locked")
            db.delete.assert_not_called()
            db.commit.assert_not_called()
            storage.assert_not_awaited()
        self.assertEqual(len(calls), 2)
        db.get.assert_called_once_with(BillAttachment, "proof")

    def test_unapproved_channel_attachment_remains_deletable(self):
        db = Mock()
        item = SimpleNamespace(id="proof", bill_type="channel", bill_id="bill", file_url="private-proof")
        db.get.return_value = item
        db.execute.return_value.scalar_one_or_none.side_effect = [SimpleNamespace(id="bill"), None]
        with patch("app.api.bill_attachment.delete_private_blob", new_callable=AsyncMock) as storage:
            response = asyncio.run(delete_attachment("channel", "bill", "proof", db=db))
            self.assertEqual(response.status_code, 204)
            db.delete.assert_called_once_with(item)
            db.commit.assert_called_once()
            storage.assert_awaited_once_with("private-proof")

    def test_rd_attachment_behavior_is_unchanged(self):
        db = Mock()
        item = SimpleNamespace(id="proof", bill_type="rd", bill_id="bill", file_url="private-proof")
        db.get.side_effect = [SimpleNamespace(id="bill"), item]
        with patch("app.api.bill_attachment.delete_private_blob", new_callable=AsyncMock):
            response = asyncio.run(delete_attachment("rd", "bill", "proof", db=db))
        self.assertEqual(response.status_code, 204)
        db.execute.assert_not_called()
        self.assertEqual(db.get.call_args_list[0].args, (ReconciliationRecord, "bill"))
        db.delete.assert_called_once_with(item)
