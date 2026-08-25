import unittest

from app.services.bank_combination_match import enrich_auto_dashboard_with_p2


def candidate(bill_id, month, amount, score=55):
    return {
        "bill_type": "channel",
        "bill_id": bill_id,
        "bill_number": f"QD-{month}-{bill_id}",
        "partner_name": "广东安久科技有限公司",
        "settlement_month": month,
        "game_name": "测试游戏",
        "bill_amount": amount,
        "outstanding_amount": amount,
        "recommended_amount": min(amount, 6852.66),
        "score": score,
        "confidence_level": "low",
        "reasons": [],
    }


class FilteredHistoricalCombinationTest(unittest.TestCase):
    def test_old_filtered_transaction_does_not_require_p2_dashboard_membership(self):
        auto = {
            "stats": {},
            "suggestions": [
                {
                    "transaction_id": "tx-anjiu-20250513",
                    "trade_date": "2025-05-13",
                    "direction": "collection",
                    "amount": 6852.66,
                    "counterparty_name": "广东安久科技有限公司",
                    "auto_ready": False,
                    "confidence_level": "low",
                    "top_score": 45,
                    "ambiguity_margin": 0,
                    "candidates": [candidate("wrong", "2026-08", 19380.13, score=45)],
                    "blocked_reason": "匹配证据不足，请人工选择账单后确认。",
                }
            ],
        }
        # Historical/filtered transactions can legitimately be absent from the
        # bounded P2 dashboard. Combination discovery must still work from the
        # main-table row plus the complete outstanding-bill pool.
        p2 = {"suggestions": []}
        full_pool = {
            "collection": [
                candidate("older-a", "2024-12~2025-02", 5452.51),
                candidate("older-b", "2025-03", 1400.15),
                candidate("wrong", "2026-08", 19380.13, score=45),
            ],
            "payment": [],
        }

        result = enrich_auto_dashboard_with_p2(auto, p2, full_pool=full_pool)
        suggestion = result["suggestions"][0]

        self.assertTrue(suggestion["auto_ready"])
        self.assertEqual(suggestion["confidence_level"], "high")
        self.assertEqual(suggestion["top_score"], 100)
        self.assertIsNone(suggestion["blocked_reason"])
        self.assertTrue(suggestion["candidates"][0]["bill_number"].startswith("组合2张"))
        self.assertEqual(suggestion["candidates"][0]["outstanding_amount"], 6852.66)


if __name__ == "__main__":
    unittest.main()
