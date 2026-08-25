import unittest

from app.services.bank_combination_match import (
    build_exact_combination,
    enrich_auto_dashboard_with_p2,
)


PARTNER = "广东安久科技有限公司"


def candidate(bill_id: str, month: str, amount: float, *, score: float = 50) -> dict:
    return {
        "bill_type": "channel",
        "bill_id": bill_id,
        "bill_number": f"QD-{bill_id}",
        "partner_name": PARTNER,
        "settlement_month": month,
        "game_name": "云上征途",
        "bill_amount": amount,
        "outstanding_amount": amount,
        "recommended_amount": amount,
        "score": score,
        "confidence_level": "medium",
        "reasons": [],
    }


class AnjiuBankCombinationRegressionTest(unittest.TestCase):
    def setUp(self):
        self.first = candidate("anjiu-202412-202502", "2024-12", 5452.51, score=10)
        self.second = candidate("anjiu-202503", "2025-03", 1400.15, score=10)
        self.decoys = [
            candidate(f"decoy-{index}", f"2025-{(index % 8) + 1:02d}", 100 + index, score=99)
            for index in range(20)
        ]

    def test_exact_pair_search_does_not_drop_older_bills_after_top_18(self):
        item = {
            "transaction_id": "tx-anjiu-20250513",
            "direction": "collection",
            "remaining_amount": 6852.66,
            "counterparty_name": PARTNER,
            # The real two bills deliberately rank after >18 newer/high-score rows.
            "candidates": [*self.decoys, self.first, self.second],
        }

        plan = build_exact_combination(item)

        self.assertIsNotNone(plan)
        self.assertEqual(plan["count"], 2)
        self.assertEqual(plan["total_amount"], 6852.66)
        self.assertEqual(plan["confidence_level"], "high")
        self.assertTrue(plan["auto_ready"])
        self.assertEqual(
            {entry["candidate"]["bill_id"] for entry in plan["items"]},
            {"anjiu-202412-202502", "anjiu-202503"},
        )

    def test_main_dashboard_uses_full_pool_not_only_visible_p2_top8(self):
        auto = {
            "stats": {},
            "suggestions": [
                {
                    "transaction_id": "tx-anjiu-20250513",
                    "direction": "collection",
                    "amount": 6852.66,
                    "counterparty_name": PARTNER,
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
                    "transaction_id": "tx-anjiu-20250513",
                    "direction": "collection",
                    "remaining_amount": 6852.66,
                    "counterparty_name": PARTNER,
                    # Simulate the UI/P2 visible shortlist: the required historical
                    # bills are not present in the first eight candidates.
                    "candidates": self.decoys[:8],
                }
            ]
        }
        full_pool = {
            "collection": [*self.decoys, self.first, self.second],
            "payment": [],
        }

        result = enrich_auto_dashboard_with_p2(auto, p2, full_pool=full_pool)
        suggestion = result["suggestions"][0]

        self.assertTrue(suggestion["auto_ready"])
        self.assertEqual(suggestion["confidence_level"], "high")
        self.assertEqual(suggestion["top_score"], 100)
        self.assertTrue(suggestion["candidates"][0]["bill_number"].startswith("组合2张"))
        self.assertEqual(suggestion["candidates"][0]["outstanding_amount"], 6852.66)
        self.assertTrue(any("5452.51" in reason for reason in suggestion["candidates"][0]["reasons"]))
        self.assertTrue(any("1400.15" in reason for reason in suggestion["candidates"][0]["reasons"]))


if __name__ == "__main__":
    unittest.main()
