"""Regression tests: narrowly loaded profit ORM fields preserve accounting math."""

import unittest

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session

from app.core.base import Base
from app.models.channel import ChannelRecord, ChannelRecordLineItem
from app.models.reconciliation import ReconciliationRecord, ReconciliationLineItem
from app.models.server_cost import ServerCost
from app.models.operating_expense import OperatingExpense
from app.services.profit_analysis import build_profit_analysis
from app.services.project_profit_analysis import build_project_profit_analysis
from app.services.profit_record_loader import load_profit_records


class ProfitNarrowLoaderTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(self.engine, tables=[
            ReconciliationRecord.__table__, ReconciliationLineItem.__table__,
            ChannelRecord.__table__, ChannelRecordLineItem.__table__,
            ServerCost.__table__, OperatingExpense.__table__,
        ])
        self.db = Session(self.engine)
        self.db.add_all([
            ReconciliationRecord(
                id="rd-profit-1", statement_no="RD-PROFIT-TEST",
                settlement_month="2026-07", status="completed", game_name="A",
                settlement_amount=100, game_flow=1000,
                remark="A very long unused original RD note",
            ),
            ReconciliationLineItem(
                id="rd-line-profit-1", reconciliation_id="rd-profit-1",
                settlement_cycle="2026-06", game_name="A",
                settlement_amount=100, revenue=1000, sort_order=0,
            ),
            ChannelRecord(
                id="channel-profit-1", status="completed",
                settlement_month="2026-06", game_name="A",
                settlement_amount=500, billing_flow=1200, server_cost=20,
                settlement_adjustment_amount=0,
                remark="A very long unused channel note",
            ),
            ChannelRecordLineItem(
                id="channel-line-profit-1", channel_record_id="channel-profit-1",
                game_name="A", settlement_amount=500, billing_flow=1200,
            ),
            ServerCost(
                id="server-profit-1", expense_month="2026-06",
                game_name="A", amount=10, status="active", remark="unused cloud memo",
            ),
            OperatingExpense(
                id="expense-profit-1", expense_month="2026-06",
                category="marketing", expense_kind="other",
                amount=30, game_name=None,
                payment_status="paid", invoice_status="none",
                remark="an unused private vendor memo",
            ),
        ])
        self.db.commit()
        self.db.expunge_all()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_narrow_records_defer_unnecessary_long_notes(self):
        rd, channel, server, expenses = load_profit_records(self.db)
        self.assertEqual(len(rd), 1)
        self.assertEqual(len(channel), 1)
        self.assertEqual(len(server), 1)
        self.assertEqual(len(expenses), 1)
        for record in (rd[0], channel[0], server[0], expenses[0]):
            self.assertIn("remark", inspect(record).unloaded)
        self.assertEqual(len(rd[0].line_items), 1)
        self.assertEqual(len(channel[0].line_items), 1)

    def test_monthly_profit_preserves_multi_period_and_server_allocation(self):
        report = build_profit_analysis(self.db, requested_month="2026-06", trend_months=2)
        self.assertEqual(report["month"], "2026-06")
        self.assertEqual(report["channel_settlement"]["value"], 500)
        self.assertEqual(report["rd_cost"]["value"], 100)
        self.assertEqual(report["server_cost"]["value"], 30)
        self.assertEqual(report["operating_expense"]["value"], 30)
        self.assertEqual(report["operating_profit"]["value"], 340)
        self.assertEqual(report["rd_bill_count"], 1)

    def test_project_profit_shares_the_same_historical_loading_logic(self):
        report = build_project_profit_analysis(self.db, year="2026")
        self.assertEqual(report["summary"]["channel_settlement"], 500)
        self.assertEqual(report["summary"]["shared_expense"], 30)
        self.assertEqual(report["summary"]["project_count"], 1)
        self.assertEqual(report["projects"][0]["gross_profit"], 370)


if __name__ == "__main__":
    unittest.main()
