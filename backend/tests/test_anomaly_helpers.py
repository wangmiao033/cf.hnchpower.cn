from __future__ import annotations

import unittest

from app.api.anomaly import _coverage_status, _parse_bill_refs


class AnomalyHelpersTest(unittest.TestCase):
    def test_parses_and_deduplicates_bill_refs(self) -> None:
        self.assertEqual(
            _parse_bill_refs("rd:bill-1,channel:bill-2,rd:bill-1,bad:x,rd:"),
            [("rd", "bill-1"), ("channel", "bill-2")],
        )

    def test_invoice_coverage_status(self) -> None:
        self.assertEqual(_coverage_status(0, 100), "none")
        self.assertEqual(_coverage_status(80, 100), "partial")
        self.assertEqual(_coverage_status(100, 100), "complete")
        self.assertEqual(_coverage_status(101, 100), "over")


if __name__ == "__main__":
    unittest.main()
