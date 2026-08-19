"""Production contract service entrypoint with bounded deadlock recovery.

V11 remains the business implementation. V12 adds one transport-level stability
policy: PostgreSQL 40P01 deadlocks on safe read requests are retried a bounded
number of times, while every exhausted or non-repeatable deadlock is surfaced as
an explicit retryable HTTP 503 technical state instead of a business mismatch.
"""

from __future__ import annotations

import asyncio
import logging

import psycopg
from fastapi import Request
from fastapi.responses import JSONResponse

try:
    from .v11_main import app
except ImportError:  # Vercel imports modules from the service root.
    from v11_main import app

logger = logging.getLogger("contract_terms")

_READ_RETRY_METHODS = {"GET", "HEAD"}
# reconcile-v3 persists difference-case/special-settlement workflow state despite
# using GET for backward compatibility, so it must never be replayed automatically.
_NO_RETRY_READ_PATHS = {"/api/contract-terms/reconcile-v3"}
_MAX_READ_ATTEMPTS = 3
_BASE_RETRY_DELAY_SECONDS = 0.08


def _deadlock_response(*, attempts: int) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "detail": {
                "error": "contract_database_deadlock",
                "message": "合同数据库发生并发冲突，系统自动重试后仍未恢复，请稍后重试。",
                "retryable": True,
                "sqlstate": "40P01",
                "attempts": attempts,
            }
        },
        headers={"Retry-After": "1"},
    )


async def _dispatch_with_deadlock_retry(request: Request, call_next):
    method = str(request.method or "").upper()
    path = request.url.path
    repeatable_read = method in _READ_RETRY_METHODS and path not in _NO_RETRY_READ_PATHS
    max_attempts = _MAX_READ_ATTEMPTS if repeatable_read else 1

    for attempt in range(1, max_attempts + 1):
        try:
            response = await call_next(request)
            if attempt > 1:
                response.headers["X-Contract-DB-Attempts"] = str(attempt)
            return response
        except psycopg.errors.DeadlockDetected:
            logger.warning(
                "PostgreSQL deadlock path=%s method=%s attempt=%s/%s sqlstate=40P01",
                path,
                method,
                attempt,
                max_attempts,
            )
            if attempt >= max_attempts:
                return _deadlock_response(attempts=attempt)
            await asyncio.sleep(_BASE_RETRY_DELAY_SECONDS * attempt)

    return _deadlock_response(attempts=max_attempts)


@app.middleware("http")
async def contract_database_deadlock_guard(request: Request, call_next):
    return await _dispatch_with_deadlock_retry(request, call_next)
