"""Generic linked customer aliases in channel list and global bill search.

The search result may include the customer's live display name only when the
saved bill legal partner EXACTLY equals the customer's normalized legal name.
A shared nickname across unrelated companies must not create a ledger link.
"""
from unittest import TestCase

from sqlalchemy import select

from app.api.channel import _apply_filters
from app.models.channel import ChannelRecord
from app.services.global_search import _search_channel_bills, _search_rd_bills


class Rows:
    def __init__(self, data):
        self.data = data

    def scalar_one_or_none(self):
        return self.data

    def mappings(self):
        return self

    def all(self):
        return self.data if isinstance(self.data, list) else []


class CaptureQueries:
    def __init__(self, *, customers_exist=True):
        self.customers_exist = customers_exist
        self.sqls = []
        self.params = []

    def execute(self, statement, parameters=None):
        sql = str(statement)
        self.sqls.append(sql)
        self.params.append(parameters)
        if "to_regclass" in sql:
            return Rows("public.cf_partner_records" if self.customers_exist else None)
        return Rows([])


class CustomerLinkedSearchBackendTests(TestCase):
    def test_channel_rest_query_includes_same_legal_customer_short_name_and_tag(self):
        statement = _apply_filters(
            select(ChannelRecord),
            search="朋克",
            settlement_month=None,
            channel_name=None,
            game_name=None,
            status=None,
        )
        compiled = str(statement)
        values = [str(v) for v in statement.compile().params.values()]
        self.assertIn("cf_partner_records", compiled)
        self.assertIn("cf_partner_records.normalized_name", compiled)
        self.assertIn("channel_records.partner_name", compiled)
        self.assertIn("cf_partner_records.short_name", compiled)
        self.assertIn("cf_partner_records.tag", compiled)
        self.assertIn("%朋克%", values)

    def test_other_customer_text_is_not_joined_on_partial_name_or_brand(self):
        statement = _apply_filters(
            select(ChannelRecord),
            search="朋克4",
            settlement_month=None, channel_name=None, game_name=None, status=None,
        )
        sql = str(statement)
        self.assertIn("cf_partner_records.normalized_name", sql)
        self.assertNotIn("cf_partner_records.short_name = channel_records.channel_name", sql)
        self.assertNotIn("channel_records.channel_name LIKE cf_partner_records", sql)

    def test_channel_global_search_uses_live_linked_alias_and_tag_if_library_exists(self):
        db = CaptureQueries()
        self.assertEqual(_search_channel_bills(db, "朋克", 10), [])
        sql = db.sqls[-1]
        self.assertIn("LEFT JOIN cf_partner_records AS customer", sql)
        self.assertIn("customer.normalized_name =", sql)
        self.assertIn("customer.short_name ILIKE :pattern", sql)
        self.assertIn("customer.tag ILIKE :pattern", sql)
        self.assertIn("MAX(customer.short_name)", sql)
        self.assertEqual(db.params[-1]["pattern"], "%朋克%")

    def test_rd_global_search_uses_the_same_customer_relationship(self):
        db = CaptureQueries()
        self.assertEqual(_search_rd_bills(db, "朋克", 10), [])
        sql = db.sqls[-1]
        self.assertIn("reconciliation_records AS bill", sql)
        self.assertIn("LEFT JOIN cf_partner_records AS customer", sql)
        self.assertIn("customer.short_name ILIKE :pattern", sql)

    def test_global_search_gracefully_degrades_without_customer_library_table(self):
        db = CaptureQueries(customers_exist=False)
        self.assertEqual(_search_channel_bills(db, "芯动", 10), [])
        self.assertNotIn("LEFT JOIN cf_partner_records", db.sqls[-1])
        self.assertIn("bill.channel_name", db.sqls[-1])


if __name__ == "__main__":
    import unittest
    unittest.main()
