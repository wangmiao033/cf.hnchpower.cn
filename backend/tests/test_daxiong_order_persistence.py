"""大熊游戏持久化准备阶段：所有测试使用合成订单，不访问生产数据库。"""
from __future__ import annotations

import asyncio
import os
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException, UploadFile

from app.api.daxiong_orders import (
    _authorized_to_use_db, _check_expected, _admin_only, import_csv,
)
from app.services.daxiong_order_import import OrderImportRejected, parse_audited_csv

HEADER = (
    "订单号,实付金额,支付时间,游戏名称,游戏ID,支付状态,订单类型,支付方式\n"
)
EXAMPLES = HEADER + (
    "000123456789012345,100.01,2026-09-01 12:10:00,帝国雄师,893,支付成功,游戏充值,微信支付\n"
    "X002,0.02,2026-09-02,帝国雄师,893,已支付,游戏充值,支付宝\n"
    "T001,50.00,2026-09-03,竹B现金充值,0,支付成功,竹B充值,支付宝\n"
    "UNPAID,100.00,2026-09-04,帝国雄师,893,待支付,游戏充值,微信\n"
    "BAMBOO,99.00,2026-09-05,帝国雄师,893,支付成功,游戏充值,竹B支付\n"
    "X002,0.02,2026-09-02,帝国雄师,893,已支付,游戏充值,支付宝\n"
)


