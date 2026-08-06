from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.api.auth import _revoke_sessions
from app.core.base import Base
from app.models.user import AuthSession, AuthUser


class AuthSessionRevocationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        now = datetime.now(timezone.utc)
        with Session(self.engine) as db:
            db.add(
                AuthUser(
                    id="user-1",
                    email="user@example.com",
                    display_name="User",
                    role="admin",
                    password_hash="hash",
                    is_active=True,
                )
            )
            db.add_all(
                [
                    AuthSession(
                        id="current",
                        user_id="user-1",
                        token_jti="jti-current",
                        issued_at=now,
                        expires_at=now + timedelta(hours=8),
                    ),
                    AuthSession(
                        id="other-1",
                        user_id="user-1",
                        token_jti="jti-other-1",
                        issued_at=now,
                        expires_at=now + timedelta(hours=8),
                    ),
                    AuthSession(
                        id="other-2",
                        user_id="user-1",
                        token_jti="jti-other-2",
                        issued_at=now,
                        expires_at=now + timedelta(hours=8),
                    ),
                ]
            )
            db.commit()

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_password_change_can_keep_current_session_only(self) -> None:
        with Session(self.engine) as db:
            count = _revoke_sessions(db, "user-1", except_session_id="current")
            db.commit()

            sessions = {
                row.id: row
                for row in db.execute(select(AuthSession)).scalars().all()
            }

        self.assertEqual(count, 2)
        self.assertIsNone(sessions["current"].revoked_at)
        self.assertIsNotNone(sessions["other-1"].revoked_at)
        self.assertIsNotNone(sessions["other-2"].revoked_at)

    def test_admin_reset_can_revoke_every_session(self) -> None:
        with Session(self.engine) as db:
            count = _revoke_sessions(db, "user-1")
            db.commit()
            sessions = db.execute(select(AuthSession)).scalars().all()

        self.assertEqual(count, 3)
        self.assertTrue(all(session.revoked_at is not None for session in sessions))


if __name__ == "__main__":
    unittest.main()
