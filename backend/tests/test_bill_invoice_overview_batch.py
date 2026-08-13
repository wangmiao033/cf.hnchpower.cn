import unittest

from app.api.bill360_performance import BillInvoiceOverviewRequest, bill_invoice_overviews


class NoQueryDb:
    def __init__(self):
        self.execute_count = 0

    def execute(self, _statement):
        self.execute_count += 1
        raise AssertionError("empty request should not query database")


class BillInvoiceOverviewBatchTest(unittest.TestCase):
    def test_empty_request_does_not_query_database(self):
        db = NoQueryDb()
        result = bill_invoice_overviews(BillInvoiceOverviewRequest(keys=[]), db)
        self.assertEqual(result, {"items": []})
        self.assertEqual(db.execute_count, 0)


if __name__ == "__main__":
    unittest.main()
