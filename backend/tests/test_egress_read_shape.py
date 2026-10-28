"""Wide text and line-item columns stay out of dashboard and bank list reads."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.api.bank_transaction import list_bank_transactions
from app.core.base import Base
from app.models.bank_transaction import BankTransaction
from app.models.channel import ChannelReceipt, ChannelRecord, ChannelRecordLineItem
from app.models.reconciliation import ReconciliationLineItem, ReconciliationRecord
from app.services.monthly_business_dashboard import build_monthly_business_dashboard


class EgressReadShapeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(self.engine, tables=[
            ReconciliationRecord.__table__,
            ReconciliationLineItem.__table__,
            ChannelRecord.__table__,
            ChannelRecordLineItem.__table__,
            ChannelReceipt.__table__,
            BankTransaction.__table__,
        ])
        self.db = Session(self.engine)
        now = datetime.now(timezone.utc)
        self.db.add_all([
            ReconciliationRecord(
                id="rd-egress-1",
                statement_no="RD-EGRESS",
                settlement_month="2026-06",
                status="pending",
                game_name="A",
                settlement_amount=100,
                game_flow=1000,
                remark="A" * 4000,
                created_at=now,
                updated_at=now,
            ),
            ReconciliationLineItem(
                id="rd-line-egress-1",
                reconciliation_id="rd-egress-1",
                settlement_cycle="2026-06",
                game_name="A",
                settlement_amount=100,
                revenue=1000,
                sort_order=0,
                created_at=now,
            ),
            ChannelRecord(
                id="channel-egress-1",
                status="pending",
                settlement_month="2026-06",
                game_name="A",
                settlement_amount=500,
                billing_flow=1200,
                server_cost=20,
                received_amount=0,
                remark="B" * 4000,
                created_at=now,
                updated_at=now,
            ),
            ChannelRecordLineItem(
                id="channel-line-egress-1",
                channel_record_id="channel-egress-1",
                game_name="A",
                settlement_cycle="2026-06",
                settlement_amount=500,
                billing_flow=1200,
            ),
            BankTransaction(
                id="bank-egress-1",
                type="statement_import",
                trade_date="2026-06-02",
                payer_name="某合作方",
                amount=88,
                income_amount=88,
                raw_text="原文标记" + ("X" * 8000),
                created_at=now,
                updated_at=now,
            ),
        ])
        self.db.commit()
        self.db.expunge_all()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_dashboard_keeps_amounts_without_loading_remarks(self):
        statements = self._capture_sql()
        report = build_monthly_business_dashboard(self.db, requested_month="2026-06", trend_months=1)
        self.assertEqual(report["channel_settlement"]["value"], 500)
        self.assertEqual(report["rd_settlement"]["value"], 100)
        self.assertEqual(report["server_cost"]["value"], 20)
        self.assertEqual(report["games"][0]["channel_flow"], 1200)
        self.assertEqual(report["games"][0]["rd_flow"], 1000)
        header_sql = [
            sql for sql in statements
            if "FROM reconciliation_records" in sql or "FROM channel_records" in sql
        ]
        self.assertTrue(header_sql)
        for sql in header_sql:
            self.assertNotIn("remark", sql)

    def test_bank_list_omits_raw_text_even_when_search_matches_it(self):
        statements = self._capture_sql()
        result = list_bank_transactions(
            self.db,
            q="原文标记",
            transaction_type=None,
            date_from=None,
            date_to=None,
            amount_min=None,
            amount_max=None,
            bank_account=None,
            source_bank=None,
            source_file_name=None,
            import_batch_id=None,
            include_raw_text=False,
            limit=50,
            offset=0,
        )
        self.assertEqual(result.total, 1)
        self.assertIsNone(result.items[0].raw_text)
        self.assertEqual(result.items[0].payer_name, "某合作方")
        self.assertTrue(statements)
        for sql in statements:
            selected, _, _where = sql.partition(" WHERE ")
            self.assertNotIn("raw_text", selected)

    def _capture_sql(self) -> list[str]:
        statements: list[str] = []

        def record(_conn, _cursor, statement, _parameters, _context, _executemany):
            statements.append(" ".join(statement.split()))

        event.listen(self.engine, "before_cursor_execute", record)
        self.addCleanup(lambda: event.remove(self.engine, "before_cursor_execute", record))
        return statements


if __name__ == "__main__":
    unittest.main()
