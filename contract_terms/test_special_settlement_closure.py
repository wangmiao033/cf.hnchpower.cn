from __future__ import annotations

import unittest
from pathlib import Path

import v11_main


class SpecialSettlementClosureTests(unittest.TestCase):
    def test_special_application_with_deviation_is_explicit_override(self):
        self.assertTrue(
            v11_main._is_special_override(
                {
                    "override_reason": "特殊申请，按照IP结算（实收1000）",
                    "deviations": ["分成比例", "通道费率"],
                }
            )
        )

    def test_generic_manual_reason_is_not_auto_approved(self):
        self.assertFalse(
            v11_main._is_special_override(
                {
                    "override_reason": "历史数据按旧口径录入",
                    "deviations": ["分成比例"],
                }
            )
        )

    def test_special_reason_requires_real_contract_deviation(self):
        self.assertFalse(
            v11_main._is_special_override(
                {
                    "override_reason": "特殊申请",
                    "deviations": [],
                }
            )
        )

    def test_special_reason_is_valid_difference_reason(self):
        self.assertIn(v11_main.SPECIAL_SETTLEMENT_REASON, v11_main._v4.REASON_TYPES)

    def test_production_uses_v20_entrypoint_with_v11_business_rules(self):
        root = Path(__file__).resolve().parents[1]
        config = (root / "vercel.json").read_text(encoding="utf-8")
        self.assertIn('"entrypoint": "v20_main:app"', config)

        import v20_main

        self.assertIs(v20_main.app, v11_main.app)
        self.assertIn(v11_main.SPECIAL_SETTLEMENT_REASON, v11_main._v4.REASON_TYPES)


if __name__ == "__main__":
    unittest.main()
