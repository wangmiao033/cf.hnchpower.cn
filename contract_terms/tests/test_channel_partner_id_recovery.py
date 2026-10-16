"""Regressions for stable customer identity and existing contract-list recovery."""
from __future__ import annotations

import unittest

from fastapi import HTTPException

import v21_main  # noqa: F401 - installs the live V21 matcher
import channel_rule_recommender as channel
from v13_main import (
    _explain_missing_contract_list,
    _linked_contract_catalog,
    _scope_linked_candidates,
    _verified_partner_selection,
)


class FakePartnerConnection:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []
        self.last_sql = ""

    def execute(self, sql, params):
        self.last_sql = sql
        self.params = params
        return self

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class LinkedCustomerContractMatchTests(unittest.TestCase):
    partner = {"id": "partner-bazhang", "name": "厦门巴掌互动科技有限公司", "short_name": "巴掌"}

    @staticmethod
    def candidate(**overrides):
        item = {
            "contract_id": "contract-bazhang",
            "contract_name": "厦门巴掌渠道合同",
            "access_item_id": "access-xiuxian-005",
            "partner_id": "partner-bazhang",
            "partner_name": "旧登记名称（改名前）",
            "partner_short_name": "旧名称",
            "counterparty": "原合同签约名",
            "product_name": "一起来修仙",
            "original_product_name": "一起来修仙005折",
            "channel_name": "巴掌",
            "authorization_start": "2025-01-01",
            "authorization_end": "2027-12-31",
            "share_rate": 43,
            "channel_fee_rate": 0,
            "invoice_tax_rate": None,
            "access_status": "生效",
            "performance_status": "履约中",
        }
        item.update(overrides)
        return item

    def test_customer_id_is_checked_against_customer_library(self):
        conn = FakePartnerConnection(self.partner)
        actual = _verified_partner_selection(conn, "partner-bazhang", self.partner["name"])
        self.assertEqual(actual["id"], "partner-bazhang")
        self.assertIn("cf_partner_records", conn.last_sql)
        with self.assertRaises(HTTPException) as raised:
            _verified_partner_selection(conn, "partner-bazhang", "另一个客户有限公司")
        self.assertEqual(raised.exception.status_code, 409)

    def test_deleted_customer_link_cannot_be_used(self):
        with self.assertRaises(HTTPException) as raised:
            _verified_partner_selection(FakePartnerConnection(None), "missing", self.partner["name"])
        self.assertEqual(raised.exception.status_code, 409)

    def test_verified_link_recovers_renamed_customer_and_compact_discount(self):
        scoped = _scope_linked_candidates([self.candidate()], self.partner)
        self.assertEqual(scoped[0]["partner_name"], self.partner["name"])
        result = channel.recommend_channel_rules(
            self.partner["name"],
            "巴掌",
            [{
                "game_name": "一起来修仙",
                "input_game_name": "一起来修仙（0.05折）",
                "settlement_cycle": "2026-05",
            }],
            scoped,
        )
        line = result["lines"][0]
        self.assertTrue(line["auto_apply"])
        self.assertEqual(line["match"]["access_item_id"], "access-xiuxian-005")
        self.assertEqual(line["recommended"]["share_rate"], 43)
        self.assertEqual(line["recommended"]["channel_fee_rate"], 0)

    def test_same_display_name_under_other_customer_id_does_not_cross_match(self):
        candidates = [
            self.candidate(partner_id="unrelated-customer", partner_name=self.partner["name"],
                           access_item_id="wrong", share_rate=90),
            self.candidate(access_item_id="right", share_rate=43),
        ]
        scoped = _scope_linked_candidates(candidates, self.partner)
        self.assertEqual([c["access_item_id"] for c in scoped], ["right"])
        result = channel.recommend_channel_rules(
            self.partner["name"], "巴掌",
            [{"game_name": "一起来修仙（0.05折）", "settlement_cycle": "2026-05"}],
            scoped,
        )
        self.assertEqual(result["lines"][0]["recommended"]["share_rate"], 43)

    def test_discount_mismatch_never_auto_applies(self):
        result = channel.recommend_channel_rules(
            self.partner["name"], "巴掌",
            [{"game_name": "一起来修仙（0.1折）", "settlement_cycle": "2026-05"}],
            _scope_linked_candidates([self.candidate()], self.partner),
        )
        self.assertFalse(result["lines"][0]["auto_apply"])

    def test_contract_without_list_reports_real_reason_but_no_financial_rule(self):
        conn = FakePartnerConnection(rows=[{
            "id": "contract-bazhang",
            "contract_name": "已录入的巴掌主合同",
            "contract_no": "C-001",
            "access_item_count": 0,
        }])
        catalog = _linked_contract_catalog(conn, "partner-bazhang")
        self.assertEqual(catalog["contract_count"], 1)
        self.assertEqual(catalog["access_item_count"], 0)
        self.assertIn("cf_contract_access_items", conn.last_sql)
        unresolved = {
            "message": "该游戏/账期未找到匹配的可用合同合作清单",
            "lines": [{"game_name": "一起来修仙（0.05折）", "auto_apply": False,
                       "match": None, "recommended": None}],
        }
        explained = _explain_missing_contract_list(unresolved, catalog)
        self.assertIn("已关联 1 份合同", explained["lines"][0]["message"])
        self.assertIn("补入", explained["message"])
        self.assertIsNone(explained["lines"][0]["recommended"])

    def test_existing_access_item_diagnostic_does_not_rewrite_matched_lines(self):
        matched = {"game_name": "一起来修仙", "auto_apply": True, "match": {"access_item_id": "a"},
                   "recommended": {"share_rate": 43}}
        other = {"game_name": "圣树唤歌", "auto_apply": False, "match": None, "recommended": None}
        result = _explain_missing_contract_list(
            {"lines": [matched, other]},
            {"contract_count": 1, "access_item_count": 1, "contracts": []},
        )
        self.assertEqual(result["lines"][0], matched)
        self.assertEqual(result["lines"][0]["recommended"]["share_rate"], 43)
        self.assertIn("商业版本", result["lines"][1]["message"])


if __name__ == "__main__":
    unittest.main()
