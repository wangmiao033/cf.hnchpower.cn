"""Regression protection for real incoming invoices linked to R&D settlements."""
from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.rd_invoice_merge import ReceivedRdInputInvoiceRequest, record_received_rd_input_invoice
from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.invoice import InvoiceRecord
from app.models.operation_log import OperationLog


def payload(**updates):
    data = {
        "bill_ids": ["rd-july", "rd-aug"],
        "seller_name": "深圳研发合作方有限公司",
        "seller_tax_no": "914403000000000000",
        "buyer_name": "广州收票公司有限公司",
        "buyer_tax_no": "914400000000000000",
        "invoice_type": "数电发票（增值税专用发票）",
        "digital_invoice_no": "23888888888888888888",
        "invoice_date": "2026-10-13",
        "invoice_amount": Decimal("4356.70"),
        "tax_amount": Decimal("0.10"),
        "amount_with_tax": Decimal("4356.80"),
    }
    data.update(updates)
    return ReceivedRdInputInvoiceRequest(**data)


def bills():
    return [
        SimpleNamespace(
            id="rd-july", partner_name="深圳研发合作方有限公司",
            statement_no="JS-202607-001", settlement_month="2026-07",
            status="confirmed", settlement_amount=Decimal("1839.23"),
            paid_amount=Decimal("1839.23"), prepayment_deduction=0,
        ),
        SimpleNamespace(
            id="rd-aug", partner_name="深圳研发合作方有限公司",
            statement_no="JS-202608-001", settlement_month="2026-08",
            status="confirmed", settlement_amount=Decimal("2517.57"),
            paid_amount=Decimal("0"), prepayment_deduction=Decimal("500"),
        ),
    ]


class Result:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self.rows)


class FakeDb:
    def __init__(self, rows):
        self.rows = rows
        self.added = []
        self.commits = 0
        self.rollbacks = 0

    def execute(self, _statement):
        return Result(self.rows)

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class RdInputInvoiceMergeTests(TestCase):
    @patch("app.api.rd_invoice_merge._ensure_unique_identity")
    @patch("app.api.rd_invoice_merge._lock_invoice_identity")
    @patch("app.api.rd_invoice_merge._effective_coverage_cents", return_value={})
    def test_registers_one_input_invoice_for_two_rd_bills_without_editing_cash(self, cov, lock, unique):
        records = bills()
        snapshot = [(r.status, r.settlement_amount, r.paid_amount, r.prepayment_deduction) for r in records]
        db = FakeDb(records)

        result = record_received_rd_input_invoice(payload(), db)
        invoices = [row for row in db.added if isinstance(row, InvoiceRecord)]
        links = [row for row in db.added if isinstance(row, BillInvoiceAllocation)]
        logs = [row for row in db.added if isinstance(row, OperationLog)]

        self.assertEqual(result.allocated_amount, 4356.80)
        self.assertEqual(result.allocated_bills, 2)
        self.assertEqual(db.commits, 1)
        self.assertEqual(db.rollbacks, 0)
        self.assertEqual(len(invoices), 1)
        self.assertEqual(invoices[0].invoice_direction, "input")
        self.assertEqual(invoices[0].seller_name, records[0].partner_name)
        self.assertEqual(invoices[0].buyer_name, "广州收票公司有限公司")
        self.assertEqual(invoices[0].status, "已开")
        self.assertEqual(len(links), 2)
        self.assertTrue(all(link.bill_type == "rd" for link in links))
        self.assertEqual(sum(round(float(link.allocated_gross_amount) * 100) for link in links), 435680)
        self.assertEqual(sum(round(float(link.allocated_net_amount) * 100) for link in links), 435670)
        self.assertEqual(sum(round(float(link.allocated_tax_amount) * 100) for link in links), 10)
        self.assertEqual(len(logs), 2)
        self.assertEqual([(r.status, r.settlement_amount, r.paid_amount, r.prepayment_deduction) for r in records], snapshot)
        cov.assert_called_once_with(db, ["rd-july", "rd-aug"], "rd")
        lock.assert_called_once()
        unique.assert_called_once()

    @patch("app.api.rd_invoice_merge._effective_coverage_cents", return_value={})
    def test_rejects_different_partner_legal_entity(self, _coverage):
        records = bills()
        records[1].partner_name = "另一研发公司有限公司"
        db = FakeDb(records)
        with self.assertRaises(HTTPException) as caught:
            record_received_rd_input_invoice(payload(), db)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(db.commits, 0)

    @patch("app.api.rd_invoice_merge._effective_coverage_cents", return_value={})
    def test_rejects_invoice_seller_not_equal_to_partner(self, _coverage):
        db = FakeDb(bills())
        with self.assertRaises(HTTPException) as caught:
            record_received_rd_input_invoice(payload(seller_name="其他开票主体"), db)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(db.commits, 0)

    @patch("app.api.rd_invoice_merge._effective_coverage_cents", return_value={})
    def test_rejects_unconfirmed_or_zero_bill(self, _coverage):
        records = bills()
        records[0].status = "pending"
        with self.assertRaises(HTTPException):
            record_received_rd_input_invoice(payload(), FakeDb(records))
        records[0].status = "confirmed"
        records[1].settlement_amount = Decimal("0")
        with self.assertRaises(HTTPException):
            record_received_rd_input_invoice(payload(), FakeDb(records))

    @patch("app.api.rd_invoice_merge._effective_coverage_cents", return_value={"rd-july": 183923})
    def test_stops_if_any_bill_is_already_fully_invoiced(self, _coverage):
        db = FakeDb(bills())
        with self.assertRaises(HTTPException) as caught:
            record_received_rd_input_invoice(payload(), db)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(db.commits, 0)
        self.assertEqual(db.added, [])

    @patch("app.api.rd_invoice_merge._effective_coverage_cents", return_value={"rd-july": 50})
    def test_rechecks_remaining_amount_under_bill_row_lock(self, _coverage):
        db = FakeDb(bills())
        with self.assertRaises(HTTPException) as caught:
            record_received_rd_input_invoice(payload(), db)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(caught.exception.detail["error"], "invoice_amount_changed")
        self.assertEqual(db.commits, 0)

    def test_rejects_bad_official_invoice_identity_and_wrong_totals(self):
        with self.assertRaises(HTTPException):
            record_received_rd_input_invoice(payload(digital_invoice_no=None), FakeDb(bills()))
        with self.assertRaises(HTTPException):
            record_received_rd_input_invoice(payload(tax_amount=Decimal("0.09")), FakeDb(bills()))
        with self.assertRaises(HTTPException):
            record_received_rd_input_invoice(payload(bill_ids=["rd-july", "rd-july"]), FakeDb(bills()))
        with self.assertRaises(ValidationError):
            payload(seller_tax_no="")

    @patch("app.api.rd_invoice_merge._effective_coverage_cents", return_value={})
    def test_does_not_modify_state_when_bill_missing(self, _coverage):
        db = FakeDb(bills()[:1])
        with self.assertRaises(HTTPException) as caught:
            record_received_rd_input_invoice(payload(), db)
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(db.commits, 0)


if __name__ == "__main__":
    import unittest
    unittest.main()
