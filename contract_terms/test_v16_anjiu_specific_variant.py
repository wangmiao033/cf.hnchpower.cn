from __future__ import annotations

import unittest

import v16_main


def _result(*, amount_status: str = "pass", exact_contract: bool = False) -> dict:
    contract_product = (
        "云上征途（0.1折齐天伏魔）" if exact_contract else "云上征途（0.1折）"
    )
    return {
        "bill": {
            "bill_type": "channel",
            "partner_name": "广东安久科技有限公司",
            "channel_name": "游戏fan（安久）",
        },
        "summary": {"fail_count": 1, "overall_status": "fail"},
        "lines": [
            {
                "line_id": "line-1",
                "game_name": "云上征途（0.1折齐天伏魔）",
                "settlement_cycle": "2026-02",
                "status": "fail",
                "match": {
                    "product_name": contract_product,
                    "confidence": "high",
                    "score": 90,
                },
                "checks": [
                    {
                        "key": "share_rate",
                        "status": "fail",
                        "bill_value": 30,
                        "contract_value": 25,
                        "difference": 5,
                    },
                    {
                        "key": "channel_fee_rate",
                        "status": "fail",
                        "bill_value": 5,
                        "contract_value": 0,
                        "difference": 5,
                    },
                ],
                "contract_amount": {
                    "status": amount_status,
                    "supported": True,
                    "deterministic": True,
                    "expected_amount": 0 if amount_status == "pass" else 10,
                    "actual_amount": 0,
                    "difference_amount": 0 if amount_status == "pass" else -10,
                },
            }
        ],
        "bill_checks": [],
    }


class AnjiuSpecificVariantTests(unittest.TestCase):
    def test_generic_discount_contract_rate_mismatch_becomes_warning_when_amount_passes(self):
        result = v16_main.normalize_anjiu_specific_variant_rate_checks(_result())
        line = result["lines"][0]
        statuses = {check["key"]: check["status"] for check in line["checks"]}
        self.assertEqual(statuses["share_rate"], "manual")
        self.assertEqual(statuses["channel_fee_rate"], "manual")
        self.assertEqual(line["status"], "warning")
        self.assertEqual(result["summary"]["fail_count"], 0)
        self.assertEqual(result["summary"]["warning_count"], 1)

    def test_amount_difference_still_blocks(self):
        result = v16_main.normalize_anjiu_specific_variant_rate_checks(
            _result(amount_status="fail")
        )
        line = result["lines"][0]
        self.assertEqual(line["status"], "fail")
        self.assertTrue(any(check["status"] == "fail" for check in line["checks"]))

    def test_exact_contract_variant_still_uses_strict_rates(self):
        result = v16_main.normalize_anjiu_specific_variant_rate_checks(
            _result(exact_contract=True)
        )
        line = result["lines"][0]
        self.assertEqual(line["status"], "fail")
        self.assertEqual(line["checks"][0]["status"], "fail")

    def test_non_anjiu_is_untouched(self):
        source = _result()
        source["bill"]["partner_name"] = "其他合作方有限公司"
        source["bill"]["channel_name"] = "其他渠道"
        result = v16_main.normalize_anjiu_specific_variant_rate_checks(source)
        self.assertEqual(result["lines"][0]["status"], "fail")

    def test_detects_generic_base_variant(self):
        self.assertTrue(
            v16_main._generic_discount_contract_for_specific_variant(
                "云上征途（0.1折齐天伏魔）",
                "云上征途（0.1折）",
            )
        )
        self.assertFalse(
            v16_main._generic_discount_contract_for_specific_variant(
                "云上征途（0.1折齐天伏魔）",
                "云上征途（0.1折齐天伏魔）",
            )
        )


if __name__ == "__main__":
    unittest.main()
