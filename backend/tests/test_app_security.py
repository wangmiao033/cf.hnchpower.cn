from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app, get_cors_origins


class ApplicationSecurityPolicyTest(unittest.TestCase):
    def test_production_origins_exclude_localhost_and_include_current_vercel_host(self) -> None:
        with patch.dict(
            os.environ,
            {
                "APP_ENV": "production",
                "VERCEL_URL": "preview.example.vercel.app",
                "CORS_ORIGIN": "",
                "CORS_EXTRA_ORIGINS": "",
            },
            clear=False,
        ):
            origins = get_cors_origins()

        self.assertNotIn("http://localhost:5173", origins)
        self.assertNotIn("http://127.0.0.1:5173", origins)
        self.assertIn("https://preview.example.vercel.app", origins)
        self.assertIn("https://cf.hnchpower.cn", origins)

    def test_cross_origin_write_is_rejected_before_authentication(self) -> None:
        with TestClient(app) as client:
            response = client.post(
                "/api/auth/login-password",
                headers={"Origin": "https://evil.example"},
                json={"account": "admin", "password": "not-a-real-password"},
            )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {"detail": "请求来源不受信任"})
        self.assertEqual(response.headers.get("cache-control"), "no-store")
        self.assertEqual(response.headers.get("x-frame-options"), "DENY")
        self.assertEqual(response.headers.get("x-content-type-options"), "nosniff")

    def test_database_health_response_is_not_cacheable(self) -> None:
        with (
            patch("app.api.health.test_db_connection", return_value=(True, None)),
            TestClient(app) as client,
        ):
            response = client.get("/health/db")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True, "database": "connected"})
        self.assertEqual(response.headers.get("cache-control"), "no-store")
        self.assertEqual(response.headers.get("pragma"), "no-cache")


if __name__ == "__main__":
    unittest.main()
