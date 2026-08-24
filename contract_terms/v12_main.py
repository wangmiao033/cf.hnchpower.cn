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
import json
import logging
from datetime import datetime, timezone
from typing import Any

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
_TRACE_MARKER = "CHANNEL_RULE_3733_TRACE"


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


def _trace_text(value: Any) -> str:
    return str(value or "").strip().lower().replace(" ", "")


def _is_3733_trace_target(partner_name: str, channel_name: str, lines: list[dict]) -> bool:
    partner_key = _trace_text(partner_name)
    channel_key = _trace_text(channel_name)
    game_keys = [_trace_text(item.get("game_name") or item.get("gameName")) for item in lines]
    return (
        "3733" in channel_key
        or "3733" in partner_key
        or "三七三三" in partner_key
    ) and any("一起来修仙" in game_key for game_key in game_keys)


def _trace_candidate_relevant(candidate: dict) -> bool:
    fields = (
        candidate.get("partner_name"),
        candidate.get("partner_short_name"),
        candidate.get("counterparty"),
        candidate.get("channel_name"),
        candidate.get("product_name"),
    )
    joined = "|".join(_trace_text(value) for value in fields)
    return "三七三三" in joined or "3733" in joined or "一起来修仙" in joined


def _trace_candidate(candidate: dict) -> dict:
    return {
        "access_item_id": candidate.get("access_item_id"),
        "contract_id": candidate.get("contract_id"),
        "contract_name": candidate.get("contract_name"),
        "contract_no": candidate.get("contract_no"),
        "partner_name": candidate.get("partner_name"),
        "partner_short_name": candidate.get("partner_short_name"),
        "counterparty": candidate.get("counterparty"),
        "channel_name": candidate.get("channel_name"),
        "product_name": candidate.get("product_name"),
        "original_product_name": candidate.get("original_product_name"),
        "game_id": candidate.get("game_id"),
        "game_identity_source": candidate.get("game_identity_source"),
        "authorization_start": candidate.get("authorization_start"),
        "authorization_end": candidate.get("authorization_end"),
        "access_status": candidate.get("access_status"),
        "performance_status": candidate.get("performance_status"),
        "share_rate": candidate.get("share_rate"),
        "channel_fee_rate": candidate.get("channel_fee_rate"),
        "invoice_tax_rate": candidate.get("invoice_tax_rate"),
    }


def _trace_result_line(item: dict) -> dict:
    match = item.get("match") if isinstance(item.get("match"), dict) else {}
    recommended = item.get("recommended") if isinstance(item.get("recommended"), dict) else {}
    return {
        "line_index": item.get("line_index"),
        "game_name": item.get("game_name"),
        "settlement_cycle": item.get("settlement_cycle"),
        "auto_apply": item.get("auto_apply"),
        "confidence": item.get("confidence"),
        "score": item.get("score"),
        "authorization_status": item.get("authorization_status"),
        "candidate_count": item.get("candidate_count"),
        "usable_candidate_count": item.get("usable_candidate_count"),
        "message": item.get("message"),
        "match_access_item_id": match.get("access_item_id"),
        "match_contract_id": match.get("contract_id"),
        "match_contract_name": match.get("contract_name"),
        "match_product_name": match.get("product_name"),
        "match_share_rate": match.get("share_rate"),
        "match_channel_fee_rate": match.get("channel_fee_rate"),
        "match_reasons": match.get("reasons"),
        "recommended_share_rate": recommended.get("share_rate"),
        "recommended_tax_rate": recommended.get("tax_rate"),
        "recommended_channel_fee_rate": recommended.get("channel_fee_rate"),
    }


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

    trace_target = _is_3733_trace_target(partner_name, channel_name, lines)
    with psycopg.connect(_extended._database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        candidates = enrich_candidates_with_game_ids(conn, _extended._candidate_rows(conn))
        resolved_lines = enrich_lines_with_game_ids(conn, lines)
        result = _extended.recommend_channel_rules(partner_name, channel_name, resolved_lines, candidates)
        if trace_target:
            relevant_candidates = [
                _trace_candidate(candidate)
                for candidate in candidates
                if _trace_candidate_relevant(candidate)
            ][:60]
            trace_payload = {
                "partner_name": partner_name,
                "channel_name": channel_name,
                "input_lines": [
                    {
                        "game_name": item.get("game_name") or item.get("gameName"),
                        "settlement_cycle": item.get("settlement_cycle") or item.get("settlementCycle"),
                    }
                    for item in lines
                ],
                "resolved_lines": [
                    {
                        "game_name": item.get("game_name"),
                        "input_game_name": item.get("input_game_name"),
                        "game_id": item.get("game_id"),
                        "game_identity_source": item.get("game_identity_source"),
                        "settlement_cycle": item.get("settlement_cycle"),
                    }
                    for item in resolved_lines
                ],
                "candidate_total": len(candidates),
                "relevant_candidates": relevant_candidates,
                "partner_rule_status": result.get("partner_rule_status"),
                "partner_rule_message": result.get("partner_rule_message"),
                "partner_contracts": result.get("partner_contracts"),
                "result_lines": [_trace_result_line(item) for item in (result.get("lines") or [])],
            }
            logger.info("%s %s", _TRACE_MARKER, json.dumps(trace_payload, ensure_ascii=False, default=str))

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
