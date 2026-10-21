"""Loaded contract variants must reject unsafe writes before ledger mutation."""
from __future__ import annotations

import unittest

from fastapi import HTTPException
from sqlalchemy import text

from app.api.channel import get_channel_record, update_channel_record
from app.schemas.channel import ChannelRecordUpdate

import test_channel_contract_binding as binding_fixtures


class ChannelContractStructuredVariantTests(unittest.TestCase):
    """Reuse the existing isolated SQLite fixture, not a production connection."""

    def setUp(self):
        binding_fixtures.ChannelContractBindingTests.setUp(self)
        self.db.execute(text("""
            UPDATE cf_contract_access_items SET product_name='测试游戏（0.05折）'
        """))
        self.db.commit()

    def tearDown(self):
        binding_fixtures.ChannelContractBindingTests.tearDown(self)

    def line(self, **changes):
        changes.setdefault("game_name", "测试游戏（0.05折）")
        return binding_fixtures.ChannelContractBindingTests.line(self, **changes)

    create = binding_fixtures.ChannelContractBindingTests.create
    saved_payload = binding_fixtures.ChannelContractBindingTests.saved_payload
    links = binding_fixtures.ChannelContractBindingTests.links

    def install_terms(self, **variants):
        self.db.execute(text("""
            CREATE TABLE cf_contract_access_terms (
                access_item_id TEXT PRIMARY KEY, commercial_variant TEXT
            )
        """))
        for access_id, variant in variants.items():
            self.db.execute(text("""
                INSERT INTO cf_contract_access_terms (access_item_id, commercial_variant)
                VALUES (:access_id, :variant)
            """), {"access_id": access_id, "variant": variant})
        self.db.commit()

    def ledger_state(self):
        # Comparing actual rows is stronger than counts: failed updates must not
        # rotate IDs, change money, replace evidence, or append an audit event.
        return {
            table: [dict(row) for row in self.db.execute(text(f"SELECT * FROM {table} ORDER BY rowid")).mappings()]
            for table in (
                "channel_records", "channel_record_line_items", "channel_receipts",
                "cf_bill_contract_links", "operation_logs",
            )
        }

    def assert_rejected_without_mutation(self, action):
        before = self.ledger_state()
        with self.assertRaises(HTTPException) as raised:
            action()
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail["error"], "channel_contract_wrong_game")
        # A caller that commits after catching the refusal still cannot persist
        # any header, line, amount, binding, or audit change.
        self.db.commit()
        self.db.expire_all()
        self.assertEqual(self.ledger_state(), before)

    def test_matching_db_variant_binds_and_preserves_raw_game_and_amount(self):
        self.install_terms(a1="0.05折")
        result = self.create()
        self.assertEqual(result.items[0].game_name, "测试游戏（0.05折）")
        self.assertEqual(result.items[0].contract_access_item_id, "a1")
        self.assertEqual(result.items[0].billing_flow, 100)
        self.assertEqual(result.items[0].settlement_amount, 23)
        self.assertEqual(self.links(result.id), {result.items[0].id: "a1"})

    def test_missing_terms_table_keeps_legacy_binding_compatible(self):
        result = self.create()
        self.assertEqual(result.items[0].contract_access_item_id, "a1")
        self.assertEqual(result.items[0].settlement_amount, 23)

    def test_missing_terms_row_keeps_legacy_binding_compatible(self):
        self.install_terms(a2="0.1折")
        result = self.create()
        self.assertEqual(result.items[0].contract_access_item_id, "a1")
        self.assertEqual(result.items[0].settlement_amount, 23)

    def test_conflicting_db_variant_blocks_single_and_multi_line_create_atomically(self):
        self.install_terms(a1="0.05折", a2="0.1折")
        for count in (1, 2):
            with self.subTest(line_count=count):
                rows = [self.line(contract_access_item_id="a2")]
                if count == 2:
                    rows.insert(0, self.line())
                self.assert_rejected_without_mutation(lambda: self.create(rows))

    def test_db_variant_changed_since_binding_blocks_substantive_update_atomically(self):
        self.install_terms(a1="0.05折")
        original = self.create()
        self.db.execute(text("""
            UPDATE cf_contract_access_terms SET commercial_variant='0.1折'
            WHERE access_item_id='a1'
        """))
        self.db.commit()
        self.assert_rejected_without_mutation(lambda: update_channel_record(
            original.id, ChannelRecordUpdate(
                remark="must not save", items=[self.saved_payload(original, billing_flow=999)],
            ), self.db,
        ))
        saved = get_channel_record(original.id, self.db)
        self.assertEqual(saved.items[0].billing_flow, 100)
        self.assertEqual(saved.items[0].settlement_amount, 23)
        self.assertIsNone(saved.remark)
        self.assertEqual(self.links(original.id), {original.items[0].id: "a1"})

    def test_switch_to_conflicting_db_variant_preserves_existing_link_and_amounts(self):
        self.install_terms(a1="0.05折", a2="0.1折")
        original = self.create()
        self.assert_rejected_without_mutation(lambda: update_channel_record(
            original.id, ChannelRecordUpdate(items=[
                self.saved_payload(original, contract_access_item_id="a2", billing_flow=999),
            ]), self.db,
        ))
        self.assertEqual(self.links(original.id), {original.items[0].id: "a1"})

    def test_matching_db_variant_allows_update_without_changing_calculation(self):
        self.install_terms(a1="0.05折")
        original = self.create()
        result = update_channel_record(original.id, ChannelRecordUpdate(items=[
            self.saved_payload(original, billing_flow=200),
        ]), self.db)
        self.assertEqual(result.items[0].game_name, "测试游戏（0.05折）")
        self.assertEqual(result.items[0].billing_flow, 200)
        self.assertEqual(result.items[0].share_rate, 23)
        self.assertEqual(result.items[0].settlement_amount, 46)
        self.assertEqual(self.links(result.id), {result.items[0].id: "a1"})

    def test_named_db_edition_conflict_blocks_create_without_partial_writes(self):
        self.install_terms(a1="0.05折红包版")
        self.db.execute(text("""
            UPDATE cf_contract_access_items SET product_name='测试游戏0.05折普通版'
            WHERE id='a1'
        """))
        self.db.commit()
        # Bill and cooperation item agree exactly. Only the real terms-table
        # value exposes the conflict, so dictionary-only guards cannot pass.
        self.assert_rejected_without_mutation(lambda: self.create([
            self.line(game_name="测试游戏0.05折普通版"),
        ]))

    def test_named_db_edition_changed_after_binding_blocks_update_atomically(self):
        self.install_terms(a1="0.05折普通版")
        self.db.execute(text("""
            UPDATE cf_contract_access_items SET product_name='测试游戏0.05折普通版'
            WHERE id='a1'
        """))
        self.db.commit()
        original = self.create([self.line(game_name="测试游戏0.05折普通版")])
        self.assertEqual(original.items[0].settlement_amount, 23)
        self.db.execute(text("""
            UPDATE cf_contract_access_terms SET commercial_variant='0.05折红包版'
            WHERE access_item_id='a1'
        """))
        self.db.commit()
        self.assert_rejected_without_mutation(lambda: update_channel_record(
            original.id, ChannelRecordUpdate(
                remark="must not save", items=[self.saved_payload(original, billing_flow=999)],
            ), self.db,
        ))
        saved = get_channel_record(original.id, self.db)
        self.assertEqual(saved.items[0].game_name, "测试游戏0.05折普通版")
        self.assertEqual(saved.items[0].settlement_amount, 23)
        self.assertEqual(self.links(original.id), {original.items[0].id: "a1"})


if __name__ == "__main__":
    unittest.main()
