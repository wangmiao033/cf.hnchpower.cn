"""大熊游戏独立订单 API / 严格入账保护的离线事务回归测试。

只在内存 SQLite 测试数据库执行，不需要 Neon / 生产数据。
"""

from __future__ import annotations

import os
import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.migrations import MIGRATION_FILES, should_run_migrations
from app.core.security import require_admin
from app.models.self_operated import SelfOperatedImportBatch, SelfOperatedOrder
from app.models.user import AuthUser
from app.schemas.self_operated import SelfOperatedConfirmRequest
from app.services.self_operated_orders import (
    confirm_order_import,
    import_history,
    monthly_summary,
    readiness,
)


def _payload(
    rows=None,
    *,
    request_key: str | None = None,
    source_filename: str = "2026-08_09-orders.csv",
):
    return SelfOperatedConfirmRequest.model_validate({
        "requestKey": request_key or str(uuid4()),
        "sourceFile": source_filename,
        "confirmed": True,
        "sourceStatusColumnPresent": True,
        "sourceTypeColumnPresent": True,
        "rows": rows or [
            {"orderId": "000000000000000001", "gameId": "124",
             "gameName": "雷鸣三国", "amountCents": 1677033,
             "paidDate": "2026-08-15", "kind": "game",
             "payment": "paid", "disposition": "ready"},
            {"orderId": "000000000000000002", "gameId": "920",
             "gameName": "异界深渊", "amountCents": 2503570,
             "paidDate": "2026-09-25", "kind": "game",
             "payment": "paid", "disposition": "ready"},
            {"orderId": "000000000000000003", "gameId": "0",
             "gameName": "竹B充值", "amountCents": 139868,
             "paidDate": "2026-09-26", "kind": "coin",
             "payment": "paid", "disposition": "ready"}
        ],
    })


class SelfOperatedLedgerTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        from app.core.base import Base
        Base.metadata.create_all(self.engine, tables=[
            AuthUser.__table__,
            SelfOperatedImportBatch.__table__,
            SelfOperatedOrder.__table__,
        ])
        self.db = Session(self.engine)
        self.db.add(AuthUser(
            id="admin-1",
            email="daxiong-ledger-test@example.test",
            display_name="Admin",
            role="admin",
            is_active=True,
            password_hash="fakehash",
        ))
        self.db.commit()
        self.flags = patch.dict(os.environ, {
            "DAXIONG_ORDERS_WRITES_ENABLED": "true",
            "DAXIONG_PRODUCTION_NEON_PROJECT_ID": "neon-test-project",
            "DAXIONG_VERIFIED_PRODUCTION_PROJECT_ID": "neon-test-project",
            "DAXIONG_VERIFIED_BACKUP_BRANCH_ID": "br-test-cold-backup-123456",
            "DAXIONG_VERIFIED_BACKUP_AT": datetime.now(timezone.utc).isoformat(),
        })
        self.flags.start()
        # unittest cleanup callbacks run in LIFO order: close Session first,
        # then dispose the engine to avoid closing an active SQLite connection.
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        self.addCleanup(self.flags.stop)

    def commit(self, request):
        result = confirm_order_import(self.db, request, user_id="admin-1")
        self.db.commit()
        return result

    def test_monthly_separation_and_audit(self):
        response = self.commit(_payload())
        self.assertEqual(response.submitted, 3)
        self.assertEqual(response.inserted, 3)
        self.assertEqual(response.skipped_existing, 0)
        self.assertEqual(response.inserted_game_cents, 4180603)
        self.assertEqual(response.inserted_coin_cents, 139868)
        self.assertFalse(response.replayed)
        august = monthly_summary(self.db, "2026-08")
        september = monthly_summary(self.db, "2026-09")
        self.assertTrue(august.schema_ready)
        self.assertTrue(august.write_ready)
        self.assertEqual(august.game_cents, 1677033)
        self.assertEqual(august.coin_cents, 0)
        self.assertEqual(september.game_cents, 2503570)
        self.assertEqual(september.coin_cents, 139868)
        self.assertEqual(september.games[0].game_id, "920")
        self.assertEqual(import_history(self.db)[0].inserted_count, 3)

    def test_idempotency_same_request_and_new_request_with_identical_orders(self):
        original = _payload()
        first = self.commit(original)
        retry = self.commit(original)
        self.assertTrue(retry.replayed)
        self.assertEqual(retry.import_id, first.import_id)
        self.assertEqual(retry.inserted, 3)
        second = self.commit(_payload(request_key=str(uuid4())))
        self.assertEqual(second.inserted, 0)
        self.assertEqual(second.skipped_existing, 3)
        self.assertEqual(
            self.db.execute(select(func.count(SelfOperatedOrder.id))).scalar_one(), 3
        )
        self.assertEqual(
            self.db.execute(select(func.count(SelfOperatedImportBatch.id))).scalar_one(), 2
        )

    def test_mismatch_does_not_write_any_part_of_batch(self):
        self.commit(_payload())
        rows = [i.model_dump(by_alias=True, mode="json") for i in _payload().rows]
        rows[0]["amountCents"] = 999999
        rows.append({
            "orderId": "NEW", "gameId": "893", "gameName": "帝国雄师",
            "amountCents": 100, "paidDate": "2026-08-15",
            "kind": "game", "payment": "paid", "disposition": "ready",
        })
        with self.assertRaises(HTTPException) as err:
            self.commit(_payload(rows=rows))
        self.assertEqual(err.exception.status_code, 409)
        self.db.rollback()
        self.assertEqual(
            self.db.execute(select(func.count(SelfOperatedOrder.id))).scalar_one(), 3
        )
        self.assertEqual(
            self.db.execute(select(func.count(SelfOperatedImportBatch.id))).scalar_one(), 1
        )

    def test_reused_request_id_with_different_rows_is_conflict(self):
        original = _payload()
        self.commit(original)
        row = original.rows[0].model_dump(by_alias=True, mode="json")
        row["orderId"] = "DIFFERENT"
        with self.assertRaises(HTTPException) as err:
            self.commit(_payload(rows=[row], request_key=str(original.request_key)))
        self.assertEqual(err.exception.status_code, 409)
        self.db.rollback()

    def test_duplicate_rows_in_payload_are_rejected(self):
        rows = [i.model_dump(by_alias=True, mode="json") for i in _payload().rows[:1]]
        with self.assertRaises(HTTPException) as err:
            self.commit(_payload(rows=rows + rows))
        self.assertEqual(err.exception.status_code, 422)
        self.db.rollback()

    def test_schema_and_backup_flags_fail_closed(self):
        for key, value in [
            ("DAXIONG_ORDERS_WRITES_ENABLED", "false"),
            ("DAXIONG_VERIFIED_BACKUP_BRANCH_ID", ""),
            ("DAXIONG_VERIFIED_PRODUCTION_PROJECT_ID", "different-neon"),
            ("DAXIONG_VERIFIED_BACKUP_AT", "2020-01-01T00:00:00+00:00"),
        ]:
            with self.subTest(key=key), patch.dict(os.environ, {key: value}):
                self.assertFalse(readiness(self.db)[1])
                with self.assertRaises(HTTPException) as err:
                    self.commit(_payload())
                self.assertEqual(err.exception.status_code, 503)
                self.db.rollback()
        self.assertEqual(
            self.db.execute(select(func.count(SelfOperatedImportBatch.id))).scalar_one(), 0
        )

    def test_bad_money_status_dates_and_identity_rejected_by_contract(self):
        row = _payload().rows[0].model_dump(by_alias=True, mode="json")
        for field, value in [
            ("amountCents", 12.34),
            ("amountCents", -1),
            ("disposition", "review"),
            ("payment", "unpaid"),
            ("paidDate", "2026-02-30"),
            ("orderId", " 00 "),
        ]:
            with self.subTest(field=field, value=value):
                bad = dict(row, **{field: value})
                with self.assertRaises(ValidationError):
                    _payload(rows=[bad])
        with self.assertRaises(ValidationError):
            SelfOperatedConfirmRequest.model_validate({
                "requestKey": str(uuid4()), "sourceFile": "orders.csv",
                "confirmed": True, "sourceStatusColumnPresent": False,
                "sourceTypeColumnPresent": True, "rows": [row],
            })

    def test_non_admin_blocked_and_invalid_month(self):
        actor = AuthUser(id="normal", role="operator", is_active=True)
        with self.assertRaises(HTTPException) as err:
            require_admin(user=actor)
        self.assertEqual(err.exception.status_code, 403)
        with self.assertRaises(HTTPException) as err:
            monthly_summary(self.db, "2026-13")
        self.assertEqual(err.exception.status_code, 422)

    def test_migration_076_is_not_auto_executed(self):
        self.assertTrue(any(str(x) == "075" for x in MIGRATION_FILES))
        self.assertFalse(any(str(x) == "076" for x in MIGRATION_FILES))
        with patch.dict(os.environ, {"MIGRATION_EXECUTION_CONTEXT": ""}):
            self.assertFalse(should_run_migrations())


if __name__ == "__main__":
    unittest.main()
