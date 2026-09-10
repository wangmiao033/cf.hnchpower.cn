from __future__ import annotations

import unittest

import v15_main


def candidate(
    access_item_id: str,
    *,
    share_rate: float,
    status: str = "生效",
    game_name: str = "一起来修仙（0.05折）",
) -> dict:
    return {
        "access_item_id": access_item_id,
        "contract_id": f"contract-{access_item_id}",
        "contract_name": f"合同-{access_item_id}",
        "contract_no": f"NO-{access_item_id}",
        "partner_name": "广东安久科技有限公司",
        "partner_short_name": "广东安久",
        "counterparty": "广东安久科技有限公司",
        "channel_name": "游戏fan（安久）",
        "product_name": game_name,
        "authorization_start": "2026-01-01",
        "authorization_end": "2026-12-31",
        "share_rate": share_rate,
        "channel_fee_rate": 5,
        "invoice_tax_rate": 0,
        "testing_fee": None,
        "settlement_mode": "流水分成",
        "settlement_basis": "折后流水",
        "access_status": status,
        "performance_status": "履约中",
    }


def bill() -> dict:
    return {
        "bill_type": "channel",
        "bill_id": "bill-feb",
        "partner_name": "广东安久科技有限公司",
        "channel_name": "游戏fan（安久）",
        "settlement_month": "2026-02",
        "channel_fee_rate": 5,
    }


def line(share_rate: float = 30) -> dict:
    return {
        "line_id": "line-1",
        "game_name": "一起来修仙（0.05折）",
        "settlement_cycle": "2026-02",
        "share_rate": share_rate,
        "tax_rate": 0,
        "test_fee": 0,
        "refund_amount": 0,
        "other_deductions": 0,
        "gateway_cost": 0,
        "settlement_amount": 2859.53,
    }


def binding(method: str) -> dict:
    return {
        "bill_type": "channel",
        "bill_id": "bill-feb",
        "line_id": "line-1",
        "access_item_id": "stale-disabled",
        "match_method": method,
    }


class AnjiuAutoBindingRefreshTests(unittest.TestCase):
    def setUp(self):
        self.candidates = [
            candidate("stale-disabled", share_rate=50, status="停用"),
            candidate("current-active", share_rate=30, status="生效"),
        ]

    def test_failed_stale_auto_binding_uses_current_active_contract(self):
        legacy = v15_main._V14_EVALUATE_LINE(
            bill(), line(), self.candidates, binding("auto_locked")
        )
        self.assertEqual(legacy["status"], "fail")
        self.assertEqual(legacy["match"]["access_item_id"], "stale-disabled")

        result = v15_main._evaluate_channel_line_with_auto_binding_refresh(
            bill(), line(), self.candidates, binding("auto_locked")
        )

        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["match"]["access_item_id"], "current-active")
        self.assertEqual(result["match"]["match_method"], "auto_refreshed")
        self.assertFalse(result["match"]["locked"])
        self.assertIsNone(result["binding"])
        self.assertEqual(
            result["contract_rule_authority"]["source"],
            "channel_rule_recommendation_auto_binding_refresh",
        )
        self.assertEqual(
            result["contract_rule_authority"]["stale_auto_binding_access_item_id"],
            "stale-disabled",
        )

    def test_manual_binding_remains_authoritative(self):
        result = v15_main._evaluate_channel_line_with_auto_binding_refresh(
            bill(), line(), self.candidates, binding("manual")
        )
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["match"]["access_item_id"], "stale-disabled")
        self.assertEqual(result["binding"]["match_method"], "manual")

    def test_real_difference_against_current_contract_still_fails(self):
        result = v15_main._evaluate_channel_line_with_auto_binding_refresh(
            bill(), line(share_rate=35), self.candidates, binding("auto_locked")
        )
        self.assertEqual(result["status"], "fail")

    def test_non_anjiu_bill_is_untouched(self):
        other_bill = {
            **bill(),
            "partner_name": "其他合作方有限公司",
            "channel_name": "其他渠道",
        }
        other_candidates = [
            {
                **candidate("other", share_rate=30),
                "partner_name": "其他合作方有限公司",
                "partner_short_name": "其他合作方",
                "counterparty": "其他合作方有限公司",
                "channel_name": "其他渠道",
            }
        ]
        result = v15_main._evaluate_channel_line_with_auto_binding_refresh(
            other_bill,
            line(),
            other_candidates,
            {
                **binding("auto_locked"),
                "access_item_id": "other",
            },
        )
        self.assertEqual(result["match"]["access_item_id"], "other")


if __name__ == "__main__":
    unittest.main()
