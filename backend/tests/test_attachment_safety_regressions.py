"""Regression tests for bounded finance attachments and transaction-safe evidence."""

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from fastapi import HTTPException

from app.core.blob_storage import MAX_SERVER_UPLOAD_BYTES, read_limited_attachment
from app.api.bank_payment import upload_bank_payment_attachment, _get_or_create_empty_bank_payment
from app.api.bank_transaction import (
    upload_bank_transaction_attachment,
    download_bank_transaction_attachment,
)
from app.api.bill_attachment import upload_attachment


class DummyUpload:
    def __init__(self, content: bytes, name="receipt.pdf", mime="application/pdf"):
        self.content = content
        self.filename = name
        self.content_type = mime
        self.calls = []

    async def read(self, size=-1):
        self.calls.append(size)
        return self.content if size < 0 else self.content[:size]


class AttachmentSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def test_attachment_stream_read_is_limited(self):
        file = DummyUpload(b"x" * (MAX_SERVER_UPLOAD_BYTES + 200))
        with self.assertRaises(HTTPException) as raised:
            await read_limited_attachment(file)
        self.assertEqual(raised.exception.status_code, 413)
        self.assertEqual(file.calls, [MAX_SERVER_UPLOAD_BYTES + 1])

    async def test_empty_attachment_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            await read_limited_attachment(DummyUpload(b""))
        self.assertEqual(raised.exception.status_code, 400)

    async def test_valid_attachment_read(self):
        file = DummyUpload(b"%PDF-test")
        result = await read_limited_attachment(file)
        self.assertEqual(result, b"%PDF-test")
        self.assertEqual(file.calls, [MAX_SERVER_UPLOAD_BYTES + 1])

    async def test_invalid_payment_upload_does_not_create_empty_payment(self):
        db = Mock()
        file = DummyUpload(b"not-a-pdf", mime="text/html")
        with (
            patch("app.api.bank_payment._require_reconciliation"),
            patch("app.api.bank_payment._get_or_create_empty_bank_payment") as create,
        ):
            with self.assertRaises(HTTPException) as raised:
                await upload_bank_payment_attachment("rd-1", db=db, file=file)
        self.assertEqual(raised.exception.status_code, 400)
        create.assert_not_called()

    async def test_oversized_payment_upload_has_no_database_side_effect(self):
        db = Mock()
        with (
            patch("app.api.bank_payment._require_reconciliation"),
            patch("app.api.bank_payment._get_or_create_empty_bank_payment") as create,
        ):
            with self.assertRaises(HTTPException) as raised:
                await upload_bank_payment_attachment(
                    "rd-1", db=db,
                    file=DummyUpload(b"x" * (MAX_SERVER_UPLOAD_BYTES + 2)),
                )
        self.assertEqual(raised.exception.status_code, 413)
        create.assert_not_called()

    async def test_new_payment_is_flushed_not_committed_before_blob_is_saved(self):
        db = Mock()
        with (
            patch("app.api.bank_payment._require_reconciliation"),
            patch("app.api.bank_payment._get_bank_payment", return_value=None),
        ):
            _get_or_create_empty_bank_payment(db, "rd-2")
        db.flush.assert_called_once()
        db.commit.assert_not_called()

    async def test_blob_failure_rolls_back_parent_payment(self):
        db = Mock()
        with (
            patch("app.api.bank_payment._require_reconciliation"),
            patch("app.api.bank_payment._get_or_create_empty_bank_payment"),
            patch("app.api.bank_payment.upload_private_blob", new_callable=AsyncMock, side_effect=RuntimeError("storage down")),
        ):
            with self.assertRaises(RuntimeError):
                await upload_bank_payment_attachment("rd-2", db=db, file=DummyUpload(b"abc"))
        db.rollback.assert_called_once()
        db.commit.assert_not_called()

    async def test_bill_attachment_excess_is_rejected_before_upload(self):
        with (
            patch("app.api.bill_attachment._require_parent"),
            patch("app.api.bill_attachment.upload_private_blob", new_callable=AsyncMock) as put,
        ):
            with self.assertRaises(HTTPException) as raised:
                await upload_attachment("rd", "rd-1",
                    DummyUpload(b"x" * (MAX_SERVER_UPLOAD_BYTES + 3)), db=Mock())
        self.assertEqual(raised.exception.status_code, 413)
        put.assert_not_awaited()

    async def test_bank_transaction_upload_is_inert_and_downloads_as_attachment(self):
        file = DummyUpload(b"<script>alert(1)</script>", name="invoice.html", mime="text/html")
        with patch("app.api.bank_transaction.upload_private_blob", new_callable=AsyncMock, return_value="private-url") as put:
            res = await upload_bank_transaction_attachment(file)
        self.assertEqual(res["storage_url"], "private-url")
        self.assertEqual(put.await_args.args[2], "application/octet-stream")
        self.assertEqual(file.calls, [MAX_SERVER_UPLOAD_BYTES + 1])
        name = res["url"].split("/")[-2]
        with patch("app.api.bank_transaction.private_blob_response", new_callable=AsyncMock, return_value="download") as get:
            result = await download_bank_transaction_attachment(name)
        self.assertEqual(result, "download")
        self.assertFalse(get.await_args.kwargs["inline"])


if __name__ == "__main__":
    unittest.main()
