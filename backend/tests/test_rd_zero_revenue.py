"""Synthetic SQLite regression: no production database or financial records."""
import unittest
from unittest.mock import patch

from pydantic import ValidationError
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.api.reconciliation import (
    create_reconciliation, update_reconciliation, get_reconciliation,
    _line_reads, _resolve_record_settlement_month, _resolve_row_display_settlement_month,
)
from app.api.reconciliation_period import list_reconciliation_periods
from app.models.reconciliation import ReconciliationRecord, ReconciliationLineItem
from app.schemas.reconciliation import ReconciliationCreate, ReconciliationUpdate, ReconciliationLineItemIn
from app.services.rd_reconciliation_line import compute_rd_line_amounts


class RdZeroRevenueTest(unittest.TestCase):
    def test_schema_requires_explicit_finite_nonnegative_revenue(self):
        for value in (None, '', ' ', -1, 'junk', '12junk', float('inf'), float('nan'), True):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                ReconciliationLineItemIn(game_name='合成游戏', revenue=value)
        with self.assertRaises(ValidationError):
            ReconciliationLineItemIn(game_name='合成游戏')
        for value in (0, '0', '0.00', 100):
            self.assertEqual(ReconciliationLineItemIn(revenue=value).revenue, float(value))

    def test_mixed_details_survive_create_update_reload_and_period_list_without_duplicates(self):
        engine = create_engine('sqlite+pysqlite:///:memory:')
        ReconciliationRecord.__table__.create(engine)
        ReconciliationLineItem.__table__.create(engine)
        items = [ReconciliationLineItemIn(game_name=f'合成游戏{i}', revenue=value,
                 share_ratio=100, settlement_cycle='2026年9月', sort_order=i)
                 for i, value in enumerate((100, 200, 934.56, 0, 0))]

        def read(_db, row):
            return {'id': row.id, 'status': row.status, 'amount': row.settlement_amount,
                    'items': _line_reads(row), 'game': row.game_name}

        try:
            with Session(engine) as db, patch('app.api.reconciliation.save_partner_link'), patch('app.api.reconciliation._enrich_reconciliation_read', side_effect=read):
                created = create_reconciliation(ReconciliationCreate(statement_no='SYNTHETIC-ZERO', partner_name='合成研发', items=items), db)
                for _ in range(3):
                    result = update_reconciliation(created['id'], ReconciliationUpdate(items=items, status='pending'), db)
                    self.assertEqual(float(result['amount']), 1234.56)
                    self.assertEqual(result['status'], 'pending')
                    self.assertEqual([item.revenue for item in result['items']], [100, 200, 934.56, 0, 0])
                db.expire_all()
                result = get_reconciliation(created['id'], db)
                self.assertIn('合成游戏3、合成游戏4', result['game'])
                self.assertEqual(db.scalar(select(func.count(ReconciliationRecord.id))), 1)
                self.assertEqual(db.scalar(select(func.count(ReconciliationLineItem.id))), 5)
                period_list = list_reconciliation_periods(ids=created['id'], db=db)
                self.assertEqual(period_list['items'][0]['periods'], ['2026年9月'])
                self.assertEqual([item['revenue'] for item in period_list['items'][0]['items']], [100, 200, 934.56, 0, 0])
                # A zero-only month overrides a stale header just like a positive month.
                zeros = [item.model_copy(update={'revenue': 0}) for item in items]
                self.assertEqual(_resolve_record_settlement_month('2026年8月', zeros), '2026年9月')
                update_reconciliation(created['id'], ReconciliationUpdate(items=zeros), db)
                row = db.get(ReconciliationRecord, created['id'])
                row.settlement_month = '2026年8月'
                self.assertEqual(_resolve_row_display_settlement_month(row), '2026年9月')
                self.assertEqual(row.settlement_amount, 0)
                self.assertEqual(row.status, 'pending')
        finally:
            engine.dispose()

    def test_existing_discount_fees_share_and_tax_formula_is_unchanged(self):
        self.assertEqual(compute_rd_line_amounts(10000, .1, 10, 20, 30, 5, 20, 6), (1000, 839.42, 167.88))
        self.assertEqual(compute_rd_line_amounts(0, .1, 0, 0, 0, 5, 20, 6), (0, 0, 0))


if __name__ == '__main__':
    unittest.main()
