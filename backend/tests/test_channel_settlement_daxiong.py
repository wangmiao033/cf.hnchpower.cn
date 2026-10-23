"""大熊游戏（daxiong_net_receipt）结算规则测试。

系统结算 = 实收合计（net receipt），非（流水−扣减）×分成公式。
"""
from types import SimpleNamespace
import unittest

from app.services.channel_settlement_engine import calculate_channel_line, DAXIONG_NET_RECEIPT_RULE


class DaxiongNetReceiptSettlementTests(unittest.TestCase):
    def record(self, code=DAXIONG_NET_RECEIPT_RULE):
        return SimpleNamespace(
            channel_name="大熊游戏",
            partner_name="",
            settlement_rule_code=code,
            channel_fee_mode="none",
            channel_fee_rate=0,
            tax_mode="none",
            validation_tolerance=0.05,
        )

    def line(self, *, flow=0, voucher=0, platform=None, share_rate=30):
        return SimpleNamespace(
            billing_flow=flow,
            discount_factor=1,
            voucher_cost=voucher,
            voucher_face_value=None,
            voucher_direct_cost=None,
            no_worry_cost=0,
            refund_cost=0,
            test_cost=0,
            welfare_cost=0,
            coin_cost=0,
            share_rate=share_rate,
            tax_rate=0,
            gateway_cost=0,
            platform_settlement_amount=platform,
        )

    def test_diguoxiongshi_202607_net_receipt_7376_identity(self):
        """帝国雄师 2026-07 实收 7376 → system/platform 7376, diff 0"""
        result = calculate_channel_line(
            self.line(flow=10000, platform=7376),
            self.record(),
        )
        self.assertEqual(float(result["system_settlement_amount"]), 7376.0)
        self.assertEqual(float(result["platform_settlement_amount"]), 7376.0)
        self.assertEqual(float(result["settlement_difference"]), 0.0)
        self.assertEqual(result["validation_status"], "pass")

    def test_net_receipt_zero_excluded_from_settlement(self):
        """竹B/月卡等实收=0的行：系统结算=0，仅记录"""
        result = calculate_channel_line(
            self.line(flow=500, platform=0),
            self.record(),
        )
        self.assertEqual(float(result["system_settlement_amount"]), 0.0)
        self.assertEqual(float(result["platform_settlement_amount"]), 0.0)
        self.assertEqual(float(result["settlement_difference"]), 0.0)
        self.assertEqual(result["validation_status"], "pass")

    def test_net_receipt_not_provided_is_unvalidated(self):
        """未提供平台结算时，状态为 unvalidated"""
        result = calculate_channel_line(
            self.line(flow=1000, platform=None),
            self.record(),
        )
        self.assertIsNone(result["platform_settlement_amount"])
        self.assertIsNone(result["settlement_difference"])
        self.assertEqual(result["validation_status"], "unvalidated")

    def test_share_rate_is_ledger_only_not_used_in_calculation(self):
        """分成比例仅台账记录，不影响结算金额"""
        result_30 = calculate_channel_line(
            self.line(flow=10000, platform=7376, share_rate=30),
            self.record(),
        )
        result_50 = calculate_channel_line(
            self.line(flow=10000, platform=7376, share_rate=50),
            self.record(),
        )
        self.assertEqual(float(result_30["system_settlement_amount"]), 7376.0)
        self.assertEqual(float(result_50["system_settlement_amount"]), 7376.0)

    def test_other_rules_still_use_formula(self):
        """其他规则仍使用公式计算，不是 net receipt 直接结算"""
        result = calculate_channel_line(
            self.line(flow=10000, platform=7376, share_rate=30),
            self.record(code="share_only"),
        )
        self.assertEqual(float(result["system_settlement_amount"]), 3000.0)
        self.assertEqual(result["validation_status"], "fail")


if __name__ == "__main__":
    unittest.main()
