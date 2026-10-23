import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.api.channel import create_channel_record, get_channel_record, update_channel_record, create_channel_receipt
from app.models.channel import ChannelRecord, ChannelRecordLineItem, ChannelReceipt
from app.schemas.channel import ChannelRecordCreate, ChannelRecordUpdate, ChannelReceiptCreate, ChannelLineItemCreate
from app.services.channel_233_incomplete import CODE, LEGAL_NAME, CHANNEL_NAME
from app.services.bill_lifecycle import _transition_guard
from app.services.channel_cumulative_invoice import assert_single_bill_invoice_allowed
from app.services.bank_auto_reconciliation import _channel_candidates, _load_specific_candidate
from app.services.bank_multi_allocation import _specific_bill


def line(amount=-5.34, **changes):
    return dict(game_name="合成游戏", settlement_cycle="2026-06", billing_flow=0,
                share_rate=0, tax_rate=0, platform_settlement_amount=amount,
                settlement_rule_code=CODE, **changes)


class Incomplete233Tests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        for model in (ChannelRecord, ChannelRecordLineItem, ChannelReceipt):
            model.__table__.create(self.engine)
        self.db = Session(self.engine)
        self.db.execute(text("CREATE TABLE cf_partner_records (id TEXT PRIMARY KEY, name TEXT, short_name TEXT)"))
        self.db.execute(text("INSERT INTO cf_partner_records VALUES ('synthetic-233', :name, :channel)"),
                        {"name": LEGAL_NAME, "channel": CHANNEL_NAME})
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def create(self, **changes):
        payload = dict(partner_name=LEGAL_NAME, channel_name=CHANNEL_NAME, settlement_month="2026-06",
                       settlement_rule_code=CODE, status="pending", remark="缺失资料待补；0仅系统占位。合成原单",
                       items=[line()])
        payload.update(changes)
        return create_channel_record(ChannelRecordCreate(**payload), self.db)

    def payload(self, saved):
        return {key: getattr(saved, key) for key in ChannelLineItemCreate.model_fields}

    def test_save_reopen_negative_and_zero_remain_unknown_pending_unpaid(self):
        for amount in [-5.34, 0, 120.02]:
            with self.subTest(amount=amount):
                saved = self.create(items=[line(amount)], settlement_month="2026-06")
                reopened = get_channel_record(saved.id, self.db)
                self.assertEqual(reopened.settlement_amount, amount)
                self.assertEqual(reopened.items[0].platform_settlement_amount, amount)
                self.assertEqual(reopened.validation_status, "incomplete")
                self.assertIsNone(reopened.settlement_difference)
                self.assertEqual((reopened.status, reopened.receipt_status, reopened.received_amount), ("pending", "unpaid", 0))
                self.db.delete(self.db.get(ChannelRecord, saved.id)); self.db.commit()

    def test_duplicate_submit_and_existing_legacy_month_rejected_without_mutating_original(self):
        saved = self.create()
        with self.assertRaises(HTTPException) as caught:
            self.create()
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.db.query(ChannelRecord).count(), 1)
        row = self.db.get(ChannelRecord, saved.id)
        row.settlement_rule_code = "share_only"; row.settlement_amount = 44.70; self.db.commit()
        with self.assertRaises(HTTPException): self.create()
        self.assertEqual(get_channel_record(saved.id, self.db).settlement_amount, 44.70)

    def test_saved_marker_survives_remark_only_and_recalculation(self):
        saved = self.create()
        updated = update_channel_record(saved.id, ChannelRecordUpdate(remark="补充原单来源", validation_tolerance=.01, items=None), self.db)
        self.assertEqual(updated.validation_status, "incomplete")
        items = [self.payload(updated.items[0])]
        items[0]["platform_settlement_amount"] = -6.25
        updated = update_channel_record(saved.id, ChannelRecordUpdate(items=items), self.db)
        self.assertEqual(updated.settlement_amount, -6.25)
        self.assertEqual(updated.receipt_status, "unpaid")

    def test_stale_clients_cannot_drop_marker_or_change_identity(self):
        saved = self.create()
        for changes in [dict(settlement_rule_code="share_only"), dict(channel_name="233"),
                        dict(items=[{**self.payload(saved.items[0]), "settlement_rule_code": None}])]:
            with self.subTest(changes=changes), self.assertRaises(HTTPException):
                update_channel_record(saved.id, ChannelRecordUpdate(**changes), self.db)
            self.db.rollback()
        self.assertEqual(get_channel_record(saved.id, self.db).validation_status, "incomplete")

    def test_explicit_completion_requires_full_data_and_source_then_ordinary_calculation(self):
        saved = self.create(items=[line(47.5)])
        items = [{**self.payload(saved.items[0]), "billing_flow": 100, "share_rate": 50, "tax_rate": 0,
                  "settlement_rule_code": "five_percent_gateway_share", "channel_fee_mode": "percent", "channel_fee_rate": 5, "tax_mode": "none"}]
        conversion = dict(complete_incomplete_draft=True, settlement_rule_code="five_percent_gateway_share",
                          channel_fee_mode="percent", channel_fee_rate=5, tax_mode="none", items=items)
        with self.assertRaises(HTTPException): update_channel_record(saved.id, ChannelRecordUpdate(**conversion), self.db)
        self.db.rollback()
        partial = {**items[0]}; partial.pop("billing_flow")
        with self.assertRaises(HTTPException):
            update_channel_record(saved.id, ChannelRecordUpdate(**{**conversion, "items": [partial], "audit_reason": "真实明细已补"}), self.db)
        self.db.rollback()
        updated = update_channel_record(saved.id, ChannelRecordUpdate(**conversion, audit_reason="真实明细已补"), self.db)
        self.assertEqual(updated.system_settlement_amount, 47.5)
        self.assertEqual(updated.validation_status, "pass")
        self.assertEqual(updated.status, "pending")
        self.assertIsNone(_transition_guard(self.db, "channel", self.db.get(ChannelRecord, saved.id), "pending", "confirmed", SimpleNamespace(role="admin")))

    def test_incomplete_blocks_confirmation_lock_invoice_receipt_and_bank_allocation(self):
        saved = self.create(items=[line(120.02)])
        row = self.db.get(ChannelRecord, saved.id)
        for target in ["confirmed", "invoiced", "completed", "reconciled"]:
            self.assertIn("资料未齐", _transition_guard(self.db, "channel", row, "pending", target, SimpleNamespace(role="admin")))
        for call in [lambda: create_channel_receipt(saved.id, ChannelReceiptCreate(amount=1), self.db),
                     lambda: assert_single_bill_invoice_allowed(self.db, row),
                     lambda: _load_specific_candidate(self.db, None, "collection", 1, "channel", saved.id),
                     lambda: _specific_bill(self.db, "collection", "channel", saved.id),
                     lambda: update_channel_record(saved.id, ChannelRecordUpdate(status="confirmed"), self.db)]:
            with self.assertRaises(HTTPException): call()
        from app.services.channel_cumulative_policy import deferred_bill_ids
        self.assertEqual(deferred_bill_ids(self.db, [row]), set())
        self.assertEqual(_channel_candidates(self.db), [])
        self.assertEqual(self.db.query(ChannelReceipt).count(), 0)

    def test_exact_scope_missing_platform_month_contract_and_status_guards(self):
        cases = [dict(channel_name="233"), dict(channel_name="龙威233广告"), dict(partner_name="其他公司"),
                 dict(status="confirmed"), dict(remark=""), dict(items=[line(None)]),
                 dict(items=[{**line(), "share_rate": 100}]), dict(items=[line(contract_access_item_id="fake")]),
                 dict(items=[{**line(), "settlement_cycle": "2026-05"}])]
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(HTTPException): self.create(**changes)
            self.db.rollback()
        self.assertEqual(self.db.query(ChannelRecord).count(), 0)

    def test_actual_receipt_blocks_opt_in_even_if_denormalized_rollup_is_stale(self):
        saved = self.create()
        self.db.add(ChannelReceipt(id="synthetic-receipt", channel_record_id=saved.id, amount=1))
        self.db.commit()
        with self.assertRaises(HTTPException):
            update_channel_record(saved.id, ChannelRecordUpdate(remark="不能掩盖已有收款"), self.db)
        self.assertEqual(self.db.query(ChannelReceipt).count(), 1)

    def test_adjustment_is_documented_once_without_inventing_validation(self):
        saved = self.create(items=[line(120.02)], settlement_adjustment_amount=-.01, settlement_adjustment_reason="合成原单月内舍入差")
        self.assertEqual(saved.platform_settlement_amount, 120.02)
        self.assertEqual(saved.settlement_amount, 120.01)
        self.assertEqual(saved.validation_status, "incomplete")

    def test_other_channels_and_non_opted_233_keep_previous_formula(self):
        for partner, channel in [("合成其他公司", "大熊"), (LEGAL_NAME, CHANNEL_NAME)]:
            saved = self.create(partner_name=partner, channel_name=channel, settlement_rule_code="share_only",
                                items=[{**line(50), "billing_flow": 100, "share_rate": 50, "settlement_rule_code": "share_only"}])
            self.assertEqual(saved.system_settlement_amount, 50)
            self.assertEqual(saved.validation_status, "pass")


if __name__ == '__main__': unittest.main()
