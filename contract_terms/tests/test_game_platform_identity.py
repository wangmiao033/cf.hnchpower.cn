import unittest

from game_platform_identity import (
    contract_access_matches_line,
    financial_game_key,
    platform_compatible,
    split_device_suffix,
)


class GamePlatformIdentityTests(unittest.TestCase):
    def test_only_terminal_delimited_device_suffixes_are_removed(self):
        for suffix in ("-ios", "_IOS", " (ios)", " ios", "-Android", "_android", "(ANDROID)", " Android"):
            with self.subTest(suffix=suffix):
                name, device = split_device_suffix("一起来修仙005折" + suffix)
                self.assertEqual(name, "一起来修仙005折")
                self.assertIn(device, {"ios", "android"})
        for name in ("一起来修仙ios", "一起来修仙-ios红包版", "一起来修仙(ios", "一起来修仙-ios)"):
            with self.subTest(name=name):
                self.assertEqual(split_device_suffix(name), (name, ""))

    def test_discount_aliases_match_without_erasing_true_editions(self):
        self.assertEqual(financial_game_key("一起来修仙005折-ios"), financial_game_key("一起来修仙（0.05折）"))
        for name in ("一起来修仙01折", "一起来修仙（0.05折红包版）", "一起来修仙（0.05折普通版）"):
            self.assertNotEqual(financial_game_key("一起来修仙005折-ios"), financial_game_key(name))
        self.assertNotEqual(financial_game_key("游戏（红包版）-ios"), financial_game_key("游戏（普通版）"))

    def test_all_platform_item_covers_ordinary_ios_and_android_names(self):
        for platform in ("全版本", "all", "all platforms", "Android / iOS"):
            for game in ("游戏005折", "游戏005折-ios", "游戏（0.05折）_Android"):
                with self.subTest(platform=platform, game=game):
                    self.assertTrue(contract_access_matches_line(game, {"product_name": "游戏005折", "platform": platform}))

    def test_specific_or_unknown_platform_is_not_inferred(self):
        for line, product, platform in (
            ("游戏-ios", "游戏", "Android"),
            ("游戏-Android", "游戏", "iOS"),
            ("游戏", "游戏", "iOS"),
            ("游戏", "游戏", "Android"),
            ("游戏-ios", "游戏", ""),
            ("游戏-ios", "游戏-Android", "全版本"),
            ("游戏", "游戏-ios", "全版本"),
            ("游戏-ios", "游戏-ios", "Android"),
        ):
            with self.subTest(line=line, product=product, platform=platform):
                self.assertFalse(platform_compatible(line, product, candidate_platform=platform))

    def test_explicit_device_metadata_is_usable_but_cannot_conflict_with_name(self):
        self.assertTrue(platform_compatible("游戏", "游戏", "iOS", "iOS"))
        self.assertFalse(platform_compatible("游戏-ios", "游戏", "Android", "全版本"))
        self.assertTrue(platform_compatible("游戏-ios", "游戏-ios", candidate_platform=""))
        self.assertTrue(platform_compatible("游戏", "游戏", candidate_platform=""))


if __name__ == "__main__":
    unittest.main()
