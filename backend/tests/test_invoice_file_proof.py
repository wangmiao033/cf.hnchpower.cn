"""A parsed invoice file may only be linked through its own short-lived token."""
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException

from app.services.invoice_file_proof import sign_invoice_upload, verify_invoice_upload


SOURCE = {
    "source_file_url": "https://example.private.vercel-storage.com/invoice-files/2026/10/original.pdf",
    "source_file_name": "天宇-熊动12-2月账单发票.pdf",
    "source_file_type": "application/pdf",
    "source_file_size": 103573,
}


class InvoiceFileProofTests(TestCase):
    @patch.dict("os.environ", {"BLOB_READ_WRITE_TOKEN": "dummy-private-test-token"})
    def test_round_trip_retains_filename_and_original_private_reference(self):
        proof = sign_invoice_upload(SOURCE, now=100000)
        value = verify_invoice_upload(proof, now=100200)
        self.assertEqual(value["name"], SOURCE["source_file_name"])
        self.assertEqual(value["url"], SOURCE["source_file_url"])
        self.assertEqual(value["size"], 103573)

    @patch.dict("os.environ", {"BLOB_READ_WRITE_TOKEN": "dummy-private-test-token"})
    def test_rejects_tampered_token_or_expired_file(self):
        proof = sign_invoice_upload(SOURCE, now=100000)
        for damaged in (proof[:-1] + ("0" if proof[-1] != "0" else "1"), "invalid"):
            with self.assertRaises(HTTPException) as raised:
                verify_invoice_upload(damaged, now=100010)
            self.assertEqual(raised.exception.status_code, 409)
        with self.assertRaises(HTTPException) as expired:
            verify_invoice_upload(proof, now=103601)
        self.assertEqual(expired.exception.detail["error"], "invoice_source_proof_invalid")

    @patch.dict("os.environ", {"BLOB_READ_WRITE_TOKEN": "dummy-private-test-token"})
    def test_cannot_sign_an_external_file_not_saved_by_the_invoice_parser(self):
        with self.assertRaises(ValueError):
            sign_invoice_upload({**SOURCE, "source_file_url": "https://example.com/uploads/unrelated.pdf"})
        with self.assertRaises(ValueError):
            sign_invoice_upload({**SOURCE, "source_file_type": "text/html"})
        with self.assertRaises(ValueError):
            sign_invoice_upload({**SOURCE, "source_file_size": 50 * 1024 * 1024})
