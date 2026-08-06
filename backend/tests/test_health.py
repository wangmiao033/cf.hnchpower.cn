from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from fastapi.responses import JSONResponse

from app.api.health import health_db


class HealthEndpointTest(unittest.TestCase):
    def test_database_failure_returns_503_without_internal_detail(self) -> None:
        with patch("app.api.health.test_db_connection", return_value=(False, "postgresql://secret")):
            response = health_db()

        self.assertIsInstance(response, JSONResponse)
        self.assertEqual(response.status_code, 503)
        payload = json.loads(response.body.decode("utf-8"))
        self.assertEqual(payload, {"ok": False, "database": "error"})
        self.assertNotIn("secret", response.body.decode("utf-8"))

    def test_database_success_remains_healthy(self) -> None:
        with patch("app.api.health.test_db_connection", return_value=(True, None)):
            response = health_db()

        self.assertEqual(response, {"ok": True, "database": "connected"})


if __name__ == "__main__":
    unittest.main()
