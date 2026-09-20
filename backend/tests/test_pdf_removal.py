import unittest
from app.services.electronic_invoice_parser import extract_electronic_invoice_text

class InvoicePdfRemovalTest(unittest.TestCase):
    def test_pdf_rejected_and_xml_still_parsed(self):
        with self.assertRaisesRegex(ValueError, "unsupported_file_type"):
            extract_electronic_invoice_text("invoice.PDF", b"%PDF-1.7")
        text, parser, mime = extract_electronic_invoice_text(
            "invoice.xml", b"<Invoice><InvoiceNo>1234567890</InvoiceNo></Invoice>")
        self.assertIn("1234567890", text)
        self.assertEqual((parser, mime), ("xml", "application/xml"))
