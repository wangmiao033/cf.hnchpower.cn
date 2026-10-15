import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.bank_partner_match import (
    PartnerResolution,
    bank_party_matches_candidate,
    enrich_reconciliation_dashboard,
)
from app.services.bank_combination_match import build_exact_combination


class BankIdentityFirewallTests(unittest.TestCase):
    def test_batu_transaction_cannot_recommend_xiamen_game_home_despite_exact_amount(self):
        raw = "重庆天蓝网络传媒有限责任公司"
        wrong = {"bill_type": "channel", "partner_name": "厦门游戏之家科技有限公司"}
        self.assertFalse(bank_party_matches_candidate(raw, wrong))
        self.assertFalse(bank_party_matches_candidate("巴兔", wrong))
        self.assertTrue(
            bank_party_matches_candidate(
                "重庆天蓝网络传媒有限责任公司",
                {"partner_name": "重庆天蓝网络传媒有限公司"},
            ) is False
        )

    def test_exact_company_name_or_explicit_alias_to_correct_customer_is_allowed(self):
        self.assertTrue(bank_party_matches_candidate(
            "重庆天蓝网络传媒有限责任公司",
            {"partner_name": "重庆天蓝网络传媒有限责任公司"},
        ))
        mapping = PartnerResolution(
            partner_id="p-batu", partner_name="重庆天蓝网络传媒有限责任公司",
            short_name="巴兔", match_method="manual", explicit=True,
        )
        self.assertTrue(bank_party_matches_candidate(
            "巴兔", {"partner_name": "重庆天蓝网络传媒有限责任公司"}, mapping
        ))
        self.assertFalse(bank_party_matches_candidate(
            "巴兔", {"partner_name": "厦门游戏之家科技有限公司"}, mapping
        ))

    def test_money_and_bank_bill_number_do_not_override_wrong_customer(self):
        result = {
            "stats": {},
            "suggestions": [{
                "transaction_id": "tx-batu", "direction": "collection", "amount": 5149.67,
                "counterparty_name": "重庆天蓝网络传媒有限责任公司",
                "auto_ready": True, "confidence_level": "high", "top_score": 100,
                "candidates": [{
                    "bill_type": "channel", "bill_id": "wrong-bill",
                    "bill_number": "CH-EXACT", "partner_name": "厦门游戏之家科技有限公司",
                    "outstanding_amount": 5149.67, "score": 100,
                    "confidence_level": "high", "reasons": ["金额一致", "流水号命中"],
                }],
            }],
        }
        transaction = SimpleNamespace(
            id="tx-batu", payer_name="重庆天蓝网络传媒有限责任公司", payee_name="",
            payer_account="111", payee_account=""
        )
        db = MagicMock()
        db.execute.return_value.scalars.return_value.all.return_value = [transaction]
        with patch("app.services.bank_partner_match.BankPartnerResolver") as mocked:
            mocked.return_value.resolve.return_value = None
            guarded = enrich_reconciliation_dashboard(db, result)
        suggestion = guarded["suggestions"][0]
        self.assertFalse(suggestion["candidates"])
        self.assertEqual(suggestion["confidence_level"], "none")
        self.assertFalse(suggestion["auto_ready"])
        self.assertEqual(guarded["stats"]["high_confidence"], 0)
        self.assertIn("禁止跨客户", suggestion["blocked_reason"])

    def test_multi_bill_exact_sum_does_not_make_different_company_a_match(self):
        item = {
            "direction": "collection", "remaining_amount": 5149.67,
            "counterparty_name": "重庆天蓝网络传媒有限责任公司",
            "candidates": [
                {"bill_type": "channel", "bill_id": "1", "partner_name": "厦门游戏之家科技有限公司", "outstanding_amount": 2000},
                {"bill_type": "channel", "bill_id": "2", "partner_name": "厦门游戏之家科技有限公司", "outstanding_amount": 3149.67},
            ]
        }
        self.assertIsNone(build_exact_combination(item))


if __name__ == "__main__":
    unittest.main()
