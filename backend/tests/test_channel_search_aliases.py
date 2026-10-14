"""Channel-list keyword discovery: company names plus legacy search terms.

These query terms are for discovery only. They do not merge customers or
change stored channel records, settlement amounts or receipt entries.
"""
from unittest import TestCase

from sqlalchemy import select

from app.api.channel import _apply_filters, _channel_search_terms
from app.models.channel import ChannelRecord


class ChannelKeywordSearchTests(TestCase):
    def test_known_keyword_variants(self):
        for word in ("游海", "麦游", "海游", "游海（麦游）", "游海(麦游)", "游海麦游"):
            terms = _channel_search_terms(word)
            self.assertIn("游海", terms, word)
            self.assertIn("麦游", terms, word)
            self.assertIn("游海（麦游）", terms, word)

    def test_full_legal_company_name_does_not_turn_into_an_alias(self):
        self.assertEqual(
            _channel_search_terms("西安麦游网络科技有限公司"),
            ["西安麦游网络科技有限公司"],
        )
        self.assertEqual(_channel_search_terms("游"), ["游"])
        self.assertEqual(_channel_search_terms(""), [])

    def test_backend_query_includes_partner_company_and_aliases(self):
        query = _apply_filters(
            select(ChannelRecord),
            search="麦游",
            settlement_month=None, channel_name=None, game_name=None, status=None,
        )
        statement = str(query)
        values = [str(value) for value in query.compile().params.values()]
        self.assertIn("channel_records.partner_name", statement)
        self.assertIn("channel_records.channel_name", statement)
        self.assertIn("%麦游%", values)
        self.assertIn("%游海%", values)
        self.assertIn("%游海（麦游）%", values)

    def test_ordinary_partner_search_matches_only_its_text(self):
        query = _apply_filters(
            select(ChannelRecord),
            search="西安麦游网络科技有限公司",
            settlement_month=None, channel_name=None, game_name=None, status=None,
        )
        values = [str(value) for value in query.compile().params.values()]
        self.assertIn("%西安麦游网络科技有限公司%", values)
        self.assertNotIn("%游海%", values)
        self.assertNotIn("%西安游海网络科技有限公司%", values)
