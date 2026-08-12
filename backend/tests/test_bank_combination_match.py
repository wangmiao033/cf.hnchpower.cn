import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services.bank_combination_match import (
    build_exact_combination,
    enrich_auto_dashboard_with_p2,
)
from app.services.bank_reconciliation_engine import _legacy_exact_combination_allocations


def candidate(bill_id, month, amount, partner="重庆天盛网络传媒有限责任公司", score=55):
    return {
        "bill_type": "channel",
        "bill_id": bill_id,
        "bill_number": f"QD-{month}-{bill_id}",
        "partner_name": partner,
        "settlement_month": month,
        "game_name": "测试游戏",
        "bill_amount": amount,
        "outstanding_amount": amount,
        "recommended_amount": amount,
        "score": score,
        "confidence_level": "low",
        "reasons": [],
    }


def transaction():
    return SimpleNamespace(
        id="tx-ts-648522",
        income_amount=6485.22,
        expense_amount=0,
        amount=6485.22,
        payer_name="重庆天盛网络传媒有限责任公司",
        payee_name=None,
    )


class BankCombinationMatchTest(unittest.TestCase):
    def test_tiansheng_two_month_bills_match_6485_22_exactly(self):
        item = {
            "transaction_id": "tx-ts-648522",
            "direction": "collection",
            "remaining_amount": 6485.22,
            "counterparty_name": "重庆天盛网络传媒有限责任公司",
            "candidates": [
                candidate("jan", "2026-01", 3394.37),
                candidate("feb", "2026-02", 3090.85),
                candidate("other", "2026-04", 123.45),
            ],
        }
        plan = build_exact_combination(item)
        self.assertIsNotNone(plan)
        self.assertEqual(plan["count"], 2)
        self.assertEqual(plan["total_amount"], 6485.22)
        self.assertEqual(plan["confidence_level"], "high")
        self.assertTrue(plan["auto_ready"])
        self.assertFalse(plan["ambiguous"])
        self.assertEqual(
            [(entry["candidate"]["bill_id"], entry["amount"]) for entry in plan["items"]],
            [("jan", 3394.37), ("feb", 3090.85)],
        )

    def test_combination_never_crosses_partner(self):
        item = {
            "direction": "collection",
            "remaining_amount": 6485.22,
            "counterparty_name": "重庆天盛网络传媒有限责任公司",
            "candidates": [
                candidate("jan", "2026-01", 3394.37),
                candidate("feb", "2026-02", 3090.85, partner="另一家公司"),
            ],
        }
        self.assertIsNone(build_exact_combination(item))

    def test_multiple_same_rank_exact_combinations_require_manual_choice(self):
        item = {
            "direction": "collection",
            "remaining_amount": 6485.22,
            "counterparty_name": "重庆天盛网络传媒有限责任公司",
            "candidates": [
                candidate("a", "2026-01", 3000.00),
                candidate("b", "2026-02", 3485.22),
                candidate("c", "2026-03", 2000.00),
                candidate("d", "2026-04", 4485.22),
            ],
        }
        plan = build_exact_combination(item)
        self.assertIsNotNone(plan)
        self.assertTrue(plan["ambiguous"])
        self.assertFalse(plan["auto_ready"])
        self.assertEqual(plan["confidence_level"], "medium")
        self.assertLess(plan["score"], 80)

    def test_main_dashboard_injects_unique_combination_as_high_confidence(self):
        auto = {
            "stats": {},
            "suggestions": [
                {
                    "transaction_id": "tx-ts-648522",
                    "direction": "collection",
                    "amount": 6485.22,
                    "counterparty_name": "重庆天盛网络传媒有限责任公司",
                    "auto_ready": False,
                    "confidence_level": "low",
                    "top_score": 0,
                    "ambiguity_margin": 0,
                    "candidates": [],
                    "blocked_reason": "没有找到金额可覆盖且仍有未结余额的账单。",
                }
            ],
        }
        p2 = {
            "suggestions": [
                {
                    "transaction_id": "tx-ts-648522",
                    "direction": "collection",
                    "remaining_amount": 6485.22,
                    "counterparty_name": "重庆天盛网络传媒有限责任公司",
                    "candidates": [
                        candidate("jan", "2026-01", 3394.37),
                        candidate("feb", "2026-02", 3090.85),
                    ],
                }
            ]
        }
        result = enrich_auto_dashboard_with_p2(auto, p2)
        suggestion = result["suggestions"][0]
        self.assertTrue(suggestion["auto_ready"])
        self.assertEqual(suggestion["confidence_level"], "high")
        self.assertEqual(suggestion["top_score"], 100)
        self.assertIsNone(suggestion["blocked_reason"])
        self.assertTrue(suggestion["candidates"][0]["bill_number"].startswith("组合2张"))
        self.assertEqual(suggestion["candidates"][0]["outstanding_amount"], 6485.22)

    def test_existing_one_to_one_auto_ready_keeps_priority(self):
        single = candidate("single", "2026-03", 6485.22, score=100)
        auto = {
            "stats": {},
            "suggestions": [
                {
                    "transaction_id": "tx-ts-648522",
                    "direction": "collection",
                    "amount": 6485.22,
                    "counterparty_name": "重庆天盛网络传媒有限责任公司",
                    "auto_ready": True,
                    "confidence_level": "high",
                    "top_score": 100,
                    "ambiguity_margin": 20,
                    "candidates": [single],
                    "blocked_reason": None,
                }
            ],
        }
        p2 = {
            "suggestions": [
                {
                    "transaction_id": "tx-ts-648522",
                    "direction": "collection",
                    "remaining_amount": 6485.22,
                    "counterparty_name": "重庆天盛网络传媒有限责任公司",
                    "candidates": [
                        single,
                        candidate("jan", "2026-01", 3394.37),
                        candidate("feb", "2026-02", 3090.85),
                    ],
                }
            ]
        }
        result = enrich_auto_dashboard_with_p2(auto, p2)
        self.assertEqual(result["suggestions"][0]["candidates"][0]["bill_id"], "single")
        self.assertFalse(result["suggestions"][0]["candidates"][0]["bill_number"].startswith("组合"))

    def test_legacy_confirm_recomputes_two_real_allocations(self):
        pool = {
            "collection": [
                candidate("jan", "2026-01", 3394.37),
                candidate("feb", "2026-02", 3090.85),
            ],
            "payment": [],
        }
        with patch("app.services.bank_reconciliation_engine._candidate_pool", return_value=pool):
            allocations = _legacy_exact_combination_allocations(
                object(), transaction(), "channel", "jan", 6485.22
            )
        self.assertEqual(
            allocations,
            [
                {"bill_type": "channel", "bill_id": "jan", "amount": 3394.37},
                {"bill_type": "channel", "bill_id": "feb", "amount": 3090.85},
            ],
        )


if __name__ == "__main__":
    unittest.main()
