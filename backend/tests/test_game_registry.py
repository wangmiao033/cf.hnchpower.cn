from __future__ import annotations

from copy import deepcopy
import unittest

from app.services.game_registry import build_history_preview, normalize_game_name


class GameRegistryPreviewTests(unittest.TestCase):
    def test_version_suffixes_are_not_merged(self):
        self.assertNotEqual(
            normalize_game_name("云上征途（0.05折）"),
            normalize_game_name("云上征途（3折）"),
        )
        self.assertEqual(
            normalize_game_name("一起来修仙（0.05折）"),
            normalize_game_name(" 一起来修仙 (0.05折) "),
        )

    def test_channel_game_month_rules_are_separate_and_historical_rows_are_immutable(self):
        rows = [
            {
                "bill_id": "b1", "partner_name": "厦门三七三三网络科技有限公司", "channel_name": "3733游戏",
                "settlement_cycle": "2026-01", "game_name": "一起来修仙（0.05折）",
                "share_rate": 30, "tax_rate": 5, "channel_fee_rate": 0,
                "settlement_rule_code": "legacy", "channel_fee_mode": "rate", "tax_mode": "share",
            },
            {
                "bill_id": "b2", "partner_name": "厦门三七三三网络科技有限公司", "channel_name": "3733游戏",
                "settlement_cycle": "2026-02", "game_name": "一起来修仙（0.05折）",
                "share_rate": 30, "tax_rate": 5, "channel_fee_rate": 0,
                "settlement_rule_code": "legacy", "channel_fee_mode": "rate", "tax_mode": "share",
            },
            {
                "bill_id": "b7", "partner_name": "厦门三七三三网络科技有限公司", "channel_name": "3733游戏",
                "settlement_cycle": "2026-07", "game_name": "一起来修仙（0.05折）",
                "share_rate": 25, "tax_rate": 0, "channel_fee_rate": 0,
                "settlement_rule_code": "legacy", "channel_fee_mode": "rate", "tax_mode": "share",
            },
            {
                "bill_id": "a1", "partner_name": "A公司", "channel_name": "A渠道",
                "settlement_cycle": "2026-07", "game_name": "一起来修仙（0.05折）",
                "share_rate": 35, "tax_rate": 0, "channel_fee_rate": 5,
                "settlement_rule_code": "legacy", "channel_fee_mode": "rate", "tax_mode": "share",
            },
        ]
        before = deepcopy(rows)
        preview = build_history_preview(rows)

        self.assertEqual(rows, before)
        self.assertFalse(preview["safety"]["historical_bills_mutated"])
        self.assertEqual(preview["summary"]["game_count"], 1)
        self.assertEqual(preview["summary"]["rule_period_count"], 3)

        rules_3733 = [rule for rule in preview["rules"] if rule["channel_name"] == "3733游戏"]
        self.assertEqual(len(rules_3733), 2)
        self.assertEqual(rules_3733[0]["start_month"], "2026-01")
        self.assertEqual(rules_3733[0]["end_month"], "2026-02")
        self.assertEqual(rules_3733[0]["share_rate"], "30.0000")
        self.assertEqual(rules_3733[1]["start_month"], "2026-07")
        self.assertEqual(rules_3733[1]["end_month"], "2026-07")
        self.assertEqual(rules_3733[1]["share_rate"], "25.0000")
        self.assertEqual(rules_3733[1]["tax_rate"], "0.0000")

        rule_a = [rule for rule in preview["rules"] if rule["channel_name"] == "A渠道"][0]
        self.assertEqual(rule_a["share_rate"], "35.0000")
        self.assertEqual(rule_a["channel_fee_rate"], "5.0000")

    def test_same_month_rule_conflict_is_reported_instead_of_guessed(self):
        rows = [
            {
                "bill_id": "b1", "partner_name": "P", "channel_name": "C", "settlement_cycle": "2026-07",
                "game_name": "游戏X", "share_rate": 25, "tax_rate": 0, "channel_fee_rate": 0,
            },
            {
                "bill_id": "b2", "partner_name": "P", "channel_name": "C", "settlement_cycle": "2026-07",
                "game_name": "游戏X", "share_rate": 30, "tax_rate": 0, "channel_fee_rate": 0,
            },
        ]
        preview = build_history_preview(rows)
        self.assertEqual(preview["summary"]["conflict_count"], 1)
        self.assertEqual(preview["summary"]["rule_period_count"], 0)
        self.assertEqual(preview["conflicts"][0]["month"], "2026-07")
        self.assertEqual(len(preview["conflicts"][0]["variants"]), 2)


if __name__ == "__main__":
    unittest.main()
