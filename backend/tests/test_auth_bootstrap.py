from __future__ import annotations

import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api import auth as auth_api
from app.core.base import Base
from app.core.security import hash_password, verify_password
from app.models.user import AuthSession, AuthUser


class BuiltinAccountBootstrapTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(
            self.engine,
            tables=[AuthUser.__table__, AuthSession.__table__],
        )

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_bootstrap_password_only_creates_a_missing_account(self) -> None:
        with (
            patch.object(auth_api, "BUILTIN_ACCOUNT", "admin"),
            patch.object(auth_api, "BUILTIN_PASSWORDS", ("initial-secret",)),
            Session(self.engine) as db,
        ):
            user = auth_api._get_or_create_builtin_user(db)
            db.commit()

        self.assertEqual(user.email, "admin")
        self.assertEqual(user.role, "admin")
        self.assertTrue(user.is_active)
        self.assertTrue(verify_password("initial-secret", user.password_hash))

    def test_existing_password_role_and_status_are_never_reapplied_from_environment(self) -> None:
        with Session(self.engine) as db:
            db.add(
                AuthUser(
                    id="auth-user-adam",
                    email="admin",
                    display_name="Changed Admin",
                    role="user",
                    password_hash=hash_password("changed-secret"),
                    is_active=False,
                )
            )
            db.commit()

        with (
            patch.object(auth_api, "BUILTIN_ACCOUNT", "admin"),
            patch.object(auth_api, "BUILTIN_PASSWORDS", ("initial-secret",)),
            Session(self.engine) as db,
        ):
            user = auth_api._get_or_create_builtin_user(db)

            self.assertTrue(verify_password("changed-secret", user.password_hash))
            self.assertFalse(verify_password("initial-secret", user.password_hash))
            self.assertEqual(user.role, "user")
            self.assertFalse(user.is_active)
            self.assertEqual(user.display_name, "Changed Admin")


if __name__ == "__main__":
    unittest.main()