class DaxiongOrderValidationTests(unittest.TestCase):
    def test_exact_cents_and_independent_coin(self):
        parsed = parse_audited_csv("cleaned.csv", EXAMPLES.encode())
        self.assertEqual(parsed.eligible_count, 3)
        self.assertEqual(parsed.records_read, 6)
        self.assertEqual(parsed.excluded, 3)
        self.assertEqual(parsed.duplicate_in_file, 1)
        self.assertEqual(parsed.game_cash_cents, 10003)
        self.assertEqual(parsed.coin_topup_cents, 5000)
        self.assertEqual(parsed.orders[0].order_id, "000123456789012345")
        self.assertEqual(parsed.orders[0].paid_month, "2026-09")
        self.assertEqual(parsed.orders[0].order_kind, "game")
        self.assertEqual(parsed.orders[2].order_kind, "coin")
        self.assertEqual(len(parsed.sha256), 64)

    def test_clashes_are_rejected_instead_of_overwritten(self):
        blob = HEADER + (
            "X001,100.01,2026-09-02,帝国雄师,893,支付成功,游戏充值,微信\n"
            "X001,99.99,2026-09-02,帝国雄师,893,支付成功,游戏充值,微信\n"
        )
        with self.assertRaisesRegex(OrderImportRejected, "冲突"):
            parse_audited_csv("data.csv", blob.encode())

    def test_unknown_status_or_type_blocks_entire_file(self):
        for status, kind in [("未通知CP", "游戏充值"), ("成功", "不能确定的类型")]:
            with self.subTest(status=status, kind=kind):
                value = HEADER + (
                    f"X001,11.00,2026-09-02,帝国雄师,893,{status},{kind},微信\n"
                )
                with self.assertRaises(OrderImportRejected):
                    parse_audited_csv("data.csv", value.encode())

    def test_strict_date_and_cent_precision(self):
        for date, amount in [("2026-02-30", "12.00"), ("2026-09-02", "12.345"), ("2026-09-02", "0")]:
            with self.subTest(date=date, amount=amount):
                blob = HEADER + (
                    f"X001,{amount},{date},帝国雄师,893,成功,游戏充值,微信\n"
                )
                with self.assertRaises(OrderImportRejected):
                    parse_audited_csv("data.csv", blob.encode())

    def test_no_confusion_between_face_value_and_cash_paid(self):
        file = ("订单号,充值金额,实付金额,支付时间,游戏名称,游戏ID,支付状态,订单类型\n"
                "A1,5000,12.34,2026-09-02,雷鸣三国,124,支付成功,游戏充值\n")
        parsed = parse_audited_csv("example.csv", file.encode())
        self.assertEqual(parsed.game_cash_cents, 1234)

    def test_reject_exponential_and_unsafe_identifiers(self):
        for order in ["1.78912345E+19", "", "\x00bad"]:
            with self.subTest(order=order):
                blob = HEADER + (
                    f"{order},13.20,2026-09-02,帝国雄师,893,成功,游戏充值,支付宝\n"
                )
                with self.assertRaises(OrderImportRejected):
                    parse_audited_csv("data.csv", blob.encode())

    def test_valid_utf8_bom_and_gb18030(self):
        for encoding in ["utf-8-sig", "gb18030"]:
            with self.subTest(encoding=encoding):
                parsed = parse_audited_csv("游戏充值.csv", EXAMPLES.encode(encoding))
                self.assertEqual(parsed.eligible_count, 3)

    def test_unrelated_or_too_large_sources_rejected(self):
        with self.assertRaises(OrderImportRejected):
            parse_audited_csv("not.csv", EXAMPLES.encode())
        with self.assertRaises(OrderImportRejected):
            parse_audited_csv("orders.csv", b"x" * (3 * 1024 * 1024 + 1))
        with self.assertRaises(OrderImportRejected):
            parse_audited_csv("orders.csv", b"not a finance source\njunk\n")

    def test_missing_required_status_and_kind_rejected(self):
        row = ("订单号,实付金额,支付时间,游戏名称\n"
               "A1,1.00,2026-09-02,帝国雄师\n")
        with self.assertRaises(OrderImportRejected):
            parse_audited_csv("orders.csv", row.encode())

    def test_replayed_binary_file_sha256_is_stable(self):
        blob = EXAMPLES.encode()
        one = parse_audited_csv("a.csv", blob)
        two = parse_audited_csv("b.csv", blob)
        self.assertEqual(one.sha256, two.sha256)
        self.assertEqual(one.orders[0].fingerprint, two.orders[0].fingerprint)

    def test_form_totals_guard_rejects_mismatch(self):
        parsed = parse_audited_csv("clean.csv", EXAMPLES.encode())
        _check_expected(
            parsed, game_cash_cents=10003,
            coin_topup_cents=5000, eligible_count=3,
        )
        with self.assertRaises(HTTPException) as failure:
            _check_expected(
                parsed, game_cash_cents=10004,
                coin_topup_cents=5000, eligible_count=3,
            )
        self.assertEqual(failure.exception.status_code, 409)

    def test_admin_only_and_dual_feature_flag(self):
        admin = SimpleNamespace(role="admin", is_active=True)
        viewer = SimpleNamespace(role="viewer", is_active=True)
        _admin_only(admin)
        with self.assertRaises(HTTPException):
            _admin_only(viewer)
        with self.assertRaises(HTTPException):
            _admin_only(SimpleNamespace(role="admin", is_active=False))
        with patch.dict(os.environ, {"DAXIONG_ORDER_SAVE_ENABLED":"true", "DAXIONG_VERIFIED_BACKUP_BRANCH":""}):
            self.assertFalse(_authorized_to_use_db())
        with patch.dict(os.environ, {"DAXIONG_ORDER_SAVE_ENABLED":"false", "DAXIONG_VERIFIED_BACKUP_BRANCH":"backup-branch"}):
            self.assertFalse(_authorized_to_use_db())
        with patch.dict(os.environ, {"DAXIONG_ORDER_SAVE_ENABLED":"true", "DAXIONG_VERIFIED_BACKUP_BRANCH":"verified-branch"}):
            self.assertTrue(_authorized_to_use_db())

    def test_disabled_import_never_reads_upload_or_database(self):
        admin = SimpleNamespace(id="admin", role="admin", is_active=True)
        # No DB access should occur while feature is off: a local safety test.
        dummy_db = SimpleNamespace(execute=lambda *args, **kwargs: self.fail("DB touched"))
        upload = UploadFile(filename="clean.csv", file=BytesIO(EXAMPLES.encode()))
        with patch.dict(os.environ, {"DAXIONG_ORDER_SAVE_ENABLED":"false", "DAXIONG_VERIFIED_BACKUP_BRANCH":""}):
            with self.assertRaises(HTTPException) as blocked:
                asyncio.run(import_csv(
                    file=upload, expected_game_cash_cents=10003,
                    expected_coin_topup_cents=5000, expected_eligible_count=3,
                    confirm="CONFIRM_DAXIONG_CASH_ORDERS", user=admin, db=dummy_db,
                ))
        self.assertEqual(blocked.exception.status_code, 423)


if __name__ == "__main__":
    unittest.main()
