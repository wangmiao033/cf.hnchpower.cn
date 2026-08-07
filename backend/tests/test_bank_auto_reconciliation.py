import unittest
from types import SimpleNamespace

from app.services.bank_auto_reconciliation import (
    _normalize_party,
    _score_candidate,
    build_transaction_suggestion,
    transaction_direction,
)


def tx(**overrides):
    base = dict(
        id="tx-1",
        type="statement_import",
        trade_date="2026-08-06",
        payer_name="广州熊动科技有限公司",
        payee_name=None,
        income_amount=1000,
        expense_amount=0,
        amount=1000,
        currency="CNY",
        transaction_no="BANK-001",
        instruction_no=None,
        summary="7月结算 CH-202607-001",
        purpose=None,
        remark=None,
        raw_text=None,
        created_at=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def channel_candidate(bill_id="c1", partner="广州熊动科技有限公司", number="CH-202607-001", outstanding=1000):
    return {
        "bill_type": "channel",
        "bill_id": bill_id,
        "bill_number": number,
        "raw_bill_number": number,
        "partner_name": partner,
        "settlement_month": "2026-07",
        "game_name": "测试游戏",
        "bill_amount": 1000,
        "outstanding_amount": outstanding,
    }


class BankAutoReconciliationTest(unittest.TestCase):
    def test_transaction_direction(self):
        direction, amount, blocked = transaction_direction(tx())
        self.assertEqual(direction, "collection")
        self.assertEqual(amount, 1000)
        self.assertIsNone(blocked)

        direction, amount, blocked = transaction_direction(
            tx(income_amount=0, expense_amount=880, amount=880, payer_name=None, payee_name="研发商A")
        )
        self.assertEqual(direction, "payment")
        self.assertEqual(amount, 880)
        self.assertIsNone(blocked)

    def test_company_name_normalization_ignores_legal_suffix(self):
        self.assertEqual(_normalize_party("广州熊动科技有限公司"), _normalize_party("广州熊动科技"))

    def test_exact_amount_partner_and_bill_number_is_high_confidence(self):
        suggestion = build_transaction_suggestion(
            tx(), {"collection": [channel_candidate()], "payment": []}
        )
        self.assertEqual(suggestion["confidence_level"], "high")
        self.assertTrue(suggestion["auto_ready"])
        self.assertGreaterEqual(suggestion["top_score"], 80)
        self.assertIn("金额与未结余额一致", suggestion["candidates"][0]["reasons"])
        self.assertIn("流水摘要命中账单编号", suggestion["candidates"][0]["reasons"])

    def test_same_score_multiple_bills_are_not_auto_confirmed(self):
        transaction = tx(summary="普通转账", transaction_no="BANK-002")
        pool = {
            "collection": [
                channel_candidate("c1", number="CH-A"),
                channel_candidate("c2", number="CH-B"),
            ],
            "payment": [],
        }
        suggestion = build_transaction_suggestion(transaction, pool)
        self.assertEqual(suggestion["confidence_level"], "medium")
        self.assertFalse(suggestion["auto_ready"])
        self.assertLess(suggestion["ambiguity_margin"], 10)

    def test_amount_above_outstanding_is_not_candidate(self):
        suggestion = build_transaction_suggestion(
            tx(income_amount=1200, amount=1200),
            {"collection": [channel_candidate(outstanding=1000)], "payment": []},
        )
        self.assertFalse(suggestion["candidates"])
        self.assertFalse(suggestion["auto_ready"])

    def test_partial_payment_needs_more_than_amount_evidence(self):
        transaction = tx(income_amount=300, amount=300, summary="普通转账", payer_name="未知公司")
        scored = _score_candidate(transaction, "collection", 300, channel_candidate(outstanding=1000))
        self.assertIsNotNone(scored)
        self.assertEqual(scored["confidence_level"], "low")
        self.assertLess(scored["score"], 60)


if __name__ == "__main__":
    unittest.main()
