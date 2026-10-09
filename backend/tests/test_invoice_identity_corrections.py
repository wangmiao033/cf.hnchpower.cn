"""Regression checks for invoice identity consistency and duplicate protection."""

import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException

from app.api.invoice import (
    _identity_key, _lock_invoice_identity, _normalize_invoice_amounts,
    import_invoice_records, update_invoice_record,
)
from app.schemas.invoice import (
    InvoiceRecordCreate, InvoiceRecordImportRequest, InvoiceRecordUpdate,
)


def existing_invoice(**overrides):
    fields = {
        "id": "invoice-1",
        "digital_invoice_no": None,
        "invoice_code": "001",
        "invoice_no": "100",
        "invoice_identity_key": "legacy:001:100",
        "invoice_amount": 100,
        "tax_amount": 6,
        "amount_with_tax": 106,
        "updated_at": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


class InvoiceIdentityRegressionTests(unittest.TestCase):
    def save(self, changes, *, invoice=None, duplicate=False):
        row = invoice or existing_invoice()
        db = Mock()
        db.get.return_value = row
        conflicting = HTTPException(status_code=409, detail={"error": "duplicate_invoice"})
        with (
            patch("app.api.invoice.release_manual_archive_hold"),
            patch("app.api.invoice._ensure_unique_identity",
                  side_effect=conflicting if duplicate else None) as duplicate_check,
            patch("app.api.invoice.InvoiceRecordRead.model_validate", side_effect=lambda value: value),
        ):
            if duplicate:
                with self.assertRaises(HTTPException) as captured:
                    update_invoice_record("invoice-1", InvoiceRecordUpdate(**changes), db=db)
                self.assertEqual(captured.exception.status_code, 409)
                db.commit.assert_not_called()
                return row, duplicate_check
            result = update_invoice_record("invoice-1", InvoiceRecordUpdate(**changes), db=db)
        db.commit.assert_called_once()
        return result, duplicate_check

    def test_explicit_wrong_identity_does_not_override_real_invoice_number(self):
        data = {
            "digital_invoice_no": " 264400123 ",
            "invoice_identity_key": "digital:old-number",
            "invoice_amount": 100,
            "tax_amount": 6,
        }
        _normalize_invoice_amounts(data)
        self.assertEqual(data["invoice_identity_key"], "digital:264400123")
        self.assertEqual(data["amount_with_tax"], 106)

    def test_legacy_number_correction_updates_identity(self):
        invoice, duplicate_check = self.save({"invoice_no": "101"})
        self.assertEqual(invoice.invoice_identity_key, "legacy:001:101")
        self.assertEqual(duplicate_check.call_args.args[1], "legacy:001:101")

    def test_digital_number_correction_updates_identity(self):
        invoice, _ = self.save(
            {"digital_invoice_no": "NEW-888"},
            invoice=existing_invoice(
                digital_invoice_no="OLD-777", invoice_identity_key="digital:OLD-777"
            ),
        )
        self.assertEqual(invoice.invoice_identity_key, "digital:NEW-888")

    def test_removing_digital_number_falls_back_to_legacy(self):
        invoice, _ = self.save(
            {"digital_invoice_no": None},
            invoice=existing_invoice(
                digital_invoice_no="OLD-777", invoice_identity_key="digital:OLD-777"
            ),
        )
        self.assertEqual(invoice.invoice_identity_key, "legacy:001:100")

    def test_clearing_all_structured_numbers_removes_old_identity(self):
        invoice, _ = self.save(
            {"invoice_code": None, "invoice_no": None}
        )
        self.assertIsNone(invoice.invoice_identity_key)

    def test_change_to_duplicate_number_is_rejected_before_save(self):
        invoice, duplicate_check = self.save({"invoice_no": "101"}, duplicate=True)
        self.assertEqual(invoice.invoice_no, "100")
        self.assertEqual(duplicate_check.call_args.args[1], "legacy:001:101")

    def test_advisory_lock_only_issued_for_postgres_and_nonempty_identity(self):
        calls = []
        pg = Mock()
        pg.get_bind.return_value.dialect.name = "postgresql"
        pg.execute.side_effect = lambda stmt, params: calls.append((str(stmt), params))
        _lock_invoice_identity(pg, "digital:123")
        self.assertEqual(len(calls), 1)
        self.assertIn("pg_advisory_xact_lock", calls[0][0])
        self.assertEqual(calls[0][1]["key"], "invoice-identity:digital:123")
        _lock_invoice_identity(pg, None)
        self.assertEqual(len(calls), 1)

        sqlite = Mock()
        sqlite.get_bind.return_value.dialect.name = "sqlite"
        _lock_invoice_identity(sqlite, "digital:123")
        sqlite.execute.assert_not_called()

    def test_bulk_import_locks_invoice_keys_in_deterministic_order(self):
        db = Mock()
        db.get_bind.return_value.dialect.name = "sqlite"
        db.execute.return_value.scalars.return_value.all.return_value = []
        body = InvoiceRecordImportRequest(items=[
            InvoiceRecordCreate(digital_invoice_no="B", amount_with_tax=200),
            InvoiceRecordCreate(digital_invoice_no="A", amount_with_tax=100),
        ])
        seen = []
        with patch("app.api.invoice._lock_invoice_identity", side_effect=lambda _db, key: seen.append(key)):
            outcome = import_invoice_records(body, db=db)
        self.assertEqual(seen, ["digital:A", "digital:B"])
        self.assertEqual(outcome.created, 2)
        db.commit.assert_called_once()

    def test_unstructured_historical_identity_remains_when_number_untouched(self):
        invoice, _ = self.save(
            {"remark": "补充附件记录"},
            invoice=existing_invoice(
                digital_invoice_no=None, invoice_code=None, invoice_no=None,
                invoice_identity_key="source:external:abc"
            ),
        )
        self.assertEqual(invoice.invoice_identity_key, "source:external:abc")


if __name__ == "__main__":
    unittest.main()
