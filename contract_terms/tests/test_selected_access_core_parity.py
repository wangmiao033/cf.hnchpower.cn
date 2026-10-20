"""Cross-service original-SKU fixtures for recommendation and durable binding.

Run with the repository's backend and contract-service test dependencies. The
registry enrichment below uses the production functions, not hand-written
``original_product_name`` fixtures, to exercise the actual candidate data flow.
"""
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

from fastapi import HTTPException

# Load the service-root entrypoint before adding the other service to sys.path;
# both deployed services intentionally have their own module named "main".
import v21_main
from channel_rule_recommender import recommend_channel_rules
from game_identity import enrich_candidates_with_game_ids, enrich_lines_with_game_ids, normalize_registry_game
from v13_main import _prepare_explicit_selection_lines, _scope_linked_candidates, _verified_partner_selection

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
try:
    from app.services.channel_contract_binding import (
        _channel_matches,
        contract_game_matches,
        validate_contract_binding,
    )
finally:
    sys.path.pop(0)


class _Result:
    def __init__(self, rows=None, one=None):
        self.rows, self.one = rows or [], one

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.one


class _Registry:
    def __init__(self, line_name, line_canonical, product_canonical):
        self.line_key = normalize_registry_game(line_name)
        self.line_canonical = line_canonical
        self.product_canonical = product_canonical

    def execute(self, sql, params=None):
        if "to_regclass" in sql:
            return _Result(one={"name": params[0]})
        if "FROM contract_access_game_links" in sql:
            return _Result(rows=[{"access_item_id": "access", "game_id": "product-game"}])
        if "SELECT id, canonical_name" in sql:
            return _Result(rows=[{"id": "product-game", "canonical_name": self.product_canonical}])
        if "normalized_name = ANY" in sql:
            return _Result()
        if "FROM game_registry_aliases AS alias" in sql:
            return _Result(rows=[
                {"normalized_alias": key, "game_id": "line-game", "canonical_name": self.line_canonical}
                for key in params[0] if key == self.line_key
            ])
        return _Result()


class _PartnerConnection:
    def __init__(self, partner, exact_ids=None):
        self.partner = partner
        self.exact_ids = exact_ids if exact_ids is not None else [partner["id"]]

    def execute(self, sql, params=None):
        if "WHERE id =" in sql:
            return _Result(one=self.partner)
        return _Result(rows=[{"id": value} for value in self.exact_ids])


class _NoRegistry:
    def execute(self, sql, params=None):
        return _Result()


