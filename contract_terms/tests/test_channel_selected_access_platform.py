"""Existing-list device identity and explicit-selection safety regressions."""
import unittest

import v21_main  # noqa: F401 - production matcher and trusted channel aliases
import channel_rule_recommender as channel
from extended_main import _CANDIDATE_SQL
from game_rule_fallback import apply_game_registry_fallback
from v13_main import _explain_missing_contract_list, _scope_linked_candidates


class ChannelSelectedAccessPlatformTests(unittest.TestCase):
    partner = "昆山爱趣网络科技有限公司"
    channel = "爱趣（爱趣聚合）"

    def candidate(self, **overrides):
        item = {
            "contract_id": "contract-aiqu",
            "contract_name": "爱趣-熊动",
            "contract_no": "HT-202308-0004",
            "access_item_id": "existing-item-8",
            "partner_id": "partner-aiqu",
            "partner_name": self.partner,
            "partner_short_name": self.channel,
            "counterparty": self.partner,
            "product_name": "一起来修仙005折",
            "platform": "全版本",
            "channel_name": "爱趣",
            "authorization_start": "2020-01-01",
            "authorization_end": "2028-12-31",
            "share_rate": 23,
            "channel_fee_rate": 0,
            "invoice_tax_rate": 0,
            "access_status": "生效",
            "performance_status": "履约中",
        }
        item.update(overrides)
        return item

    def result(self, game="一起来修仙005折", candidates=None, **line_overrides):
        line = {"game_name": game, "settlement_cycle": "2026-01", **line_overrides}
        return channel.recommend_channel_rules(
            self.partner, self.channel, [line], candidates if candidates is not None else [self.candidate()],
            verified_partner_id="partner-aiqu",
        )

    def test_candidate_query_includes_platform_without_schema_change(self):
        self.assertIn("access.platform", _CANDIDATE_SQL)

    def test_existing_ordinary_and_ios_item_resolve_without_registry_pollution(self):
        for game in ("一起来修仙005折", "一起来修仙005折-ios", "一起来修仙（0.05折）_ios"):
            with self.subTest(game=game):
                row = self.result(game)["lines"][0]
                self.assertTrue(row["auto_apply"], row["message"])
                self.assertEqual(row["match"]["access_item_id"], "existing-item-8")
                self.assertEqual(row["match"]["platform"], "全版本")
                self.assertEqual(row["recommended"]["share_rate"], 23)
                self.assertEqual(row["recommended"]["channel_fee_rate"], 0)

    def test_automatic_platform_conflict_never_reenters_fuzzy_fallback(self):
        for game, platform in (("一起来修仙005折-ios", "Android"), ("一起来修仙005折-Android", "iOS")):
            with self.subTest(game=game, platform=platform):
                row = self.result(game, [self.candidate(platform=platform)])["lines"][0]
                self.assertFalse(row["auto_apply"])
                self.assertIsNone(row["match"])

    def test_explicit_metadata_survives_line_construction(self):
        row = self.result(candidates=[self.candidate(platform="iOS")], platform="iOS", game_id="game-1")["lines"][0]
        self.assertTrue(row["auto_apply"])

    def test_device_suffix_never_changes_discount_or_named_commercial_edition(self):
        for game, product in (
            ("一起来修仙005折-ios", "一起来修仙01折"),
            ("一起来修仙（0.05折红包版）-ios", "一起来修仙（0.05折普通版）"),
        ):
            with self.subTest(game=game, product=product):
                row = self.result(game, [self.candidate(product_name=product)])["lines"][0]
                self.assertFalse(row["auto_apply"])

    def test_platform_normalization_does_not_bypass_expired_authorization(self):
        row = self.result("一起来修仙005折-ios", [self.candidate(authorization_end="2025-12-31")])["lines"][0]
        self.assertFalse(row["auto_apply"])
        self.assertEqual(row["authorization_status"], "out_of_range")

    def test_registry_explicit_discount_conflict_remains_blocked_with_ios(self):
        row = self.result(
            "一起来修仙01折",
            [self.candidate(product_name="一起来修仙01折", original_product_name="一起来修仙005折")],
            input_game_name="一起来修仙005折-ios",
        )["lines"][0]
        self.assertFalse(row["auto_apply"])
        self.assertIsNone(row["match"])

    def test_explicit_selection_resolves_multiple_conflicting_valid_items(self):
        candidates = [self.candidate(access_item_id=f"item-{rate}", share_rate=rate) for rate in (23, 50)]
        self.assertFalse(self.result(candidates=candidates)["lines"][0]["auto_apply"])
        row = self.result("一起来修仙005折-ios", candidates, access_item_id="item-50")["lines"][0]
        self.assertTrue(row["auto_apply"])
        self.assertTrue(row["selection_validated"])
        self.assertEqual(row["match"]["access_item_id"], "item-50")
        self.assertEqual(row["recommended"]["share_rate"], 50)

    def test_invalid_selection_never_substitutes_another_available_item(self):
        for selected in (
            self.candidate(access_item_id="selected", product_name="一起来修仙01折"),
            self.candidate(access_item_id="selected", platform="Android"),
            self.candidate(access_item_id="selected", authorization_end="2025-12-31"),
            self.candidate(access_item_id="selected", authorization_start=None, authorization_end=None),
            self.candidate(access_item_id="selected", authorization_start="invalid-date"),
            self.candidate(access_item_id="selected", authorization_start="2026-01-20", authorization_end="2026-01-10"),
            self.candidate(access_item_id="selected", access_status="作废"),
            self.candidate(access_item_id="selected", share_rate=None),
            self.candidate(access_item_id="selected", share_rate=float("inf")),
            self.candidate(access_item_id="selected", channel_fee_rate=-1),
            self.candidate(access_item_id="selected", channel_name="其他渠道"),
            self.candidate(access_item_id="selected", partner_name="其他客户", partner_short_name="其他客户", counterparty="其他客户"),
        ):
            with self.subTest(selected=selected):
                row = self.result("一起来修仙005折-ios", [self.candidate(), selected], access_item_id="selected")["lines"][0]
                self.assertFalse(row["auto_apply"])
                self.assertTrue(row["selection_error"])
                self.assertIsNone(row["match"])
                self.assertIsNone(row["recommended"])

    def test_customer_scope_missing_and_wrong_customer_selection_remain_invalid(self):
        candidates = _scope_linked_candidates(
            [self.candidate(), self.candidate(access_item_id="other-customer", partner_id="other")],
            {"id": "partner-aiqu", "name": self.partner, "short_name": self.channel},
        )
        for selected in ("missing-id", "other-customer"):
            row = self.result(candidates=candidates, access_item_id=selected)["lines"][0]
            self.assertFalse(row["auto_apply"])
            self.assertTrue(row["selection_error"])
            self.assertEqual(row["selected_access_item_id"], selected)

    def test_selection_error_is_not_overwritten_by_registry_or_catalog_fallback(self):
        result = self.result(access_item_id="missing-id", game_id="game-1")
        error = result["lines"][0]["selection_error"]
        result = apply_game_registry_fallback(
            result, partner_name=self.partner, channel_name=self.channel,
            lines=[{"game_id": "game-1", "settlement_cycle": "2026-01", "access_item_id": "missing-id"}],
            registry_rules=[{
                "id": "registry-rule", "game_id": "game-1", "partner_name": self.partner,
                "channel_name": self.channel, "start_month": "2025-01", "end_month": None,
                "status": "active", "source": "manual", "share_rate": 90, "channel_fee_rate": 5,
            }],
        )
        result = _explain_missing_contract_list(result, {"contract_count": 1, "access_item_count": 1})
        self.assertFalse(result["lines"][0]["auto_apply"])
        self.assertEqual(result["lines"][0]["message"], error)
        self.assertIsNone(result["lines"][0]["match"])
        self.assertEqual(result["registry_fallback_count"], 0)

    def with_registry_fallback(self, result):
        return apply_game_registry_fallback(
            result, partner_name=self.partner, channel_name=self.channel,
            lines=[{"game_id": "game-1", "settlement_cycle": "2026-01"}],
            registry_rules=[{
                "id": "registry-rule", "game_id": "game-1", "partner_name": self.partner,
                "channel_name": self.channel, "start_month": "2025-01", "end_month": None,
                "status": "active", "source": "manual", "share_rate": 90, "channel_fee_rate": 5,
            }],
        )

    def test_platform_conflict_blocks_registry_fallback_only_for_same_identity(self):
        for game, platform in (("一起来修仙005折-ios", "Android"), ("一起来修仙005折-Android", "iOS")):
            with self.subTest(game=game, platform=platform):
                result = self.with_registry_fallback(
                    self.result(game, [self.candidate(platform=platform)], game_id="game-1"),
                )
                result = _explain_missing_contract_list(result, {"contract_count": 1, "access_item_count": 1})
                row = result["lines"][0]
                self.assertTrue(row["platform_conflict"])
                self.assertFalse(row["auto_apply"])
                self.assertIn("平台", row["message"])
                self.assertIsNone(row["match"])
                self.assertEqual(result["registry_fallback_count"], 0)

    def test_bamen_unique_android_candidate_accepts_unspecified_bill_device(self):
        candidate = self.candidate(
            partner_id="bamen", partner_name="长沙掌控智能科技有限公司",
            partner_short_name="掌控智能（八门助手）", counterparty="长沙掌控智能科技有限公司",
            channel_name="", platform="Android", authorization_start="2023-07-05",
            authorization_end="2028-12-31", share_rate=30, channel_fee_rate=5,
        )
        for selected in ("", candidate["access_item_id"]):
            with self.subTest(selected=selected):
                row = channel.recommend_channel_rules(
                    candidate["partner_name"], candidate["partner_short_name"],
                    [{"game_name": "一起来修仙（0.05折）", "settlement_cycle": "2026-09", "access_item_id": selected}],
                    [candidate], verified_partner_id="bamen",
                )["lines"][0]
                self.assertTrue(row["auto_apply"], row["message"])
                self.assertEqual(row["recommended"]["share_rate"], 30)
                self.assertEqual(row["recommended"]["channel_fee_rate"], 5)
                self.assertEqual(row["match"]["access_item_id"], candidate["access_item_id"])
                self.assertTrue(row["platform_unspecified"])
                self.assertNotIn("platform_conflict", row)
                self.assertNotIn("platform", row["recommended"])
                self.assertIn("账单设备未声明，未推断设备", row["message"])

    def test_unknown_device_different_platform_or_terms_cannot_auto_choose(self):
        base = self.candidate(access_item_id="android", platform="Android")
        for other in (
            self.candidate(access_item_id="other", platform="iOS"),
            self.candidate(access_item_id="other", platform="全版本"),
            self.candidate(access_item_id="other", platform="Android", share_rate=50),
            # A higher score must not conceal a second relevant unknown-period
            # candidate with different settlement terms.
            self.candidate(access_item_id="other", platform="Android", share_rate=50,
                           authorization_start=None, authorization_end=None),
            # Completeness filtering cannot conceal a different platform.
            self.candidate(access_item_id="other", platform="iOS", share_rate=None),
        ):
            with self.subTest(other=other):
                result = self.with_registry_fallback(self.result(candidates=[base, other], game_id="game-1"))
                row = result["lines"][0]
                self.assertFalse(row["auto_apply"])
                self.assertTrue(row["platform_ambiguity"])
                self.assertFalse(row["financially_unambiguous"])
                self.assertFalse(result["partner_auto_apply"])
                self.assertIn("账单设备未声明", row["message"])
                self.assertEqual(result["registry_fallback_count"], 0)
                # Explicit selection identifies the contract, not a guessed
                # device; all the existing identity/authorization checks apply.
                selected = self.result(candidates=[base, other], access_item_id="android")["lines"][0]
                self.assertTrue(selected["auto_apply"], selected["message"])
                self.assertTrue(selected["platform_unspecified"])

    def test_unknown_device_same_platform_same_terms_keeps_consensus(self):
        rows = [self.candidate(access_item_id=str(index), platform="Android") for index in range(2)]
        result = self.result(candidates=rows)["lines"][0]
        self.assertTrue(result["auto_apply"], result["message"])
        self.assertFalse(result["platform_ambiguity"])
        self.assertTrue(result["rule_consensus"])
        self.assertTrue(result["platform_unspecified"])

    def test_all_platform_and_dual_device_are_distinct_unknown_device_scopes(self):
        candidates = [
            self.candidate(access_item_id="all", platform="全版本"),
            self.candidate(access_item_id="dual", platform="Android/iOS"),
        ]
        row = self.result(candidates=candidates)["lines"][0]
        self.assertFalse(row["auto_apply"])
        self.assertTrue(row["platform_ambiguity"])
        self.assertIn("平台范围不同", row["message"])
        self.assertTrue(self.result(candidates=candidates, access_item_id="all")["lines"][0]["auto_apply"])

    def test_platform_ambiguity_flag_alone_blocks_registry_and_missing_list_explanation(self):
        result = self.result(candidates=[
            self.candidate(platform="Android"),
            self.candidate(access_item_id="ios", platform="iOS"),
        ], game_id="game-1")
        original_message = result["lines"][0]["message"]
        # The protection must not depend on keeping the first candidate as a
        # display match; a future API may omit that display-only object.
        result["lines"][0]["match"] = None
        result["lines"][0]["recommended"] = None
        result = self.with_registry_fallback(result)
        result = _explain_missing_contract_list(result, {"contract_count": 1, "access_item_count": 2})
        row = result["lines"][0]
        self.assertFalse(row["auto_apply"])
        self.assertTrue(row["platform_ambiguity"])
        self.assertEqual(row["message"], original_message)
        self.assertIsNone(row["recommended"])
        self.assertEqual(result["registry_fallback_count"], 0)

    def test_unknown_device_same_platform_incomplete_duplicate_does_not_invent_terms_conflict(self):
        result = self.result(candidates=[
            self.candidate(platform="Android"),
            self.candidate(access_item_id="incomplete", platform="Android", share_rate=None),
        ])["lines"][0]
        self.assertTrue(result["auto_apply"], result["message"])
        self.assertFalse(result["platform_ambiguity"])

    def test_expired_other_platform_does_not_block_live_unique_candidate(self):
        result = self.result(candidates=[
            self.candidate(platform="Android"),
            self.candidate(access_item_id="expired-ios", platform="iOS", authorization_end="2025-12-31"),
        ])["lines"][0]
        self.assertTrue(result["auto_apply"], result["message"])
        self.assertFalse(result["platform_ambiguity"])

    def test_unknown_device_does_not_accept_self_contradictory_candidate(self):
        result = self.result(candidates=[
            self.candidate(product_name="一起来修仙005折-ios", platform="Android"),
        ])["lines"][0]
        self.assertFalse(result["auto_apply"])
        self.assertTrue(result["platform_conflict"])

    def test_unrelated_platform_candidate_does_not_block_ordinary_registry_fallback(self):
        for overrides in (
            {"product_name": "完全不同的游戏"},
            {"channel_name": "另一渠道"},
            {"partner_name": "另一客户", "partner_short_name": "另一客户", "counterparty": "另一客户"},
        ):
            with self.subTest(overrides=overrides):
                result = self.with_registry_fallback(self.result(
                    "一起来修仙005折-ios", [self.candidate(platform="Android", **overrides)], game_id="game-1",
                ))
                row = result["lines"][0]
                self.assertNotIn("platform_conflict", row)
                self.assertTrue(row["auto_apply"])
                self.assertEqual(row["rule_source"], "game_registry")


if __name__ == "__main__":
    unittest.main()
