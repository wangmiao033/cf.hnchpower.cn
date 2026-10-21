"""Original-SKU regression tests through the production candidate pipeline.

Use the real V10 projection, registry enrichment and V21 recommendation before
checking the raw SQL item's durable core binding. All names are synthetic and
all registry reads are answered by a strict in-memory fake, without a database.
"""
from copy import deepcopy
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import HTTPException

# Import the contract entrypoint before the backend: each service has a main.py.
import v21_main
import channel_rule_recommender as channel
from game_identity import (
    enrich_candidates_with_game_ids,
    enrich_lines_with_game_ids,
    normalize_registry_game,
)
from game_platform_identity import financial_game_key
from game_rule_fallback import apply_game_registry_fallback
from v10_main import _project_variant_into_name
from v13_main import _explain_missing_contract_list, _scope_linked_candidates

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
try:
    from app.services.channel_contract_binding import (
        contract_game_matches,
        validate_contract_binding,
    )
finally:
    sys.path.pop(0)


class _Result:
    def __init__(self, *, rows=None, one=None):
        self.rows = rows or []
        self.one = one

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.one


class _Registry:
    """Give bill and candidate the SAME identity, even for different raw SKUs."""

    game_id = "same-registry-game"

    def __init__(self, names, *, mode="access_link", canonical="游戏库规范显示名称", game_id=None):
        self.keys = {normalize_registry_game(name) for name in names}
        self.mode = mode
        self.canonical = canonical
        if game_id is not None:
            self.game_id = game_id

    def execute(self, sql, params=None):
        statement = str(sql)
        if "to_regclass" in statement:
            return _Result(one={"name": None if self.mode == "absent" else params[0]})
        if "FROM contract_access_game_links" in statement:
            return _Result(rows=[
                {"access_item_id": item, "game_id": self.game_id}
                for item in params[0] if item == "access" and self.mode == "access_link"
            ])
        if "SELECT id, canonical_name" in statement:
            return _Result(rows=[
                {"id": self.game_id, "canonical_name": self.canonical}
                for item in params[0] if item == self.game_id
            ])
        if "normalized_name = ANY" in statement:
            return _Result()
        if "FROM game_registry_aliases AS alias" in statement:
            return _Result(rows=[
                {"normalized_alias": key, "game_id": self.game_id, "canonical_name": self.canonical}
                for key in params[0] if key in self.keys
            ])
        raise AssertionError(f"Unexpected registry SQL: {statement}")


