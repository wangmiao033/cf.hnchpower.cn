from __future__ import annotations

import unittest

# Importing v19 installs the production compatibility parser into matcher/main/v18.
import v19_main  # noqa: F401
import main
import matcher
import v18_main


class V19DiscountVariantCompatibilityTests(unittest.TestCase):
    def test_compact_discount_spellings_are_canonicalized(self):
        cases = {
            "一起来修仙005折": "0.05折",
            "一起来修仙0.05折": "0.05折",
            "游戏01折": "0.1折",
            "游戏0.1折": "0.1折",
            "游戏05折": "0.5折",
            "游戏0.5折": "0.5折",
            "游戏5折": "5折",
            "游戏10折": "10折",
            "游戏００５折": "0.05折",
        }
        for value, expected in cases.items():
            with self.subTest(value=value):
                self.assertEqual(matcher.commercial_game_variant(value), expected)
                self.assertEqual(main._infer_commercial_variant(value), expected)
                self.assertEqual(v18_main.commercial_game_variant(value), expected)

    def test_005_bill_matches_005_decimal_contract(self):
        bill = {
            "partner_name": "昆山灵狐网络科技有限公司",
            "channel_name": "测试渠道",
            "settlement_month": "2026年01月",
        }
        line = {
            "game_name": "一起来修仙005折",
            "settlement_cycle": "2026年01月",
        }
        candidate = {
            "partner_name": "昆山灵狐网络科技有限公司",
            "product_name": "一起来修仙0.05折",
            "channel_name": "测试渠道",
            "authorization_start": "2025-01-01",
            "authorization_end": "2029-12-31",
        }
        result = matcher.score_candidate(bill, line, candidate)
        self.assertTrue(result["eligible"])
        self.assertEqual(result["confidence"], "high")
        self.assertIn("商业版本一致（0.05折）", result["reasons"])

    def test_different_discount_versions_still_do_not_cross_match(self):
        bill = {
            "partner_name": "昆山灵狐网络科技有限公司",
            "channel_name": "测试渠道",
            "settlement_month": "2026年01月",
        }
        line = {
            "game_name": "一起来修仙005折",
            "settlement_cycle": "2026年01月",
        }
        candidate = {
            "partner_name": "昆山灵狐网络科技有限公司",
            "product_name": "一起来修仙0.1折",
            "channel_name": "测试渠道",
            "authorization_start": "2025-01-01",
            "authorization_end": "2029-12-31",
        }
        result = matcher.score_candidate(bill, line, candidate)
        self.assertFalse(result["eligible"])


if __name__ == "__main__":
    unittest.main()
