import unittest
from fastapi import HTTPException
from cloudflare_main import _workers_ai_payload
import external_renderer_main

class PdfRemovalTest(unittest.TestCase):
    def test_pdf_is_rejected_by_name_mime_or_signature(self):
        for name, mime, body in [
            ("contract.PDF", "application/octet-stream", b"data"),
            ("contract.jpg", "application/pdf; charset=binary", b"data"),
            ("contract.jpg", "image/jpeg", b"%PDF-1.7"),
        ]:
            with self.subTest(name=name, mime=mime), self.assertRaises(HTTPException) as error:
                _workers_ai_payload(name, mime, body)
            self.assertEqual(error.exception.status_code, 422)

    def test_image_scan_route_remains_available(self):
        routes = [r for r in external_renderer_main.app.routes
                  if getattr(r, "path", None) == "/api/contracts/smart-scan"]
        self.assertEqual(len(routes), 1)
