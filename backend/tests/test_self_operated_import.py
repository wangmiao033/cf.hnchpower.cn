"""自营渠道 CSV 导入与业务口径回归测试。"""

import unittest
from decimal import Decimal

from app.services.self_operated_import import ImportValidationError, parse_orders, summarize_orders


GAME_HEADER = (
    "订单ID,创建时间,游戏ID,游戏名称,充值金额,实收金额,支付方式,状态\n"
)
TOKEN_HEADER = (
    "订单号,充值时间,游戏ID,游戏名称,订单金额,实际支付,充值状态,支付方式\n"
)


class SelfOperatedImportTests(unittest.TestCase):
    def test_cash_and_bamboo_are_separate(self):
        rows = (
            GAME_HEADER
            + "g1,2026-09-29 12:00,920,异界深渊,30.00,24.00,微信支付,支付成功\n"
            + "g2,2026-09-29 12:01,920,异界深渊,100.00,0.00,竹B,支付成功\n"
            + "g3,2026-09-29 12:02,920,异界深渊,5.00,4.00,微信支付,未通知CP\n"
        ).encode("utf-8")
        parsed = parse_orders("游戏订单.csv", rows)
        result = summarize_orders(parsed["orders"])
        self.assertEqual(result["cash_paid"], Decimal("24.00"))
        self.assertEqual(result["cash_order_count"], 1)
        self.assertEqual(result["token_recharged"], Decimal("0.00"))
        self.assertEqual(result["games"][0]["game_external_id"], "920")

    def test_token_topup_is_not_immediate_sales_revenue(self):
        blob = (TOKEN_HEADER + "t1,2026-09-30 12:30,124,雷鸣三国,100.00,5.00,支付成功,微信支付\n").encode()
        parsed = parse_orders("代币充值.csv", blob)
        self.assertEqual(parsed["kind"], "token")
        result = summarize_orders(parsed["orders"])
        self.assertEqual(result["cash_paid"], Decimal("0.00"))
        self.assertEqual(result["token_recharged"], Decimal("5.00"))

    def test_gb18030_chinese_headers(self):
        blob = (GAME_HEADER + "g1,2026-08-31 23:59,124,雷鸣三国,10.00,4.50,官方支付宝,支付成功\n").encode("gb18030")
        parsed = parse_orders("游戏订单.csv", blob)
        self.assertEqual(parsed["months"], ["2026-08"])
        self.assertEqual(summarize_orders(parsed["orders"])["cash_paid"], Decimal("4.50"))

    def test_reject_conflicting_duplicate_and_negative_money(self):
        conflicting = (
            GAME_HEADER +
            "g1,2026-09-29 12:00,124,雷鸣三国,10.00,5.00,微信支付,支付成功\n" +
            "g1,2026-09-29 12:00,124,雷鸣三国,10.00,6.00,微信支付,支付成功\n"
        ).encode()
        with self.assertRaises(ImportValidationError):
            parse_orders("游戏订单.csv", conflicting)
        negative = (GAME_HEADER + "g1,2026-09-29 12:00,124,雷鸣三国,10.00,-1.00,微信支付,支付成功\n").encode()
        with self.assertRaises(ImportValidationError):
            parse_orders("游戏订单.csv", negative)

    def test_reject_unrelated_csv(self):
        with self.assertRaises(ImportValidationError):
            parse_orders("other.csv", b"name,price\na,4\n")


if __name__ == "__main__":
    unittest.main()
