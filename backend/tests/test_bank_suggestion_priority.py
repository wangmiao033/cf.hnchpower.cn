import unittest

from app.services.bank_suggestion_priority import prioritize_bank_suggestions


class BankSuggestionPriorityTests(unittest.TestCase):
    def test_high_confidence_and_higher_score_come_first(self):
        payload = {
            "suggestions": [
                {"transaction_id": "low", "confidence_level": "low", "top_score": 58, "trade_date": "2026-08-15"},
                {"transaction_id": "high-82", "confidence_level": "high", "top_score": 82, "ambiguity_margin": 12, "trade_date": "2026-08-10"},
                {"transaction_id": "medium", "confidence_level": "medium", "top_score": 76, "trade_date": "2026-08-15"},
                {"transaction_id": "high-96", "confidence_level": "high", "top_score": 96, "ambiguity_margin": 18, "trade_date": "2026-08-01"},
                {"transaction_id": "none", "confidence_level": "none", "top_score": 0, "trade_date": "2026-08-15"},
            ]
        }

        result = prioritize_bank_suggestions(payload)
        self.assertEqual(
            [item["transaction_id"] for item in result["suggestions"]],
            ["high-96", "high-82", "medium", "low", "none"],
        )

    def test_ties_prefer_larger_margin_then_newer_date(self):
        payload = {
            "suggestions": [
                {"transaction_id": "older", "confidence_level": "high", "top_score": 90, "ambiguity_margin": 10, "trade_date": "2026-08-01"},
                {"transaction_id": "newer", "confidence_level": "high", "top_score": 90, "ambiguity_margin": 10, "trade_date": "2026-08-14"},
                {"transaction_id": "clearer", "confidence_level": "high", "top_score": 90, "ambiguity_margin": 25, "trade_date": "2026-07-01"},
            ]
        }

        result = prioritize_bank_suggestions(payload)
        self.assertEqual(
            [item["transaction_id"] for item in result["suggestions"]],
            ["clearer", "newer", "older"],
        )


if __name__ == "__main__":
    unittest.main()
