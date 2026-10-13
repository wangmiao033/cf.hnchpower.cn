"""Safety tests for merging previously issued tax invoices across channel bills."""
from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException

from app.api.channel_invoice_merge import (
    IssuedChannelInvoiceRequest,
    distribute_gross,
    prepare_issued_invoice,
    record_issued_merged_channel_invoice,
    to_cents,
)
from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.invoice import InvoiceRecord
from app.models.operation_log import OperationLog


def payload(**overrides):
    fields = dict(
        bill_ids=["july", "may-june"],
        buyer_name="上海合作方公司",
        buyer_tax_no="913100000000000000",
        seller_name="广州测试科技有限公司",
        seller_tax_no="914400000000000000",
        invoice_type="数电发票（增值税普通发票）",
        digital_invoice_no="12345678912345678901",
        invoice_date="2026-10-13",
        invoice_amount=Decimal("955.00"),
        tax_amount=Decimal("0.05"),
        amount_with_tax=Decimal("955.05"),
    )
    fields.update(overrides)
    return IssuedChannelInvoiceRequest(**fields)


def bills():
    return [
        SimpleNamespace(id="july", partner_name="上海合作方公司", channel_name="超萌（六方）方方",
                        status="confirmed", settlement_month="2026-07",
                        statement_no="B-2026-07", settlement_amount=Decimal("479.52")),
        SimpleNamespace(id="may-june", partner_name="上海合作方公司", channel_name="超萌（六方）方方",
                        status="confirmed", settlement_month="2026-05",
                        statement_no="B-2026-05", settlement_amount=Decimal("475.53")),
    ]


class QueryResult:
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

    def execute(self, statement):
        return QueryResult(self.rows)

    def add(self, row):
        self.added.append(row)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class ChannelInvoiceMergeTest(TestCase):
    def test_cents_and_cumulative_rounding(self):
        self.assertEqual(to_cents("479.52") + to_cents("475.53"), 95505)
        parts = distribute_gross([1, 1, 1, 1], 2, 2)
        self.assertEqual([sum(part) for part in parts], [1, 1, 1, 1])
        self.assertEqual(sum(part[0] for part in parts), 2)
        self.assertEqual(sum(part[1] for part in parts), 2)
        parts = distribute_gross([47952, 47553], 95500, 5)
        self.assertEqual(sum(part[0] for part in parts), 95500)
        self.assertEqual(sum(part[1] for part in parts), 5)

    def test_requires_unique_ids_and_real_invoice_identity(self):
        with self.assertRaises(HTTPException) as caught:
            prepare_issued_invoice(payload(bill_ids=["july", "july"]))
        self.assertEqual(caught.exception.status_code, 422)
        with self.assertRaises(HTTPException) as caught:
            prepare_issued_invoice(payload(digital_invoice_no=None))
        self.assertEqual(caught.exception.status_code, 422)

    def test_does_not_allow_wrong_net_tax_total_or_date(self):
        with self.assertRaises(HTTPException):
            prepare_issued_invoice(payload(tax_amount=Decimal("0.04")))
        with self.assertRaises(HTTPException):
            prepare_issued_invoice(payload(invoice_date="2026-15-99"))

    @patch("app.api.channel_invoice_merge._ensure_unique_identity")
    @patch("app.api.channel_invoice_merge._lock_invoice_identity")
    @patch("app.api.channel_invoice_merge._effective_coverage_cents", return_value={})
    def test_atomically_registers_real_invoice_and_links_both_bills(self, _coverage, _lock, _unique):
        records = bills()
        original = [(b.status, b.settlement_amount) for b in records]
        db = FakeDb(records)
        result = record_issued_merged_channel_invoice(payload(), db)
        invoices = [row for row in db.added if isinstance(row, InvoiceRecord)]
        links = [row for row in db.added if isinstance(row, BillInvoiceAllocation)]
        logs = [row for row in db.added if isinstance(row, OperationLog)]
        self.assertEqual(db.commits, 1)
        self.assertEqual(db.rollbacks, 0)
        self.assertEqual(result.allocated_amount, 955.05)
        self.assertEqual(result.allocated_bills, 2)
        self.assertEqual(len(invoices), 1)
        self.assertEqual(invoices[0].status, "已开")
        self.assertEqual(len(links), 2)
        self.assertEqual(len(logs), 2)
        self.assertEqual(sum(float(link.allocated_gross_amount) for link in links), 955.05)
        self.assertEqual(sum(float(link.allocated_net_amount) for link in links), 955.0)
        self.assertEqual(sum(float(link.allocated_tax_amount) for link in links), 0.05)
        self.assertEqual([(b.status, b.settlement_amount) for b in records], original)

    @patch("app.api.channel_invoice_merge._effective_coverage_cents", return_value={"july": 47952})
    def test_stops_if_any_bill_was_already_invoiced(self, _coverage):
        db = FakeDb(bills())
        with self.assertRaises(HTTPException) as caught:
            record_issued_merged_channel_invoice(payload(), db)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(db.commits, 0)
        self.assertEqual(db.added, [])

    @patch("app.api.channel_invoice_merge._effective_coverage_cents", return_value={})
    def test_stops_if_bills_have_different_legal_entities(self, _coverage):
        records = bills()
        records[1].partner_name = "另一个公司"
        db = FakeDb(records)
        with self.assertRaises(HTTPException) as caught:
            record_issued_merged_channel_invoice(payload(), db)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(db.commits, 0)

    @patch("app.api.channel_invoice_merge._effective_coverage_cents", return_value={})
    def test_stops_if_not_reconciled(self, _coverage):
        records = bills()
        records[0].status = "pending"
        db = FakeDb(records)
        with self.assertRaises(HTTPException) as caught:
            record_issued_merged_channel_invoice(payload(), db)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(db.commits, 0)


if __name__ == "__main__":
    import unittest
    unittest.main()
