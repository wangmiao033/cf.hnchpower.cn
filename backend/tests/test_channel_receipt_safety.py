from __future__ import annotations

import asyncio
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.channel import create_channel_receipt, delete_channel_receipt
from app.models.bank_reconciliation_match import BankReconciliationMatch
from app.models.channel import ChannelReceipt, ChannelRecord, ChannelRecordLineItem
from app.schemas.channel import ChannelReceiptCreate


class ChannelReceiptSafetyTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        ChannelRecord.__table__.create(self.engine)
        ChannelRecordLineItem.__table__.create(self.engine)
        ChannelReceipt.__table__.create(self.engine)
        BankReconciliationMatch.__table__.create(self.engine)
        self.db = Session(self.engine)
        self.bill = ChannelRecord(
            id="bill-1",
            statement_no="QD-TEST-001",
            channel_name="测试渠道",
            partner_name="测试合作方",
            settlement_amount=100,
            received_amount=0,
            receipt_status="unpaid",
            billing_flow=0,
            voucher_cost=0,
            no_worry_cost=0,
            refund_cost=0,
            test_cost=0,
            welfare_cost=0,
            coin_cost=0,
            share_rate=0,
            billing_amount=0,
            share_amount=0,
            tax_rate=0,
            gateway_cost=0,
            settlement_rule_code="legacy_fixed_fee_tax",
            channel_fee_mode="fixed",
            tax_mode="share",
            validation_tolerance=0.05,
            system_settlement_amount=100,
            validation_status="passed",
        )
        self.db.add(self.bill)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_manual_receipt_cannot_exceed_outstanding_amount(self):
        self.db.add(ChannelReceipt(
            id="receipt-80",
            channel_record_id="bill-1",
            amount=80,
            receipt_date="2026-08-18",
        ))
        self.db.commit()

        with patch("app.api.channel.assert_single_bill_collection_allowed"), patch("app.api.channel.refresh_batches_for_bill"):
            with self.assertRaises(HTTPException) as ctx:
                create_channel_receipt(
                    "bill-1",
                    ChannelReceiptCreate(amount=30, receipt_date="2026-08-18"),
                    self.db,
                )
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail["error"], "channel_receipt_overpay")
        count = self.db.query(ChannelReceipt).filter(ChannelReceipt.channel_record_id == "bill-1").count()
        self.assertEqual(count, 1)

    def test_manual_receipt_can_close_exact_remaining_balance(self):
        self.db.add(ChannelReceipt(
            id="receipt-80",
            channel_record_id="bill-1",
            amount=80,
            receipt_date="2026-08-18",
        ))
        self.db.commit()

        with patch("app.api.channel.assert_single_bill_collection_allowed"), patch("app.api.channel.refresh_batches_for_bill"):
            result = create_channel_receipt(
                "bill-1",
                ChannelReceiptCreate(amount=20, receipt_date="2026-08-18"),
                self.db,
            )
        self.assertAlmostEqual(float(result.received_amount), 100.0, places=2)
        self.assertEqual(result.receipt_status, "paid")

    def test_bank_generated_receipt_must_be_reversed_from_bank_allocation(self):
        self.db.add(ChannelReceipt(
            id="receipt-bank",
            channel_record_id="bill-1",
            amount=50,
            receipt_date="2026-08-18",
        ))
        self.db.add(BankReconciliationMatch(
            id="match-1",
            bank_transaction_id="tx-1",
            direction="collection",
            bill_type="channel",
            bill_id="bill-1",
            bill_number="QD-TEST-001",
            linked_amount=50,
            confidence_score=100,
            confidence_level="high",
            generated_receipt_id="receipt-bank",
            status="confirmed",
            original_transaction_type="statement_import",
            confirmed_at=datetime.now(timezone.utc),
        ))
        self.db.commit()

        with patch("app.api.channel.refresh_batches_for_bill"):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(delete_channel_receipt("bill-1", "receipt-bank", self.db))
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail["error"], "bank_generated_receipt_locked")
        self.assertIsNotNone(self.db.get(ChannelReceipt, "receipt-bank"))


if __name__ == "__main__":
    unittest.main()
