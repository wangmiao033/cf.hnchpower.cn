from __future__ import annotations

import unittest

from v14_main import align_anjiu_tax_mode


class AnjiuRuleAlignmentTests(unittest.TestCase):
    def test_anjiu_changes_only_tax_mode(self):
        source = {
            "lines": [
                {
                    "recommended": {
                        "share_rate": 30,
                        "tax_rate": 0,
                        "channel_fee_mode": "percent",
                        "channel_fee_rate": 5,
                        "tax_mode": "none",
                    }
                }
            ],
            "header_recommendation": {
                "channel_fee_mode": "percent",
                "channel_fee_rate": 5,
                "tax_mode": "none",
            },
            "partner_recommendation": {
                "share_rate": 30,
                "tax_rate": 0,
                "channel_fee_mode": "percent",
                "channel_fee_rate": 5,
                "tax_mode": "none",
            },
        }

        result = align_anjiu_tax_mode(
            source,
            partner_name="广东安久科技有限公司",
            channel_name="游戏fan（安久）",
        )

        self.assertEqual(result["lines"][0]["recommended"]["tax_mode"], "share")
        self.assertEqual(result["header_recommendation"]["tax_mode"], "share")
        self.assertEqual(result["partner_recommendation"]["tax_mode"], "share")
        self.assertEqual(result["lines"][0]["recommended"]["share_rate"], 30)
        self.assertEqual(result["lines"][0]["recommended"]["channel_fee_rate"], 5)
        self.assertEqual(result["lines"][0]["recommended"]["tax_rate"], 0)
        self.assertEqual(source["lines"][0]["recommended"]["tax_mode"], "none")

    def test_other_channel_is_unchanged(self):
        source = {
            "lines": [{"recommended": {"tax_mode": "none", "tax_rate": 6}}],
            "header_recommendation": {"tax_mode": "none"},
        }
        result = align_anjiu_tax_mode(
            source,
            partner_name="其他合作方有限公司",
            channel_name="其他渠道",
        )
        self.assertIs(result, source)
        self.assertEqual(result["lines"][0]["recommended"]["tax_mode"], "none")


if __name__ == "__main__":
    unittest.main()
