from __future__ import annotations

import unittest

import v14_main


def candidate(
    access_item_id: str,
    *,
    share_rate: float,
    status: str = "生效",
    game_name: str = "一起来修仙（0.05折iOS）",
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


class AnjiuConfirmationAlignmentTests(unittest.TestCase):
    def test_confirmation_uses_same_active_candidate_as_channel_rule_recommender(self):
        bill = {
            "bill_type": "channel",
            "bill_id": "bill-1",
            "partner_name": "广东安久科技有限公司",
            "channel_name": "游戏fan（安久）",
            "settlement_month": "2026-03",
            "channel_fee_rate": 5,
        }
        line = {
            "line_id": "line-1",
            "game_name": "一起来修仙（0.05折iOS）",
            "settlement_cycle": "2026-03",
            "share_rate": 30,
            "tax_rate": 0,
            "test_fee": 0,
            "refund_amount": 0,
            "other_deductions": 0,
            "gateway_cost": 0,
            "settlement_amount": 2321.19,
        }
        candidates = [
            candidate("stale-disabled", share_rate=50, status="停用"),
            candidate("current-active", share_rate=30, status="生效"),
        ]

        legacy = v14_main._ORIGINAL_EVALUATE_LINE_V2(bill, line, candidates, None)
        self.assertEqual(legacy["status"], "fail")
        self.assertEqual(legacy["match"]["access_item_id"], "stale-disabled")

        aligned = v14_main._evaluate_channel_line_with_contract_rule_authority(
            bill,
            line,
            candidates,
            None,
        )
        self.assertEqual(aligned["status"], "pass")
        self.assertEqual(aligned["match"]["access_item_id"], "current-active")
        self.assertEqual(aligned["contract_rule_authority"]["source"], "channel_rule_recommendation")

    def test_anjiu_contract_amount_uses_deductions_before_discount(self):
        bill = {
            "settlement_rule_code": v14_main.ANJIU_PRE_DISCOUNT_DEDUCTION_RULE,
            "channel_fee_mode": "percent",
            "channel_fee_rate": 5,
            "tax_mode": "share",
        }
        contract = candidate("active", share_rate=30)

        rows = [
            (1636031, 7128, 2321.19),
            (189490, 648, 269.10),
            (3534002, 7776, 5024.87),
            (64406, 1944, 89.01),
        ]
        actual_total = 0.0
        for flow, voucher, expected in rows:
            line = {
                "settlement_rule_code": v14_main.ANJIU_PRE_DISCOUNT_DEDUCTION_RULE,
                "billing_flow": flow,
                "discount_factor": 0.005,
                "voucher_cost": voucher,
                "no_worry_cost": 0,
                "refund_amount": 0,
                "test_fee": 0,
                "welfare_cost": 0,
                "coin_cost": 0,
                "other_deductions": 0,
                "tax_rate": 0,
                "gateway_cost": 0,
                "settlement_amount": expected,
            }
            result = v14_main._calculate_channel_contract_amount_with_anjiu_order(
                bill,
                line,
                contract,
            )
            self.assertEqual(result["status"], "pass")
            self.assertAlmostEqual(result["expected_amount"], expected, places=2)
            self.assertAlmostEqual(result["difference_amount"], 0.0, places=2)
            self.assertEqual(result["breakdown"]["deduction_order"], "before_discount")
            actual_total += expected

        self.assertAlmostEqual(actual_total, 7704.17, places=2)

    def test_non_anjiu_contract_amount_keeps_generic_order(self):
        bill = {
            "settlement_rule_code": "five_percent_gateway_share",
            "channel_fee_mode": "percent",
            "channel_fee_rate": 5,
            "tax_mode": "none",
        }
        line = {
            "settlement_rule_code": "five_percent_gateway_share",
            "billing_flow": 1000,
            "discount_factor": 0.5,
            "voucher_cost": 100,
            "no_worry_cost": 0,
            "refund_amount": 0,
            "test_fee": 0,
            "welfare_cost": 0,
            "coin_cost": 0,
            "other_deductions": 0,
            "tax_rate": 0,
            "gateway_cost": 0,
            "settlement_amount": 114,
        }
        contract = {
            **candidate("normal", share_rate=30, game_name="普通游戏"),
            "partner_name": "其他合作方有限公司",
            "partner_short_name": "其他合作方",
            "counterparty": "其他合作方有限公司",
            "channel_name": "普通渠道",
            "product_name": "普通游戏",
        }

        result = v14_main._calculate_channel_contract_amount_with_anjiu_order(
            bill,
            line,
            contract,
        )
        self.assertEqual(result["formula_code"], "channel_revenue_share")
        self.assertAlmostEqual(result["expected_amount"], 114.0, places=2)


if __name__ == "__main__":
    unittest.main()