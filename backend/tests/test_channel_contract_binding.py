"""Contract evidence and financial rows must commit or fail together."""
from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.api.channel import create_channel_record, get_channel_record, update_channel_record
from app.models.channel import ChannelReceipt, ChannelRecord, ChannelRecordLineItem
from app.schemas.channel import ChannelLineItemCreate, ChannelRecordCreate, ChannelRecordUpdate


class ChannelContractBindingTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        for model in (ChannelRecord, ChannelRecordLineItem, ChannelReceipt):
            model.__table__.create(self.engine)
        self.db = Session(self.engine)
        for ddl in (
            "CREATE TABLE cf_partner_records (id TEXT PRIMARY KEY, name TEXT, short_name TEXT)",
            "CREATE TABLE cf_contract_records (id TEXT PRIMARY KEY, partner_id TEXT, performance_status TEXT)",
            """CREATE TABLE cf_contract_access_items (
                id TEXT PRIMARY KEY, contract_id TEXT, product_name TEXT, channel_name TEXT,
                platform TEXT, authorization_start TEXT, authorization_end TEXT,
                share_rate REAL, channel_fee_rate REAL, status TEXT)""",
            """CREATE TABLE cf_bill_contract_links (
                bill_type TEXT, bill_id TEXT, line_id TEXT, access_item_id TEXT,
                match_method TEXT, note TEXT, confirmed_by TEXT, confirmed_at TIMESTAMP,
                created_at TIMESTAMP, updated_at TIMESTAMP,
                PRIMARY KEY (bill_type,bill_id,line_id))""",
            """CREATE TABLE operation_logs (
                id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, entity_number TEXT,
                action TEXT, summary TEXT, actor_user_id TEXT, actor_email TEXT,
                changes TEXT, metadata TEXT, created_at TIMESTAMP)""",
        ):
            self.db.execute(text(ddl))
        self.db.execute(text("INSERT INTO cf_partner_records VALUES ('p1','测试客户有限公司','测试渠道（聚合）')"))
        self.db.execute(text("INSERT INTO cf_partner_records VALUES ('p2','另一客户有限公司','另一渠道')"))
        self.db.execute(text("INSERT INTO cf_contract_records VALUES ('c1','p1','履约中')"))
        self.db.execute(text("INSERT INTO cf_contract_records VALUES ('c2','p2','履约中')"))
        for access, contract in (("a1", "c1"), ("a2", "c1"), ("foreign", "c2")):
            self.db.execute(text("""
                INSERT INTO cf_contract_access_items VALUES
                (:id,:contract,'一起来修仙005折','测试渠道','全版本','2020-01-01','2028-12-31',23,0,'生效')
            """), {"id": access, "contract": contract})
        self.db.info["audit_actor"] = {"user_id": "finance-user"}
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def line(self, **changes):
        result = dict(game_name="一起来修仙005折", settlement_cycle="2026-01",
                      billing_flow=100, share_rate=23, tax_rate=0,
                      settlement_rule_code="share_only", channel_fee_mode="none",
                      channel_fee_rate=0, tax_mode="none", contract_access_item_id="a1")
        result.update(changes)
        return ChannelLineItemCreate(**result)

    def create(self, lines=None):
        return create_channel_record(ChannelRecordCreate(
            partner_name="测试客户有限公司", channel_name="测试渠道（聚合）",
            settlement_month="2026-01", settlement_rule_code="share_only",
            channel_fee_mode="none", channel_fee_rate=0, tax_mode="none",
            items=lines or [self.line()],
        ), self.db)

    def saved_payload(self, result, **changes):
        row = result.items[0]
        data = {key: getattr(row, key) for key in ChannelLineItemCreate.model_fields}
        data.update(changes)
        return ChannelLineItemCreate(**data)

    def links(self, bill_id):
        return dict(self.db.execute(text(
            "SELECT line_id,access_item_id FROM cf_bill_contract_links WHERE bill_id=:id"
        ), {"id": bill_id}).all())

    def test_create_bind_read_and_reopen(self):
        result = self.create()
        self.assertEqual(result.items[0].contract_access_item_id, "a1")
        reopened = get_channel_record(result.id, self.db)
        self.assertEqual(reopened.items[0].contract_access_item_id, "a1")
        actor = self.db.execute(text("SELECT confirmed_by FROM cf_bill_contract_links")).scalar()
        self.assertEqual(actor, "finance-user")

    def test_real_edit_rotates_line_id_and_atomically_carries_evidence(self):
        original = self.create()
        updated = update_channel_record(original.id, ChannelRecordUpdate(items=[
            self.saved_payload(original, billing_flow=200),
        ]), self.db)
        self.assertNotEqual(original.items[0].id, updated.items[0].id)
        self.assertEqual(self.links(original.id), {updated.items[0].id: "a1"})
        self.assertEqual(updated.items[0].settlement_amount, 46)

    def test_unrelated_line_edit_and_added_row_do_not_lose_prior_binding(self):
        original = self.create()
        updated = update_channel_record(original.id, ChannelRecordUpdate(items=[
            self.saved_payload(original), self.line(contract_access_item_id=None, billing_flow=50),
        ]), self.db)
        self.assertEqual(self.links(original.id), {updated.items[0].id: "a1"})
        self.assertEqual(updated.items[1].contract_access_item_id, None)

    def test_duplicate_games_keep_distinct_bindings_when_reordered(self):
        original = self.create([self.line(), self.line(contract_access_item_id="a2")])
        reverse = [ChannelLineItemCreate(**{
            key: getattr(row, key) for key in ChannelLineItemCreate.model_fields
        }) for row in reversed(original.items)]
        updated = update_channel_record(original.id, ChannelRecordUpdate(items=reverse), self.db)
        self.assertEqual([row.contract_access_item_id for row in updated.items], ["a2", "a1"])

    def test_deleted_line_evidence_is_removed(self):
        original = self.create([self.line(), self.line(contract_access_item_id="a2")])
        updated = update_channel_record(original.id, ChannelRecordUpdate(items=[
            self.saved_payload(original),
        ]), self.db)
        self.assertEqual(self.links(original.id), {updated.items[0].id: "a1"})

    def test_replace_all_rows_with_explicit_new_bindings_never_guesses_old_ids(self):
        original = self.create()
        updated = update_channel_record(original.id, ChannelRecordUpdate(items=[
            self.line(contract_access_item_id=None, billing_flow=50),
            self.line(contract_access_item_id="a2"),
        ]), self.db)
        self.assertEqual(self.links(original.id), {updated.items[1].id: "a2"})

    def test_explicit_clear_is_supported(self):
        original = self.create()
        updated = update_channel_record(original.id, ChannelRecordUpdate(items=[
            self.saved_payload(original, contract_access_item_id=None),
        ]), self.db)
        self.assertEqual(updated.items[0].id, original.items[0].id)
        self.assertEqual(self.links(original.id), {})
        logs = self.db.execute(text("SELECT changes FROM operation_logs WHERE entity_id=:id ORDER BY rowid"),
                               {"id": original.id}).scalars().all()
        self.assertEqual(len(logs), 2)
        self.assertEqual(json.loads(logs[-1])["contract_bindings"], {
            "before": {original.items[0].id: "a1"}, "after": {},
        })

    def test_omitted_binding_field_preserves_link_by_stable_id(self):
        original = self.create()
        data = self.saved_payload(original, billing_flow=200).model_dump()
        del data["contract_access_item_id"]
        updated = update_channel_record(original.id, ChannelRecordUpdate(items=[ChannelLineItemCreate(**data)]), self.db)
        self.assertEqual(updated.items[0].contract_access_item_id, "a1")

    def test_old_unchanged_client_preserves_id_and_evidence(self):
        original = self.create()
        data = self.saved_payload(original).model_dump(exclude={"id", "contract_access_item_id"})
        updated = update_channel_record(original.id, ChannelRecordUpdate(items=[ChannelLineItemCreate(**data)]), self.db)
        self.assertEqual(updated.items[0].id, original.items[0].id)
        self.assertEqual(updated.items[0].contract_access_item_id, "a1")

    def test_old_changed_client_without_ids_is_blocked_not_guessed(self):
        original = self.create()
        data = self.saved_payload(original, billing_flow=200).model_dump(exclude={"id", "contract_access_item_id"})
        with self.assertRaises(HTTPException) as raised:
            update_channel_record(original.id, ChannelRecordUpdate(items=[ChannelLineItemCreate(**data)]), self.db)
        self.assertEqual(raised.exception.detail["error"], "channel_contract_line_identity_required")
        self.db.rollback()
        self.assertEqual(get_channel_record(original.id, self.db).items[0].billing_flow, 100)

    def test_duplicate_and_foreign_original_ids_are_rejected_without_mutation(self):
        original = self.create()
        other = self.create()
        for rows in ([self.saved_payload(original), self.saved_payload(original)],
                     [self.saved_payload(original, id=other.items[0].id)]):
            with self.subTest(rows=len(rows)), self.assertRaises(HTTPException) as raised:
                update_channel_record(original.id, ChannelRecordUpdate(items=rows), self.db)
            self.assertEqual(raised.exception.detail["error"], "channel_contract_line_identity_invalid")
            self.db.rollback()
            self.assertEqual(self.links(original.id), {original.items[0].id: "a1"})

    def test_wrong_customer_selection_rolls_back_entire_update(self):
        original = self.create()
        with self.assertRaises(HTTPException) as raised:
            update_channel_record(original.id, ChannelRecordUpdate(remark="must not save", items=[
                self.saved_payload(original, contract_access_item_id="foreign", billing_flow=999),
            ]), self.db)
        self.assertEqual(raised.exception.detail["error"], "channel_contract_wrong_customer")
        # Even a caller that subsequently commits cannot persist partial changes.
        self.db.commit()
        saved = get_channel_record(original.id, self.db)
        self.assertEqual(saved.items[0].billing_flow, 100)
        self.assertIsNone(saved.remark)
        self.assertEqual(self.links(original.id), {original.items[0].id: "a1"})

    def test_contract_fee_cannot_be_zeroed_to_match_platform_amount(self):
        self.db.execute(text("UPDATE cf_contract_access_items SET channel_fee_rate=5 WHERE id='a2'"))
        self.db.commit()
        for changes in ({"channel_fee_rate": 0, "channel_fee_mode": "none"},
                        {"channel_fee_rate": 5, "channel_fee_mode": "percent", "share_rate": 25},
                        {"channel_fee_rate": 5, "channel_fee_mode": "percent", "settlement_rule_code": "share_only"}):
            with self.subTest(changes=changes), self.assertRaises(HTTPException) as raised:
                self.create([self.line(contract_access_item_id="a2", **changes)])
            self.assertEqual(raised.exception.detail["error"], "channel_contract_rule_changed")
        result = self.create([self.line(contract_access_item_id="a2",
            channel_fee_rate=5, channel_fee_mode="percent", settlement_rule_code="five_percent_gateway_share")])
        self.assertEqual(result.items[0].channel_fee_rate, 5)

    def test_formatting_equivalent_channel_is_accepted(self):
        self.db.execute(text("UPDATE cf_contract_access_items SET channel_name='测试-渠道' WHERE id='a2'"))
        self.db.commit()
        self.assertEqual(self.create([self.line(contract_access_item_id="a2")]).items[0].contract_access_item_id, "a2")

    def test_orphan_link_does_not_block_old_client_without_active_bindings(self):
        original = self.create([self.line(contract_access_item_id=None)])
        self.db.execute(text("""INSERT INTO cf_bill_contract_links
            (bill_type,bill_id,line_id,access_item_id) VALUES ('channel',:bill,'deleted-old-line','a1')"""),
            {"bill": original.id})
        self.db.commit()
        data = self.saved_payload(original, billing_flow=200).model_dump(exclude={"id", "contract_access_item_id"})
        updated = update_channel_record(original.id, ChannelRecordUpdate(items=[ChannelLineItemCreate(**data)]), self.db)
        self.assertEqual(updated.items[0].billing_flow, 200)
        self.assertEqual(self.links(original.id), {})

    def test_header_only_identity_change_cannot_retain_foreign_binding(self):
        original = self.create()
        with self.assertRaises(HTTPException):
            update_channel_record(original.id, ChannelRecordUpdate(partner_name="另一客户有限公司"), self.db)
        self.db.commit()
        self.assertEqual(get_channel_record(original.id, self.db).partner_name, original.partner_name)

    def test_header_only_remark_keeps_existing_evidence_after_contract_changes(self):
        """Current API behavior: metadata-only updates do not recertify a link."""
        original = self.create()
        before = dict(self.db.execute(text("SELECT * FROM cf_bill_contract_links")).mappings().one())
        self.db.execute(text("UPDATE cf_contract_access_items SET share_rate=25 WHERE id='a1'"))
        self.db.commit()
        updated = update_channel_record(original.id, ChannelRecordUpdate(remark="仅补充核对备注"), self.db)
        self.assertEqual(updated.remark, "仅补充核对备注")
        self.assertEqual(updated.items[0].id, original.items[0].id)
        self.assertEqual(updated.items[0].share_rate, 23)
        self.assertEqual(dict(self.db.execute(text("SELECT * FROM cf_bill_contract_links")).mappings().one()), before)
        self.assertEqual(self.db.execute(text("SELECT COUNT(*) FROM operation_logs")).scalar(), 1)

    def test_full_form_remark_preserves_unchanged_stale_evidence_without_recertifying(self):
        original = self.create()
        before = dict(self.db.execute(text("SELECT * FROM cf_bill_contract_links")).mappings().one())
        self.db.execute(text("UPDATE cf_contract_access_items SET share_rate=25 WHERE id='a1'"))
        self.db.commit()
        updated = update_channel_record(original.id, ChannelRecordUpdate(
            remark="仅补充核对备注", status="pending", items=[self.saved_payload(original)],
        ), self.db)
        self.assertEqual(updated.remark, "仅补充核对备注")
        self.assertEqual(updated.items[0].share_rate, 23)
        self.assertEqual(updated.items[0].contract_access_item_id, "a1")
        self.assertEqual(updated.items[0].id, original.items[0].id)
        self.assertEqual(dict(self.db.execute(text("SELECT * FROM cf_bill_contract_links")).mappings().one()), before)
        self.assertEqual(self.db.execute(text("SELECT COUNT(*) FROM operation_logs")).scalar(), 1)

    def test_same_confirmed_status_remark_is_not_a_new_confirmation(self):
        original = self.create()
        self.db.execute(text("UPDATE channel_records SET status='confirmed' WHERE id=:id"), {"id": original.id})
        self.db.execute(text("UPDATE cf_contract_access_items SET status='作废' WHERE id='a1'"))
        self.db.commit()
        updated = update_channel_record(original.id, ChannelRecordUpdate(
            remark="已核对账单的附加说明", status="confirmed", items=[self.saved_payload(original)],
        ), self.db)
        self.assertEqual(updated.status, "confirmed")
        self.assertEqual(updated.items[0].id, original.items[0].id)
        self.assertEqual(updated.remark, "已核对账单的附加说明")

    def test_substantive_line_changes_never_use_remark_compatibility(self):
        original = self.create()
        self.db.execute(text("UPDATE cf_contract_access_items SET share_rate=25 WHERE id='a1'"))
        self.db.commit()
        for changes in (
            {"billing_flow": 101}, {"test_cost": 1}, {"share_rate": 24},
            {"settlement_cycle": "2026-02"}, {"game_name": "一起来修仙01折"},
            {"platform_settlement_amount": 12}, {"system_settlement_amount": 12},
            {"channel_fee_rate": 5, "channel_fee_mode": "percent"},
        ):
            with self.subTest(changes=changes), self.assertRaises(HTTPException):
                update_channel_record(original.id, ChannelRecordUpdate(
                    remark="仍需完整核验", items=[self.saved_payload(original, **changes)],
                ), self.db)
            self.db.rollback()
        self.assertIsNone(get_channel_record(original.id, self.db).remark)

    def test_substantive_header_changes_never_use_remark_compatibility(self):
        original = self.create()
        self.db.execute(text("UPDATE cf_contract_access_items SET share_rate=25 WHERE id='a1'"))
        self.db.commit()
        for changes in (
            {"partner_name": "另一客户有限公司"}, {"channel_name": "另一渠道"},
            {"settlement_month": "2026-02"}, {"channel_fee_rate": 5},
            {"server_cost": 1}, {"settlement_adjustment_amount": 1, "settlement_adjustment_reason": "调整"},
            {"settlement_final_override": 10, "settlement_adjustment_reason": "调整"},
            {"statement_no": "NEW-NUMBER"}, {"status": "confirmed"},
        ):
            with self.subTest(changes=changes), self.assertRaises(HTTPException):
                update_channel_record(original.id, ChannelRecordUpdate(
                    remark="仍需完整核验", items=[self.saved_payload(original)], **changes,
                ), self.db)
            self.db.rollback()
        self.assertIsNone(get_channel_record(original.id, self.db).remark)

    def test_missing_original_id_and_changed_binding_never_use_remark_compatibility(self):
        original = self.create()
        self.db.execute(text("UPDATE cf_contract_access_items SET share_rate=25 WHERE id IN ('a1','a2')"))
        self.db.commit()
        for changes in ({"id": None}, {"contract_access_item_id": "a2"}):
            with self.subTest(changes=changes), self.assertRaises(HTTPException) as raised:
                update_channel_record(original.id, ChannelRecordUpdate(
                    remark="不能免检", items=[self.saved_payload(original, **changes)],
                ), self.db)
            self.assertEqual(raised.exception.detail["error"], "channel_contract_rule_changed")
            self.db.rollback()

    def test_remark_compatibility_does_not_bypass_revision_check(self):
        from datetime import timedelta
        original = self.create()
        with self.assertRaises(HTTPException) as raised:
            update_channel_record(original.id, ChannelRecordUpdate(
                remark="过期版本", items=[self.saved_payload(original)],
                expected_updated_at=original.updated_at - timedelta(seconds=10),
            ), self.db)
        self.assertEqual(raised.exception.detail["error"], "bill_version_conflict")

    def test_binding_write_failure_rolls_back_financial_rows(self):
        original = self.create()
        with patch("app.api.channel.save_channel_contract_bindings", side_effect=RuntimeError("storage failed")):
            with self.assertRaises(RuntimeError):
                update_channel_record(original.id, ChannelRecordUpdate(items=[
                    self.saved_payload(original, billing_flow=200),
                ]), self.db)
        self.db.rollback()
        self.assertEqual(get_channel_record(original.id, self.db).items[0].billing_flow, 100)
        self.assertEqual(self.links(original.id), {original.items[0].id: "a1"})

    def test_all_platform_contract_accepts_ios_without_merging_commercial_skus(self):
        self.assertEqual(self.create([self.line(game_name="一起来修仙(0.05折)-ios")]).items[0].contract_access_item_id, "a1")
        for game in ("一起来修仙01折-ios", "一起来修仙(0.05折红包版)-ios"):
            with self.subTest(game=game), self.assertRaises(HTTPException):
                self.create([self.line(game_name=game)])

    def test_invalid_status_dates_platform_and_missing_fields_block_bindings(self):
        for field, value in (("status", "作废"), ("authorization_end", "2025-12-31"),
                             ("platform", "Android"), ("share_rate", None), ("channel_name", "另一渠道")):
            with self.subTest(field=field):
                self.db.execute(text(f"UPDATE cf_contract_access_items SET {field}=:value WHERE id='a2'"), {"value": value})
                self.db.commit()
                with self.assertRaises(HTTPException):
                    self.create([self.line(contract_access_item_id="a2", game_name="一起来修仙005折-ios")])
                self.db.rollback()
                self.db.execute(text("""UPDATE cf_contract_access_items SET status='生效',
                    authorization_end='2028-12-31', platform='全版本', share_rate=23, channel_name='测试渠道' WHERE id='a2'"""))
                self.db.commit()


if __name__ == "__main__":
    unittest.main()