class OriginalCandidatePipelineTests(unittest.TestCase):
    partner = {"id": "partner", "name": "测试客户有限公司", "short_name": "测试渠道（聚合）"}
    modes = ("absent", "access_link", "registry_alias")

    def setUp(self):
        # Accidental production database access must fail locally, not attempt a
        # connection using whatever credentials happen to be in the environment.
        blocker = patch("psycopg.connect", side_effect=AssertionError("No live DB in identity tests"))
        blocker.start()
        self.addCleanup(blocker.stop)
        self.assertIs(channel._rank_candidates, v21_main.rank_candidates_v21)

    def candidate(self, product="测试游戏折扣服0.05折", variant="0.05折", platform="Android"):
        return {
            "access_item_id": "access", "contract_id": "contract",
            "partner_id": self.partner["id"], "partner_name": self.partner["name"],
            "partner_short_name": self.partner["short_name"], "counterparty": self.partner["name"],
            "product_name": product, "commercial_variant": variant,
            "platform": platform, "channel_name": "测试渠道",
            "authorization_start": "2020-01-01", "authorization_end": "2028-12-31",
            "share_rate": 23, "channel_fee_rate": 0, "invoice_tax_rate": 0,
            "access_status": "生效", "performance_status": "履约中",
        }

    def finish_with_registry_fallback(self, result, lines, *, catalog=None):
        result = apply_game_registry_fallback(
            result, partner_name=self.partner["name"], channel_name=self.partner["short_name"],
            lines=lines, registry_rules=[{
                "id": "manual-registry-rule", "game_id": _Registry.game_id,
                "game_name": "游戏库规范显示名称", "partner_name": self.partner["name"],
                "channel_name": self.partner["short_name"], "start_month": "2025-01",
                "end_month": None, "status": "active", "source": "manual",
                "share_rate": 99, "channel_fee_rate": 0, "tax_rate": 0,
                "settlement_rule_code": "share_only", "channel_fee_mode": "none", "tax_mode": "none",
            }],
        )
        return _explain_missing_contract_list(
            result, catalog if catalog is not None else {"contract_count": 1, "access_item_count": 1},
        )

    def pipeline(self, game, raw_candidate, *, mode, selected, canonical="游戏库规范显示名称"):
        before = deepcopy(raw_candidate)
        projected = _project_variant_into_name(raw_candidate)
        conn = _Registry(
            [game, raw_candidate["product_name"], projected["product_name"], canonical],
            mode=mode, canonical=canonical,
        )
        lines = enrich_lines_with_game_ids(conn, [{
            "game_name": game, "settlement_cycle": "2026-01",
            "access_item_id": "access" if selected else "",
        }])
        enriched = enrich_candidates_with_game_ids(conn, [projected])
        if mode != "absent":
            self.assertEqual(lines[0]["game_id"], enriched[0]["game_id"])
            self.assertEqual(lines[0]["game_name"], enriched[0]["product_name"])
        candidates = _scope_linked_candidates(enriched, self.partner)
        result = channel.recommend_channel_rules(
            self.partner["name"], self.partner["short_name"], lines, candidates,
            verified_partner_id=self.partner["id"],
        )
        initial = deepcopy(result["lines"][0])
        result = self.finish_with_registry_fallback(result, lines)
        row = result["lines"][0]
        # Exercise the complete V13 response pipeline, not only V21 ranking.
        # A same-ID, active manual rule must never rescue a rejected SKU/device
        # or replace the actual contract's 23% rule with its synthetic 99% rate.
        self.assertEqual(result["registry_fallback_count"], 0)
        self.assertEqual(row["auto_apply"], initial["auto_apply"])
        self.assertEqual(row["recommended"], initial["recommended"])
        if not initial["auto_apply"]:
            self.assertTrue(any(initial.get(flag) for flag in (
                "selection_error", "platform_conflict", "commercial_identity_conflict",
            )), "An identity refusal must remain distinguishable from an absent contract")
            self.assertEqual(row["message"], initial["message"])
            self.assertTrue(row["message"])
            self.assertIsNone(row["match"])
            self.assertIsNone(row["recommended"])
        bill = SimpleNamespace(
            channel_name=self.partner["short_name"], settlement_month="2026-01",
            settlement_rule_code="share_only", channel_fee_mode="none", channel_fee_rate=0,
        )
        line = SimpleNamespace(
            game_name=game, settlement_cycle="2026-01", share_rate=23,
            settlement_rule_code="share_only", channel_fee_mode="none", channel_fee_rate=0,
        )
        try:
            validate_contract_binding(bill, line, raw_candidate, self.partner)
            saved = True
        except HTTPException as exc:
            self.assertEqual(exc.status_code, 409)
            self.assertEqual(exc.detail["error"], "channel_contract_wrong_game")
            saved = False
        self.assertEqual(raw_candidate, before, "Identity matching must not mutate the SQL item")
        return row, saved, enriched[0]

    def assert_pipeline(self, game, candidate, expected, *, canonical="游戏库规范显示名称", modes=None):
        for mode in modes or self.modes:
            for selected in (False, True):
                with self.subTest(game=game, product=candidate["product_name"], mode=mode, selected=selected):
                    row, saved, enriched = self.pipeline(
                        game, candidate, mode=mode, selected=selected, canonical=canonical,
                    )
                    self.assertEqual(row["auto_apply"], expected, row["message"])
                    self.assertEqual(saved, expected, "Recommendation/core binding disagree")
                    self.assertEqual(contract_game_matches(game, candidate), expected)
                    self.assertEqual(enriched["original_product_name"], candidate["product_name"])
                    if candidate["commercial_variant"]:
                        self.assertEqual(enriched["original_commercial_variant"], candidate["commercial_variant"])
                    for key in ("share_rate", "channel_fee_rate", "invoice_tax_rate", "platform",
                                "authorization_start", "authorization_end"):
                        self.assertEqual(enriched[key], candidate[key])
                    if expected:
                        self.assertEqual(row["match"]["access_item_id"], "access")
                        self.assertEqual(row["recommended"]["share_rate"], 23)
                        self.assertEqual(row["recommended"]["channel_fee_rate"], 0)
                    elif selected:
                        self.assertTrue(row["selection_error"])
                        self.assertIsNone(row["match"])
                        self.assertIsNone(row["recommended"])

    def test_same_original_discount_name_matches_after_real_projection(self):
        self.assert_pipeline("测试游戏折扣服0.05折", self.candidate(), True)

    def test_terminal_ios_without_delimiter_matches_only_with_ios_coverage(self):
        self.assert_pipeline("测试游戏折扣服0.05折ios", self.candidate(platform="iOS"), True)
        self.assert_pipeline("测试游戏折扣服0.05折IOS", self.candidate(platform="iOS / Android"), True)
        self.assert_pipeline(
            "测试游戏折扣服0.05折ios", self.candidate("测试游戏折扣服0.05折ios", platform="iOS"), True,
        )

    def test_terminal_devices_cannot_cross_platform_after_registry_enrichment(self):
        for game, platform in (
            ("测试游戏折扣服0.05折ios", "Android"),
            ("测试游戏折扣服0.05折-ios", "Android"),
            ("测试游戏折扣服0.05折-Android", "iOS"),
        ):
            self.assert_pipeline(game, self.candidate(platform=platform), False)
        # Even identical bill/product suffixes cannot override a contradictory
        # platform declaration on the underlying cooperation item.
        self.assert_pipeline(
            "测试游戏折扣服0.05折ios", self.candidate("测试游戏折扣服0.05折ios", platform="Android"), False,
        )

    def test_marketing_edition_cannot_become_plain_discount_even_with_equal_registry_id(self):
        self.assert_pipeline(
            "测试游戏3折", self.candidate("测试游戏（3折三国争霸）", "3折", "全版本"), False,
            canonical="测试游戏3折",
        )

    def test_generic_title_cannot_select_an_explicit_discount_edition(self):
        # No authoritative edition alias was declared: a broad title or registry
        # ID does not certify a contract's explicit discounted marketing SKU.
        self.assert_pipeline(
            "测试游戏", self.candidate("测试游戏（内置0.1折正版放置手游）", "0.1折", "全版本"), False,
            canonical="测试游戏",
        )

    def test_plain_discount_cannot_become_marketing_edition_even_with_equal_registry_id(self):
        self.assert_pipeline(
            "测试游戏（3折三国争霸）", self.candidate("测试游戏3折", "3折", "全版本"), False,
            canonical="测试游戏3折",
        )

    def test_exact_marketing_edition_remains_eligible(self):
        self.assert_pipeline(
            "测试游戏（3折三国争霸）", self.candidate("测试游戏（3折三国争霸）", "3折", "全版本"), True,
        )

    def test_conflicting_structured_discount_never_replaces_original_explicit_discount(self):
        # Neither the old name nor the rewritten name can certify internally
        # contradictory contract evidence; require correction of the source.
        candidate = self.candidate("测试游戏（0.05折）", "0.1折", "全版本")
        for game in ("测试游戏（0.05折）", "测试游戏（0.1折）"):
            self.assert_pipeline(game, candidate, False)

    def test_different_explicit_discounts_remain_incompatible(self):
        self.assert_pipeline(
            "测试游戏0.1折", self.candidate("测试游戏（0.05折）", "0.05折", "全版本"), False,
            canonical="游戏库统一名称",
        )

    def test_structured_named_edition_cannot_conflict_with_or_invent_original_edition(self):
        for product, variant in (
            ("测试游戏0.05折普通版", "0.05折红包版"),
            ("测试游戏普通版", "红包版"),
            ("测试游戏0.05折", "0.05折红包版"),
            ("测试游戏0.05折红包版", "0.05折普通版"),
        ):
            self.assert_pipeline(product, self.candidate(product, variant, "全版本"), False)

    def test_two_declared_named_editions_are_ambiguous_even_when_names_agree(self):
        for product, variant in (
            ("测试游戏0.05折红包版", "0.05折红包版普通版"),
            ("测试游戏0.05折红包版普通版", "0.05折红包版普通版"),
            ("测试游戏0.05折红包版普通版", "0.05折红包版"),
            ("测试游戏红包版普通版", "红包版普通版"),
        ):
            self.assert_pipeline(product, self.candidate(product, variant, "全版本"), False)

    def test_matching_structured_named_editions_keep_numeric_and_named_identity(self):
        for product, variant in (
            ("测试游戏0.05折红包版", "0.05折红包版"),
            ("测试游戏0.05折普通版", "0.05折普通版"),
            ("测试游戏红包版0.05折", "0.05折红包版"),
            ("测试游戏红包版", "红包版"),
            ("测试游戏普通版", "普通版"),
        ):
            self.assert_pipeline(product, self.candidate(product, variant, "全版本"), True)

    def test_prefix_editions_cannot_bypass_original_identity_via_shared_registry(self):
        # Edition words before the discount yield different discount prefixes;
        # a prefix-only guard misses all three shared-registry substitutions.
        for product, game, variant in (
            ("测试游戏红包版0.05折", "测试游戏0.1折", "0.05折"),
            ("测试游戏红包版0.05折", "测试游戏普通版0.05折", "0.05折"),
            ("测试游戏红包版", "测试游戏普通版", ""),
        ):
            self.assert_pipeline(
                game, self.candidate(product, variant, "全版本"), False,
                canonical="游戏库统一名称", modes=("access_link", "registry_alias"),
            )

    def test_ordinary_registry_alias_remains_eligible_for_automatic_recommendation(self):
        for mode in ("access_link", "registry_alias"):
            with self.subTest(mode=mode):
                row, saved, _ = self.pipeline(
                    "普通测试游戏渠道名", self.candidate("普通测试游戏合同名", "", "全版本"),
                    mode=mode, selected=False, canonical="普通测试游戏",
                )
                self.assertTrue(row["auto_apply"], row["message"])
                self.assertEqual(row["recommended"]["share_rate"], 23)
                self.assertFalse(row.get("commercial_identity_conflict"))
                # Ordinary auto-recommendation aliases retain existing support;
                # durable explicit binding still requires the actual source SKU.
                self.assertFalse(saved)

    def test_unrelated_commercial_candidate_does_not_poison_registry_fallback(self):
        game = "普通测试游戏"
        lines = enrich_lines_with_game_ids(
            _Registry([game], canonical=game),
            [{"game_name": game, "settlement_cycle": "2026-01"}],
        )
        raw = self.candidate("无关冒险游戏红包版0.05折", "0.05折", "全版本")
        projected = _project_variant_into_name(raw)
        candidates = enrich_candidates_with_game_ids(
            _Registry(
                [raw["product_name"], projected["product_name"]], canonical="另一个规范游戏",
                game_id="unrelated-registry-game",
            ),
            [projected],
        )
        self.assertNotEqual(lines[0]["game_id"], candidates[0]["game_id"])
        result = channel.recommend_channel_rules(
            self.partner["name"], self.partner["short_name"], lines,
            _scope_linked_candidates(candidates, self.partner), verified_partner_id=self.partner["id"],
        )
        self.assertFalse(result["lines"][0]["auto_apply"])
        self.assertFalse(result["lines"][0].get("commercial_identity_conflict"))
        result = self.finish_with_registry_fallback(result, lines)
        row = result["lines"][0]
        self.assertTrue(row["auto_apply"], row["message"])
        self.assertEqual(result["registry_fallback_count"], 1)
        self.assertEqual(row["rule_source"], "game_registry")
        self.assertEqual(row["recommended"]["share_rate"], 99)

    def assert_safe_candidate_wins(self, game, safe, conflicting):
        conflicting.update(access_item_id="conflicting-access", share_rate=88)
        for mode in ("access_link", "registry_alias"):
            for selected in (False, True):
                for raw_candidates in ([safe, conflicting], [conflicting, safe]):
                    with self.subTest(mode=mode, selected=selected, first=raw_candidates[0]["access_item_id"]):
                        projected = [_project_variant_into_name(item) for item in raw_candidates]
                        conn = _Registry(
                            [game, *(item["product_name"] for item in projected)],
                            mode=mode, canonical="游戏库统一名称",
                        )
                        lines = enrich_lines_with_game_ids(conn, [{
                            "game_name": game, "settlement_cycle": "2026-01",
                            "access_item_id": "access" if selected else "",
                        }])
                        candidates = enrich_candidates_with_game_ids(conn, projected)
                        self.assertEqual({item["game_id"] for item in candidates}, {lines[0]["game_id"]})
                        result = channel.recommend_channel_rules(
                            self.partner["name"], self.partner["short_name"], lines,
                            _scope_linked_candidates(candidates, self.partner),
                            verified_partner_id=self.partner["id"],
                        )
                        result = self.finish_with_registry_fallback(result, lines)
                        row = result["lines"][0]
                        self.assertTrue(row["auto_apply"], row["message"])
                        self.assertFalse(row.get("commercial_identity_conflict"))
                        self.assertEqual(row["match"]["access_item_id"], "access")
                        self.assertEqual(row["recommended"]["share_rate"], 23)
                        self.assertEqual(result["registry_fallback_count"], 0)
                        self.assertTrue(contract_game_matches(game, safe))
                        self.assertFalse(contract_game_matches(game, conflicting))

    def test_exact_safe_candidate_wins_beside_conflicting_shared_registry_alias(self):
        game = "测试游戏普通版0.05折"
        self.assert_safe_candidate_wins(
            game, self.candidate(game, "0.05折", "全版本"),
            self.candidate("测试游戏红包版0.05折", "0.05折", "全版本"),
        )

    def test_matching_structured_candidate_wins_beside_same_name_with_wrong_structured_edition(self):
        game = "测试游戏0.05折普通版"
        self.assert_safe_candidate_wins(
            game, self.candidate(game, "0.05折普通版", "全版本"),
            self.candidate(game, "0.05折红包版", "全版本"),
        )

    def test_no_contract_match_still_uses_matching_registry_rule(self):
        game = "没有合同的测试游戏0.05折"
        lines = enrich_lines_with_game_ids(
            _Registry([game], canonical=game),
            [{"game_name": game, "settlement_cycle": "2026-01"}],
        )
        result = channel.recommend_channel_rules(
            self.partner["name"], self.partner["short_name"], lines, [],
            verified_partner_id=self.partner["id"],
        )
        original = result["lines"][0]
        self.assertFalse(original["auto_apply"])
        self.assertFalse(original.get("commercial_identity_conflict"))
        self.assertFalse(original.get("platform_conflict"))
        result = self.finish_with_registry_fallback(
            result, lines, catalog={"contract_count": 0, "access_item_count": 0},
        )
        row = result["lines"][0]
        self.assertEqual(result["registry_fallback_count"], 1)
        self.assertTrue(result["auto_apply"])
        self.assertTrue(row["auto_apply"])
        self.assertEqual(row["rule_source"], "game_registry")
        self.assertEqual(row["registry_rule"]["id"], "manual-registry-rule")
        self.assertEqual(row["recommended"]["share_rate"], 99)
        self.assertIn("游戏库", row["message"])
        self.assertNotIn("客户库目前没有关联的合同", row["message"])

    def test_projection_preserves_original_edition_and_is_idempotent(self):
        for product, variant in (
            ("测试游戏折扣服0.05折", "0.05折"),
            ("测试游戏（3折三国争霸）", "3折"),
            ("测试游戏（0.05折）", "0.1 折"),
            ("测试游戏0.05折普通版", "0.05折红包版"),
            ("测试游戏红包版0.05折", "0.05 折红包版"),
            ("测试游戏普通版", "普通版"),
            ("测试游戏红包版", "红包版普通版"),
        ):
            with self.subTest(product=product, variant=variant):
                raw = self.candidate(product, variant)
                snapshot = deepcopy(raw)
                first = _project_variant_into_name(raw)
                second = _project_variant_into_name(first)
                self.assertEqual(first["original_product_name"], product)
                self.assertEqual(first["original_commercial_variant"], variant)
                self.assertEqual(second["original_commercial_variant"], variant)
                self.assertEqual(second, first)
                self.assertEqual(raw, snapshot)
                if "三国争霸" in product:
                    self.assertIn("三国争霸", first["product_name"])
                    self.assertNotEqual(financial_game_key(first["product_name"]), financial_game_key("测试游戏3折"))

    def test_registry_enrichment_keeps_original_name_and_is_idempotent(self):
        raw = self.candidate("测试游戏（3折三国争霸）", "3折", "全版本")
        projected = _project_variant_into_name(raw)
        snapshot = deepcopy(projected)
        for mode in self.modes:
            with self.subTest(mode=mode):
                conn = _Registry([raw["product_name"], projected["product_name"], "游戏库规范显示名称"], mode=mode)
                [first] = enrich_candidates_with_game_ids(conn, [projected])
                [second] = enrich_candidates_with_game_ids(conn, [first])
                self.assertEqual(first["original_product_name"], raw["product_name"])
                self.assertEqual(second["original_product_name"], raw["product_name"])
                self.assertEqual(first, second)
                self.assertEqual(projected, snapshot)


if __name__ == "__main__":
    unittest.main()