class SelectedAccessCoreParityTests(unittest.TestCase):
    partner = {"id": "partner", "name": "测试客户有限公司", "short_name": "测试渠道（聚合）"}

    def candidate(self, product="测试游戏005折", platform="全版本", **overrides):
        return {
            "access_item_id": "access", "contract_id": "contract",
            "partner_id": "partner", "partner_name": self.partner["name"],
            "partner_short_name": self.partner["short_name"], "counterparty": self.partner["name"],
            "product_name": product, "platform": platform, "channel_name": "测试渠道",
            "authorization_start": "2020-01-01", "authorization_end": "2028-12-31",
            "share_rate": 23, "channel_fee_rate": 0, "invoice_tax_rate": 0,
            "access_status": "生效", "performance_status": "履约中", **overrides,
        }

    def both(self, game, raw_candidate, *, line_canonical=None, product_canonical=None, line_platform=""):
        raw_line = {
            "game_name": game, "settlement_cycle": "2026-01",
            "access_item_id": "access", "platform": line_platform,
        }
        conn = _Registry(game, line_canonical or game, product_canonical or raw_candidate["product_name"])
        lines = enrich_lines_with_game_ids(conn, [raw_line])
        candidates = enrich_candidates_with_game_ids(conn, [raw_candidate])
        self.assertEqual(candidates[0]["original_product_name"], raw_candidate["product_name"])
        self.assertEqual(lines[0]["input_game_name"], game)
        candidates = _scope_linked_candidates(candidates, self.partner)
        recommendation = recommend_channel_rules(
            self.partner["name"], self.partner["short_name"], lines, candidates,
            verified_partner_id=self.partner["id"],
        )["lines"][0]
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
        except HTTPException:
            saved = False
        return recommendation, saved

    def test_original_names_and_platforms_share_positive_and_negative_fixtures(self):
        fixtures = [
            ("普通全版本", "测试游戏005折", "测试游戏005折", "全版本", True),
            ("设备全版本", "测试游戏（0.05折）-ios", "测试游戏005折", "全版本", True),
            ("双平台声明", "测试游戏005折-ios", "测试游戏005折", "iOS / Android", True),
            ("同设备后缀", "测试游戏005折-ios", "测试游戏005折_ios", "", True),
            ("跨设备", "测试游戏005折-ios", "测试游戏005折", "Android", False),
            ("未知账单设备", "测试游戏005折", "测试游戏005折", "iOS", False),
            ("未知合同设备", "测试游戏005折-ios", "测试游戏005折", "", False),
            ("后缀不可扩张", "测试游戏005折-Android", "测试游戏005折-ios", "全版本", False),
            ("不同折扣", "测试游戏005折-ios", "测试游戏01折", "全版本", False),
            ("不同商业版", "测试游戏(0.05折红包版)-ios", "测试游戏(0.05折普通版)", "全版本", False),
            ("别名不能代替原SKU", "渠道专用名", "合同专用名", "全版本", False),
        ]
        for label, game, product, platform, expected in fixtures:
            with self.subTest(case=label):
                candidate = self.candidate(product, platform)
                row, saved = self.both(
                    game, candidate, line_canonical="游戏库统一名称", product_canonical="游戏库统一名称",
                )
                self.assertEqual(contract_game_matches(game, candidate), expected)
                self.assertEqual(row["auto_apply"], expected, row["message"])
                self.assertEqual(saved, expected)

    def test_different_registry_display_names_do_not_hide_exact_original_sku(self):
        row, saved = self.both(
            "测试游戏005折-ios", self.candidate(),
            line_canonical="账单规范名称", product_canonical="清单规范名称",
        )
        self.assertTrue(row["auto_apply"], row["message"])
        self.assertTrue(saved)
        self.assertEqual(row["match"]["product_name"], "测试游戏005折")

    def test_explicit_canonical_discount_guard_is_intentionally_more_conservative(self):
        row, saved = self.both(
            "测试游戏005折-ios", self.candidate(),
            line_canonical="测试游戏01折", product_canonical="测试游戏01折",
        )
        # The raw SQL item is a valid SKU, but recommendation still rejects an
        # explicitly contradictory registry discount. Never weaken that guard.
        self.assertTrue(saved)
        self.assertFalse(row["auto_apply"])
        self.assertTrue(row["selection_error"])

    def test_unlinked_or_different_customer_cannot_claim_a_durable_selection(self):
        for partner_id in ("", None, "different-partner"):
            with self.subTest(partner_id=partner_id):
                row, saved = self.both("测试游戏005折", self.candidate(partner_id=partner_id))
                self.assertFalse(row["auto_apply"])
                self.assertFalse(saved)
                self.assertTrue(row["selection_error"])

    def test_metadata_only_device_cannot_certify_a_nonpersisted_platform(self):
        row, saved = self.both("测试游戏005折", self.candidate(platform="iOS"), line_platform="iOS")
        self.assertFalse(row["auto_apply"])
        self.assertFalse(saved)
        self.assertIn("平台", row["selection_error"])

    def test_missing_verified_customer_id_is_not_inferred_from_display_name(self):
        row = recommend_channel_rules(
            self.partner["name"], self.partner["short_name"],
            [{"game_name": "测试游戏005折", "settlement_cycle": "2026-01", "access_item_id": "access"}],
            [self.candidate()],
        )["lines"][0]
        self.assertFalse(row["auto_apply"])
        self.assertIn("客户身份", row["selection_error"])

    def test_explicit_customer_requires_exact_unique_saved_name(self):
        for name in (self.partner["name"], self.partner["short_name"]):
            with self.subTest(name=name):
                selected = _verified_partner_selection(
                    _PartnerConnection(self.partner), self.partner["id"], name, for_binding=True,
                )
                self.assertEqual(selected["id"], self.partner["id"])
        # Legacy auto recommendation still tolerates normalized company labels.
        self.assertIsNotNone(_verified_partner_selection(
            _PartnerConnection(self.partner), self.partner["id"], "测试客户",
        ))
        with self.assertRaises(HTTPException) as mismatch:
            _verified_partner_selection(
                _PartnerConnection(self.partner), self.partner["id"], "测试客户", for_binding=True,
            )
        self.assertIn("原始名称", mismatch.exception.detail)
        with self.assertRaises(HTTPException) as duplicate:
            _verified_partner_selection(
                _PartnerConnection(self.partner, ["partner", "same-name-other"]),
                self.partner["id"], self.partner["name"], for_binding=True,
            )
        self.assertIn("未唯一", duplicate.exception.detail)

    def test_client_original_name_cannot_forge_another_discount_identity(self):
        forged = {
            "game_name": "测试游戏01折-ios", "input_game_name": "测试游戏005折-ios",
            "game_identity_source": "registry", "game_id": "forged-game", "gameId": "forged-game",
            "settlement_cycle": "2026-01", "access_item_id": "access",
        }
        prepared = _prepare_explicit_selection_lines([forged])
        self.assertEqual(prepared[0]["game_name"], forged["game_name"])
        for key in ("input_game_name", "game_identity_source", "game_id", "gameId"):
            self.assertNotIn(key, prepared[0])
        lines = enrich_lines_with_game_ids(_NoRegistry(), prepared)
        row = recommend_channel_rules(
            self.partner["name"], self.partner["short_name"], lines, [self.candidate()],
            verified_partner_id=self.partner["id"],
        )["lines"][0]
        self.assertFalse(row["auto_apply"])
        self.assertFalse(contract_game_matches(forged["game_name"], self.candidate()))
        self.assertTrue(row["selection_error"])
        # Unselected historical calls retain their existing metadata behavior.
        unselected = {**forged, "access_item_id": ""}
        self.assertEqual(_prepare_explicit_selection_lines([unselected])[0], unselected)

    def test_channel_blank_and_trusted_alias_rules_match_between_services(self):
        fixtures = [
            ("", "", "", True),
            ("", "测试渠道", "", True),
            ("测试渠道", "", "", True),
            ("测试 渠道", "测试-渠道", "", True),
            ("测试渠道（聚合）", "测试渠道", "测试渠道（聚合）", True),
            ("测试渠道（聚合）", "测试渠道", "其他渠道", False),
            ("巴掌(7723\\集网)", "7723", "巴掌(7723\\集网)", True),
            ("巴掌(7723集团)", "7724", "巴掌(7723集团)", False),
            ("巴掌(7723集团)", "7723(iOS)", "巴掌(7723集团)", False),
            ("其他渠道", "测试渠道", "", False),
        ]
        for bill, candidate, short, expected in fixtures:
            with self.subTest(bill=bill, candidate=candidate, short=short):
                self.assertEqual(_channel_matches(bill, candidate, short), expected)
                self.assertEqual(v21_main._channel_compatible(bill, candidate, short), expected)


if __name__ == "__main__":
    unittest.main()
