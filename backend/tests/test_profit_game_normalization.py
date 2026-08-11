import unittest

from app.services.profit_game_normalization import normalize_profit_game_name


class ProfitGameNormalizationTest(unittest.TestCase):
    def test_known_business_suffixes_roll_up_to_mother_game(self):
        cases = {
            "一起来修仙（0.05折）": "一起来修仙",
            "一起来修仙005专服1（闪趣3733联运）": "一起来修仙",
            "一起来修仙005专服2（爱趣）": "一起来修仙",
            "一起来修仙005折混服": "一起来修仙",
            "一起修仙005折服": "一起来修仙",
            "龙吟大陆（内置0.1折正版跑量手游）": "龙吟大陆",
            "魔力契约005": "魔力契约",
            "云上征途 taptap": "云上征途",
            "云上征途005小混": "云上征途",
            "圣树唤歌005": "圣树唤歌",
            "六界飞仙01折霸服版": "六界飞仙",
            "《六界飞仙》0.1折（6月）": "六界飞仙",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(normalize_profit_game_name(raw), expected)

    def test_distinct_real_titles_are_not_fuzzy_merged(self):
        self.assertEqual(normalize_profit_game_name("帝国雄师"), "帝国雄师")
        self.assertEqual(normalize_profit_game_name("帝国时代"), "帝国时代")
        self.assertEqual(normalize_profit_game_name("仙帝神兵"), "仙帝神兵")
        self.assertEqual(normalize_profit_game_name("龙吟大陆"), "龙吟大陆")

    def test_normal_parenthetical_subtitle_is_preserved(self):
        self.assertEqual(normalize_profit_game_name("某游戏（周年庆典）"), "某游戏（周年庆典）")

    def test_empty_value_uses_existing_placeholder(self):
        self.assertEqual(normalize_profit_game_name(None), "未填写产品")


if __name__ == "__main__":
    unittest.main()
