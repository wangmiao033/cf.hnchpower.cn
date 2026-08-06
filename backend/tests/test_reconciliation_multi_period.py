from __future__ import annotations

import unittest

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.api.reconciliation import _replace_line_items
from app.api.reconciliation_period import (
    format_settlement_period_label,
    record_periods,
)
from app.models.reconciliation import ReconciliationLineItem, ReconciliationRecord
from app.schemas.reconciliation import ReconciliationLineItemIn


class ReconciliationMultiPeriodTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        ReconciliationRecord.__table__.create(self.engine)
        ReconciliationLineItem.__table__.create(self.engine)

    def tearDown(self) -> None:
        self.engine.dispose()

    @staticmethod
    def _master(record_id: str = "bill-1") -> ReconciliationRecord:
        return ReconciliationRecord(
            id=record_id,
            statement_no="JS-20260806-001",
            settlement_month="2026年5月",
            partner_name="海南奇趣网络科技有限公司",
            game_name="魔法启示录",
            game_flow=0,
            test_cost=0,
            voucher_cost=0,
            channel_fee_rate=0,
            tax_rate=0,
            revenue_share_rate=100,
            discount_value=1,
            refund_amount=0,
            settlement_amount=0,
            status="pending",
            remark=None,
        )

    @staticmethod
    def _lines(second_period: str = "2026年6月") -> list[ReconciliationLineItemIn]:
        return [
            ReconciliationLineItemIn(
                settlement_cycle="2026年5月",
                game_name="魔法启示录",
                revenue=280,
                discount_rate=1,
                coupon_amount=0,
                test_fee=0,
                extra_fee=0,
                share_ratio=100,
                tax_rate=0,
                sort_order=0,
            ),
            ReconciliationLineItemIn(
                settlement_cycle=second_period,
                game_name="魔法启示录",
                revenue=170,
                discount_rate=1,
                coupon_amount=0,
                test_fee=0,
                extra_fee=0,
                share_ratio=100,
                tax_rate=0,
                sort_order=1,
            ),
        ]

    def test_one_master_two_independent_period_lines_and_450_total(self) -> None:
        with Session(self.engine) as db:
            master = self._master()
            db.add(master)
            db.flush()
            _replace_line_items(db, master, self._lines())
            db.commit()

            master_count = db.scalar(select(func.count(ReconciliationRecord.id)))
            line_count = db.scalar(select(func.count(ReconciliationLineItem.id)))
            stored_master = db.get(ReconciliationRecord, "bill-1")
            stored_lines = db.scalars(
                select(ReconciliationLineItem).order_by(ReconciliationLineItem.sort_order)
            ).all()

            self.assertEqual(master_count, 1)
            self.assertEqual(line_count, 2)
            self.assertEqual(
                [line.settlement_cycle for line in stored_lines],
                ["2026年5月", "2026年6月"],
            )
            self.assertTrue(all(line.reconciliation_id == "bill-1" for line in stored_lines))
            self.assertEqual(float(stored_master.game_flow), 450.0)
            self.assertEqual(float(stored_master.settlement_amount), 450.0)
            self.assertEqual(record_periods(stored_master), ["2026年5月", "2026年6月"])
            self.assertEqual(
                format_settlement_period_label(record_periods(stored_master)),
                "2026年5月—2026年6月",
            )

    def test_editing_one_line_period_does_not_change_the_other(self) -> None:
        with Session(self.engine) as db:
            master = self._master()
            db.add(master)
            db.flush()
            _replace_line_items(db, master, self._lines())
            db.commit()

            _replace_line_items(db, master, self._lines(second_period="2026年7月"))
            db.commit()

            stored_lines = db.scalars(
                select(ReconciliationLineItem).order_by(ReconciliationLineItem.sort_order)
            ).all()
            self.assertEqual(
                [line.settlement_cycle for line in stored_lines],
                ["2026年5月", "2026年7月"],
            )
            self.assertEqual(
                format_settlement_period_label(record_periods(master)),
                "2026年5月、2026年7月",
            )
            self.assertEqual(float(master.settlement_amount), 450.0)

    def test_legacy_single_period_bill_remains_supported(self) -> None:
        with Session(self.engine) as db:
            master = self._master(record_id="legacy-bill")
            master.statement_no = "JS-LEGACY-001"
            db.add(master)
            db.flush()
            _replace_line_items(db, master, [self._lines()[0]])
            db.commit()

            self.assertEqual(record_periods(master), ["2026年5月"])
            self.assertEqual(format_settlement_period_label(record_periods(master)), "2026年5月")
            self.assertEqual(float(master.settlement_amount), 280.0)


if __name__ == "__main__":
    unittest.main()
