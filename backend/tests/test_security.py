from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.core.security import get_auth_cookie_samesite, get_auth_session_hours


class SecurityDefaultsTest(unittest.TestCase):
    def test_same_site_defaults_to_lax(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("AUTH_COOKIE_SAMESITE", None)
            self.assertEqual(get_auth_cookie_samesite(), "lax")

    def test_same_site_can_be_explicitly_overridden(self) -> None:
        with patch.dict(os.environ, {"AUTH_COOKIE_SAMESITE": "strict"}, clear=False):
            self.assertEqual(get_auth_cookie_samesite(), "strict")

    def test_session_hours_are_bounded(self) -> None:
        with patch.dict(os.environ, {"AUTH_SESSION_HOURS": "0"}, clear=False):
            self.assertEqual(get_auth_session_hours(), 1)
        with patch.dict(os.environ, {"AUTH_SESSION_HOURS": "999"}, clear=False):
            self.assertEqual(get_auth_session_hours(), 168)
        with patch.dict(os.environ, {"AUTH_SESSION_HOURS": "invalid"}, clear=False):
            self.assertEqual(get_auth_session_hours(), 8)


if __name__ == "__main__":
    unittest.main()
