# Acceptance probe branch: exercises the same production quality matrix before finalizing main.
from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

import psycopg
from fastapi import Request
from fastapi.responses import Response

try:
    from . import v12_main
except ImportError:
    import v12_main


def _request(method: str, path: str) -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": method,
            "scheme": "https",
            "path": path,
            "raw_path": path.encode("utf-8"),
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 1),
            "server": ("testserver", 443),
        }
    )


class ContractDeadlockRetryTests(unittest.TestCase):
    def test_repeatable_get_retries_twice_then_succeeds(self):
        calls = 0

        async def call_next(_request):
            nonlocal calls
            calls += 1
            if calls < 3:
                raise psycopg.errors.DeadlockDetected("deadlock detected")
            return Response(status_code=204)

        with patch.object(v12_main.asyncio, "sleep", new=AsyncMock()) as sleep_mock:
            response = asyncio.run(
                v12_main._dispatch_with_deadlock_retry(
                    _request("GET", "/api/contract-terms"), call_next
                )
            )

        self.assertEqual(response.status_code, 204)
        self.assertEqual(calls, 3)
        self.assertEqual(response.headers.get("X-Contract-DB-Attempts"), "3")
        self.assertEqual(sleep_mock.await_count, 2)

    def test_exhausted_repeatable_get_returns_explicit_503(self):
        calls = 0

        async def call_next(_request):
            nonlocal calls
            calls += 1
            raise psycopg.errors.DeadlockDetected("deadlock detected")

        with patch.object(v12_main.asyncio, "sleep", new=AsyncMock()):
            response = asyncio.run(
                v12_main._dispatch_with_deadlock_retry(
                    _request("GET", "/api/contract-terms/bill-links"), call_next
                )
            )

        payload = json.loads(response.body)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(calls, 3)
        self.assertEqual(payload["detail"]["error"], "contract_database_deadlock")
        self.assertEqual(payload["detail"]["sqlstate"], "40P01")
        self.assertTrue(payload["detail"]["retryable"])
        self.assertEqual(payload["detail"]["attempts"], 3)
        self.assertEqual(response.headers.get("retry-after"), "1")

    def test_stateful_reconcile_v3_is_not_replayed(self):
        calls = 0

        async def call_next(_request):
            nonlocal calls
            calls += 1
            raise psycopg.errors.DeadlockDetected("deadlock detected")

        response = asyncio.run(
            v12_main._dispatch_with_deadlock_retry(
                _request("GET", "/api/contract-terms/reconcile-v3"), call_next
            )
        )
        payload = json.loads(response.body)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(calls, 1)
        self.assertEqual(payload["detail"]["attempts"], 1)

    def test_write_requests_are_not_replayed(self):
        calls = 0

        async def call_next(_request):
            nonlocal calls
            calls += 1
            raise psycopg.errors.DeadlockDetected("deadlock detected")

        response = asyncio.run(
            v12_main._dispatch_with_deadlock_retry(
                _request("PUT", "/api/contract-terms/access-1"), call_next
            )
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(calls, 1)


if __name__ == "__main__":
    unittest.main()
