"""Compact source labels retain their coefficient through the production pipeline."""
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_original_candidate_pipeline as pipeline_tests
import channel_rule_recommender as channel


class CompactDiscountPipelineTests(unittest.TestCase):
    def setUp(self):
        blocker = patch("psycopg.connect", side_effect=AssertionError("No live database"))
        blocker.start()
        self.addCleanup(blocker.stop)
        self.pipeline = pipeline_tests.OriginalCandidatePipelineTests()

    def test_base_direct_import_is_correct_before_version_modules_load(self):
        # A fresh process prevents V19's monkey-patch or test order from hiding
        # the stale direct-import bug in the base recommender.
        code = """
import json, sys
import channel_rule_recommender as c
assert 'v19_main' not in sys.modules
print(json.dumps([c._discount_factor_from_game_name(s) for s in
 ['测试005折混服', '测试01折', '测试05折', '测试0.05折', '测试3折', '测试10折', '测试005', '测试0折', '测试00折']]))
"""
        result = subprocess.run(
            [sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1],
            capture_output=True, text=True, check=True,
        )
        self.assertEqual(json.loads(result.stdout), [.005, .01, .05, .005, .3, 1, None, None, None])

    def test_original_factor_survives_projection_registry_recommendation_and_core(self):
        cases = (
            ("测试游戏005折混服", "0.05折", .005),
            ("测试游戏01折", "0.1折", .01),
            ("测试游戏0050折", "0.05折", .005),
            ("测试游戏0005折", "0.005折", .0005),
            ("测试游戏005折红包版", "0.05折", .005),
            ("测试游戏005折Android", "0.05折", .005),
            ("测试游戏05折", "0.5折", .05),
            ("测试游戏0.05折", "0.05折", .005),
            ("测试游戏0.1折", "0.1折", .01),
            ("测试游戏0.005折", "0.005折", .0005),
            ("测试游戏0.01折", "0.01折", .001),
            ("测试游戏3折", "3折", .3),
            ("测试游戏10折", "10折", 1),
            ("测试游戏005折iOS", "0.05折", .005),
            ("测试游戏００５折混服", "0.05折", .005),
        )
        for game, variant, factor in cases:
            for mode in self.pipeline.modes:
                for selected in (False, True):
                    with self.subTest(game=game, mode=mode, selected=selected):
                        row, saved, candidate = self.pipeline.pipeline(
                            game, self.pipeline.candidate(game, variant, "全版本"),
                            mode=mode, selected=selected, canonical="游戏库不带折扣的显示名称",
                        )
                        self.assertTrue(row["auto_apply"], row["message"])
                        self.assertTrue(saved)
                        self.assertEqual(row["game_name"], game)
                        self.assertEqual(candidate["original_product_name"], game)
                        self.assertEqual(row["recommended"]["discount_factor"], factor)

    def test_no_discount_word_does_not_invent_coefficient_from_registry_title(self):
        for game in ("测试游戏005", "测试游戏", "测试游戏ios"):
            self.assertIsNone(channel._discount_factor_from_game_name(game))
            for mode in self.pipeline.modes:
                for canonical in ("注册显示游戏", "注册显示游戏3折"):
                    row, saved, _ = self.pipeline.pipeline(
                        game, self.pipeline.candidate(game, "", "全版本"),
                        mode=mode, selected=True, canonical=canonical,
                    )
                    self.assertTrue(saved)
                    # A canonical title cannot add commercial evidence to a
                    # source without a discount. Existing explicit conflicts
                    # remain blocked rather than generating a fallback factor.
                    expected = mode == "absent" or canonical == "注册显示游戏"
                    self.assertEqual(row["auto_apply"], expected, row["message"])
                    self.assertNotIn("discount_factor", row["recommended"] or {})

    def test_different_registry_discount_still_blocks_automatic_rule(self):
        for mode in ("access_link", "registry_alias"):
            for selected in (False, True):
                row, _, _ = self.pipeline.pipeline(
                    "测试游戏005折", self.pipeline.candidate("测试游戏005折", "0.05折", "全版本"),
                    mode=mode, selected=selected, canonical="测试游戏01折",
                )
                self.assertFalse(row["auto_apply"])
                self.assertIsNone(row["recommended"])

    def test_compact_conflict_returns_no_rule_or_coefficient_to_overwrite(self):
        for game, product, variant, platform in (
            ("测试游戏005折", "测试游戏01折", "0.1折", "全版本"),
            ("测试游戏005折普通版", "测试游戏005折红包版", "0.05折", "全版本"),
            ("测试游戏005折iOS", "测试游戏005折", "0.05折", "Android"),
            ("测试游戏005折", "测试游戏005折", "0.1折", "全版本"),
        ):
            self.pipeline.assert_pipeline(
                game, self.pipeline.candidate(product, variant, platform), False,
            )


if __name__ == "__main__":
    unittest.main()
