"""Production contract service entrypoint with bounded deadlock recovery.

V11 remains the business implementation. V12 adds one transport-level stability
policy: PostgreSQL 40P01 deadlocks on safe read requests are retried a bounded
number of times, while every exhausted or non-repeatable deadlock is surfaced as
an explicit retryable HTTP 503 technical state instead of a business mismatch.

The channel-rule endpoint is also wrapped here so the stable game registry can
canonicalize both bill game names and contract access-item names before the
existing deterministic contract matcher runs. This removes repeated string-based
guessing without changing historical bill amounts or contract rules.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import psycopg
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row

try:
    from . import v11_main as _v11
    from .game_identity import enrich_candidates_with_game_ids, enrich_lines_with_game_ids
except ImportError:  # Vercel imports modules from the service root.
    import v11_main as _v11
    from game_identity import enrich_candidates_with_game_ids, enrich_lines_with_game_ids

# Keep an explicit module-level assignment so Vercel's Python entrypoint scanner
# can resolve ``v12_main:app`` without needing to follow imported symbols.
app = _v11.app
_extended = _v11._v10._extended

logger = logging.getLogger("contract_terms")

_READ_RETRY_METHODS = {"GET", "HEAD"}
# reconcile-v3 persists difference-case/special-settlement workflow state despite
# using GET for backward compatibility, so it must never be replayed automatically.
_NO_RETRY_READ_PATHS = {"/api/contract-terms/reconcile-v3"}
_MAX_READ_ATTEMPTS = 3
_BASE_RETRY_DELAY_SECONDS = 0.08
_CHANNEL_RULE_PATH = "/api/contract-terms/channel-rule-recommendation"


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


# Replace only the draft channel-rule POST route. All reconciliation/audit routes
# continue to use the unchanged V11 implementation.
app.router.routes[:] = [
    route
    for route in app.router.routes
    if not (
        getattr(route, "path", None) == _CHANNEL_RULE_PATH
        and "POST" in (getattr(route, "methods", None) or set())
    )
]


@app.post(_CHANNEL_RULE_PATH)
def registry_aware_channel_rule(request: Request, payload: dict) -> dict:
    _extended._require_permission(request, "contracts.view")
    partner_name = str(payload.get("partner_name") or "").strip()
    channel_name = str(payload.get("channel_name") or "").strip()
    lines = payload.get("lines") if isinstance(payload.get("lines"), list) else []
    if not partner_name:
        raise HTTPException(status_code=422, detail="请先选择合作方，再自动匹配合同规则")
    if not lines:
        raise HTTPException(status_code=422, detail="请至少填写一条游戏明细")

    with psycopg.connect(_extended._database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        candidates = enrich_candidates_with_game_ids(conn, _extended._candidate_rows(conn))
        resolved_lines = enrich_lines_with_game_ids(conn, lines)
        result = _extended.recommend_channel_rules(partner_name, channel_name, resolved_lines, candidates)

    identity_total = sum(1 for line in resolved_lines if line.get("game_id"))
    identity_matches = sum(
        1
        for item in (result.get("lines") or [])
        if item.get("match") and any(reason == "游戏名称一致" for reason in (item.get("match", {}).get("reasons") or []))
    )
    return {
        **result,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "game_identity": {
            "resolved": identity_total,
            "total": len([line for line in resolved_lines if str(line.get("game_name") or "").strip()]),
            "contract_identity_matches": identity_matches,
            "mode": "registry-first",
        },
    }
