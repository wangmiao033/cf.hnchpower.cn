from __future__ import annotations

import unittest

import main


class CommercialVariantInferenceTests(unittest.TestCase):
    def test_common_discount_versions_are_normalized(self):
        cases = {
            "圣树唤歌（0.05折）": "0.05折",
            "圣树唤歌 0.1 折版": "0.1折",
            "云上征途-3折": "3折",
            "游戏（1.00折）": "1折",
        }
        for product_name, expected in cases.items():
            with self.subTest(product_name=product_name):
                self.assertEqual(main._infer_commercial_variant(product_name), expected)

    def test_non_discount_name_has_no_structured_variant(self):
        self.assertEqual(main._infer_commercial_variant("普通版本游戏"), "")

    def test_named_discount_version_is_supported(self):
        self.assertEqual(main._infer_commercial_variant("某游戏-折扣版"), "折扣版")


if __name__ == "__main__":
    unittest.main()
