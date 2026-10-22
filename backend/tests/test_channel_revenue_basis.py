"""Only explicitly opted-in Aiqu lines accept already-discounted money."""
from __future__ import annotations

import unittest
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.api.channel import create_channel_record, get_channel_record, update_channel_record
from app.models.bank_reconciliation_match import BankReconciliationMatch
from app.models.channel import ChannelReceipt, ChannelRecord, ChannelRecordLineItem
from app.schemas.channel import ChannelLineItemCreate, ChannelRecordCreate, ChannelRecordUpdate
from app.services.channel_revenue_basis import AIQU_CHANNEL_NAME, AIQU_PARTNER_NAME
from app.services.channel_settlement_engine import calculate_channel_line, voucher_cost_for_storage


class ChannelRevenueBasisCalculationTests(unittest.TestCase):
    def rule(self):
        return SimpleNamespace(
            channel_name=AIQU_CHANNEL_NAME, partner_name=AIQU_PARTNER_NAME,
            settlement_rule_code="five_percent_gateway_share", channel_fee_mode="percent",
            channel_fee_rate=5, tax_mode="none", validation_tolerance=.05,
        )

    def line(self, **changes):
        values = dict(billing_flow=371.56, discount_factor=.005, share_rate=30,
                      voucher_face_value=None, voucher_direct_cost=None, voucher_cost=0,
                      no_worry_cost=0, refund_cost=0, test_cost=0, welfare_cost=0,
                      coin_cost=0, gateway_cost=0, tax_rate=0, revenue_basis="post_discount")
        values.update(changes)
        return SimpleNamespace(**values)

    def test_pre_and_post_same_money_without_changing_game_discount(self):
        pre = self.line(billing_flow=74312, revenue_basis="pre_discount", voucher_direct_cost=3.24)
        post = self.line(voucher_direct_cost=3.24)
        self.assertEqual(calculate_channel_line(pre, self.rule()), calculate_channel_line(post, self.rule()))
        self.assertEqual(calculate_channel_line(post, self.rule())["system_settlement_amount"], Decimal("104.97"))
        self.assertEqual(post.discount_factor, .005)

    def test_post_discount_face_is_still_face_and_direct_is_still_yuan(self):
        row = self.line(voucher_face_value=648, voucher_direct_cost=10)
        self.assertEqual(voucher_cost_for_storage(row, self.rule()), Decimal("13.24"))
        self.assertEqual(calculate_channel_line(row, self.rule())["billing_amount"], Decimal("358.32"))
        self.assertEqual(calculate_channel_line(row, self.rule())["system_settlement_amount"], Decimal("102.12"))

    def test_legacy_voucher_is_never_reinterpreted(self):
        row = self.line(voucher_cost=3.24)
        self.assertEqual(voucher_cost_for_storage(row, self.rule()), Decimal("3.24"))
        self.assertEqual(calculate_channel_line(row, self.rule())["system_settlement_amount"], Decimal("104.97"))

    def test_missing_basis_keeps_original_pre_discount_behavior(self):
        row = self.line(billing_flow=74312)
        del row.revenue_basis
        self.assertEqual(calculate_channel_line(row, self.rule())["billing_amount"], Decimal("371.56"))

    def test_post_discount_reversal_is_not_discounted(self):
        row = self.line(billing_flow=-3.24)
        self.assertEqual(calculate_channel_line(row, self.rule())["billing_amount"], Decimal("-3.24"))

    def test_schema_defaults_and_unknown_basis(self):
        self.assertEqual(ChannelLineItemCreate().revenue_basis, "pre_discount")
        for basis in ("actual_paid", "", None, "POST_DISCOUNT"):
            with self.subTest(basis=basis), self.assertRaises(ValidationError):
                ChannelLineItemCreate(revenue_basis=basis)


class ChannelRevenueBasisApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        for model in (ChannelRecord, ChannelRecordLineItem, ChannelReceipt):
            model.__table__.create(self.engine)
        self.db = Session(self.engine)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def create(self, *, basis="pre_discount", channel=AIQU_CHANNEL_NAME,
               partner=AIQU_PARTNER_NAME, **line_changes):
        line = dict(game_name="一起来修仙（0.05折）", billing_flow=371.56,
                    discount_factor=.005, revenue_basis=basis, share_rate=30,
                    settlement_rule_code="five_percent_gateway_share",
                    channel_fee_mode="percent", channel_fee_rate=5, tax_mode="none",
                    voucher_face_value=648, voucher_direct_cost=0)
        line.update(line_changes)
        return create_channel_record(ChannelRecordCreate(
            channel_name=channel, partner_name=partner, settlement_month="2026-08",
            settlement_rule_code="five_percent_gateway_share", channel_fee_mode="percent",
            channel_fee_rate=5, tax_mode="none", items=[ChannelLineItemCreate(**line)],
        ), self.db)

    def saved_line(self, result, **changes):
        values = {key: getattr(result.items[0], key) for key in ChannelLineItemCreate.model_fields}
        values.update(changes)
        return ChannelLineItemCreate(**values)

    def test_exact_channel_and_entity_both_required_before_any_mutation(self):
        for channel, partner in (
            ("爱趣", ""), ("爱趣", "另一网络科技有限公司"),
            ("爱趣联运", AIQU_PARTNER_NAME), ("其他爱趣", AIQU_PARTNER_NAME),
            ("爱趣(爱趣聚合)", AIQU_PARTNER_NAME),
            ("4399", AIQU_PARTNER_NAME), ("", AIQU_PARTNER_NAME),
        ):
            with self.subTest(channel=channel, partner=partner), self.assertRaises(HTTPException) as raised:
                self.create(basis="post_discount", channel=channel, partner=partner)
            self.assertEqual(raised.exception.detail["error"], "channel_revenue_basis_not_allowed")
            self.db.commit()
            self.assertEqual(self.db.query(ChannelRecord).count(), 0)

    def test_verified_decorated_channel_name_is_allowed_without_fuzzy_matching(self):
        result = self.create(basis="post_discount", channel="爱趣（爱趣聚合）")
        self.assertEqual(result.items[0].revenue_basis, "post_discount")
        self.assertEqual(result.system_settlement_amount, 104.97)

    def test_other_channel_pre_discount_is_unchanged(self):
        result = self.create(channel="4399", partner="其他客户", billing_flow=74312)
        self.assertEqual(result.items[0].revenue_basis, "pre_discount")
        self.assertEqual(result.billing_flow, 371.56)
        self.assertEqual(result.system_settlement_amount, 104.97)

    def test_post_discount_totals_read_and_repeat_save_are_idempotent(self):
        original = self.create(basis="post_discount")
        self.assertEqual(original.billing_flow, 371.56)
        self.assertEqual(original.system_settlement_amount, 104.97)
        self.assertEqual(original.voucher_cost, 3.24)
        for _ in range(3):
            original = update_channel_record(original.id, ChannelRecordUpdate(
                items=[self.saved_line(original)],
            ), self.db)
        reopened = get_channel_record(original.id, self.db)
        self.assertEqual(reopened.items[0].id, original.items[0].id)
        self.assertEqual(reopened.items[0].discount_factor, .005)
        self.assertEqual(reopened.items[0].voucher_face_value, 648)
        self.assertEqual(reopened.items[0].voucher_direct_cost, 0)
        self.assertEqual(reopened.items[0].revenue_basis, "post_discount")
        self.assertEqual(reopened.system_settlement_amount, 104.97)

    def test_old_client_with_stable_id_cannot_reset_saved_basis(self):
        original = self.create(basis="post_discount")
        data = self.saved_line(original).model_dump(exclude={"revenue_basis"})
        result = update_channel_record(original.id, ChannelRecordUpdate(
            items=[ChannelLineItemCreate(**data)],
        ), self.db)
        self.assertEqual(result.items[0].id, original.items[0].id)
        self.assertEqual(result.items[0].revenue_basis, "post_discount")
        self.assertEqual(result.system_settlement_amount, 104.97)

    def test_ambiguous_old_client_without_id_is_blocked_not_guessed(self):
        original = self.create(basis="post_discount")
        data = self.saved_line(original).model_dump(exclude={"revenue_basis", "id"})
        with self.assertRaises(HTTPException) as raised:
            update_channel_record(original.id, ChannelRecordUpdate(items=[ChannelLineItemCreate(**data)]), self.db)
        self.assertEqual(raised.exception.detail["error"], "channel_revenue_basis_identity_required")
        self.db.commit()
        self.assertEqual(get_channel_record(original.id, self.db).items[0].id, original.items[0].id)

    def test_explicit_pending_switch_preserves_face_direct_and_discount_identity(self):
        original = self.create(billing_flow=74312, voucher_direct_cost=10)
        result = update_channel_record(original.id, ChannelRecordUpdate(items=[self.saved_line(
            original, billing_flow=371.56, revenue_basis="post_discount",
        )]), self.db)
        self.assertEqual(result.items[0].discount_factor, .005)
        self.assertEqual(result.items[0].voucher_face_value, 648)
        self.assertEqual(result.items[0].voucher_direct_cost, 10)
        self.assertEqual(result.items[0].voucher_cost, 13.24)
        self.assertEqual(result.system_settlement_amount, original.system_settlement_amount)

    def test_header_only_identity_change_cannot_retain_post_discount(self):
        original = self.create(basis="post_discount")
        for changes in ({"channel_name": "4399"}, {"partner_name": "其他公司"}):
            with self.subTest(changes=changes), self.assertRaises(HTTPException) as raised:
                update_channel_record(original.id, ChannelRecordUpdate(**changes), self.db)
            self.assertEqual(raised.exception.detail["error"], "channel_revenue_basis_not_allowed")
            self.db.commit()
        self.assertEqual(get_channel_record(original.id, self.db).channel_name, AIQU_CHANNEL_NAME)

    def test_other_channel_rules_are_rejected_for_post_discount(self):
        for code in ("anjiu_pre_discount_deduction", "xian_weizhen_9917", "honor_upfront_percent_fee"):
            with self.subTest(code=code), self.assertRaises(HTTPException) as raised:
                self.create(basis="post_discount", settlement_rule_code=code)
            self.assertEqual(raised.exception.detail["error"], "channel_revenue_basis_rule_conflict")
            self.db.commit()
        self.assertEqual(self.db.query(ChannelRecord).count(), 0)

    def test_confirmed_line_cannot_switch_and_read_does_not_recalculate(self):
        original = self.create(billing_flow=74312)
        self.db.execute(text("UPDATE channel_records SET status='confirmed' WHERE id=:id"), {"id": original.id})
        self.db.commit()
        with self.assertRaises(HTTPException) as raised:
            update_channel_record(original.id, ChannelRecordUpdate(items=[self.saved_line(
                original, revenue_basis="post_discount",
            )]), self.db)
        self.assertEqual(raised.exception.detail["error"], "bill_locked")
        reopened = get_channel_record(original.id, self.db)
        self.assertEqual(reopened.items[0].revenue_basis, "pre_discount")
        self.assertEqual(reopened.items[0].id, original.items[0].id)
        self.assertEqual(reopened.settlement_amount, original.settlement_amount)

    def test_confirmed_post_discount_old_full_form_remark_still_allowed(self):
        original = self.create(basis="post_discount")
        self.db.execute(text("UPDATE channel_records SET status='confirmed' WHERE id=:id"), {"id": original.id})
        self.db.commit()
        old_line = self.saved_line(original).model_dump(exclude={"revenue_basis"})
        result = update_channel_record(original.id, ChannelRecordUpdate(
            remark="仅补充备注", status="confirmed", items=[ChannelLineItemCreate(**old_line)],
        ), self.db)
        self.assertEqual(result.remark, "仅补充备注")
        self.assertEqual(result.items[0].id, original.items[0].id)
        self.assertEqual(result.items[0].revenue_basis, "post_discount")

    def test_collected_pending_bill_basis_change_does_not_touch_receipt(self):
        original = self.create(billing_flow=74312)
        self.db.add(ChannelReceipt(id="receipt", channel_record_id=original.id, amount=10))
        self.db.commit()
        with self.assertRaises(HTTPException) as raised:
            update_channel_record(original.id, ChannelRecordUpdate(items=[self.saved_line(
                original, revenue_basis="post_discount",
            )]), self.db)
        self.assertEqual(raised.exception.detail["error"], "channel_revenue_basis_received_locked")
        self.db.commit()
        self.assertEqual(float(self.db.get(ChannelReceipt, "receipt").amount), 10)
        self.assertEqual(get_channel_record(original.id, self.db).items[0].revenue_basis, "pre_discount")

    def test_zero_total_paid_display_without_receipts_does_not_lock_correction(self):
        original = self.create(billing_flow=0, voucher_face_value=0)
        self.assertEqual(original.receipt_status, "paid")
        result = update_channel_record(original.id, ChannelRecordUpdate(items=[self.saved_line(
            original, billing_flow=371.56, revenue_basis="post_discount",
        )]), self.db)
        self.assertEqual(result.items[0].revenue_basis, "post_discount")
        self.assertEqual(result.receipt_status, "unpaid")

    def test_active_bank_evidence_blocks_basis_switch_even_with_missing_receipt_rollup(self):
        BankReconciliationMatch.__table__.create(self.engine)
        original = self.create(billing_flow=74312)
        self.db.add(BankReconciliationMatch(
            id="match", bank_transaction_id="transaction", bill_type="channel",
            bill_id=original.id, direction="collection", linked_amount=10, status="confirmed",
        ))
        self.db.commit()
        with self.assertRaises(HTTPException) as raised:
            update_channel_record(original.id, ChannelRecordUpdate(items=[self.saved_line(
                original, revenue_basis="post_discount",
            )]), self.db)
        self.assertEqual(raised.exception.detail["error"], "channel_revenue_basis_received_locked")
        self.db.commit()
        self.assertEqual(self.db.get(BankReconciliationMatch, "match").status, "confirmed")


if __name__ == "__main__":
    unittest.main()
