"""Production contract service V13: contract-first game-rule fallback.

V12 keeps contract access items authoritative and canonicalizes game identities.
V13 adds one business bridge: when a precise line has no contract match at all,
check the maintained game/channel/month registry and use an unambiguous active
rule. A real contract candidate, even one requiring review, is never overwritten.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import psycopg
from fastapi import HTTPException, Request
from psycopg.rows import dict_row

try:
    from . import v12_main as _v12
    from .game_rule_fallback import apply_game_registry_fallback, load_game_registry_rules
except ImportError:  # Vercel imports modules from the service root.
    import v12_main as _v12
    from game_rule_fallback import apply_game_registry_fallback, load_game_registry_rules

app = _v12.app
_extended = _v12._extended
_CHANNEL_RULE_PATH = _v12._CHANNEL_RULE_PATH

# V12 already replaced this POST route. Replace it once more with the V13 handler;
# every other reconciliation/audit route and the deadlock middleware remain intact.
app.router.routes[:] = [
    route
    for route in app.router.routes
    if not (
        getattr(route, "path", None) == _CHANNEL_RULE_PATH
        and "POST" in (getattr(route, "methods", None) or set())
    )
]


@app.post(_CHANNEL_RULE_PATH)
def contract_first_registry_fallback_channel_rule(request: Request, payload: dict) -> dict:
    _extended._require_permission(request, "contracts.view")
    partner_name = str(payload.get("partner_name") or "").strip()
    channel_name = str(payload.get("channel_name") or "").strip()
    lines = payload.get("lines") if isinstance(payload.get("lines"), list) else []
    if not partner_name:
        raise HTTPException(status_code=422, detail="请先选择合作方，再自动匹配合同规则")
    if not lines:
        raise HTTPException(status_code=422, detail="请至少填写一条游戏明细")

    trace_target = _v12._is_3733_trace_target(partner_name, channel_name, lines)
    with psycopg.connect(_extended._database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        candidates = _v12.enrich_candidates_with_game_ids(conn, _extended._candidate_rows(conn))
        resolved_lines = _v12.enrich_lines_with_game_ids(conn, lines)
        result = _extended.recommend_channel_rules(partner_name, channel_name, resolved_lines, candidates)
        result = apply_game_registry_fallback(
            result,
            partner_name=partner_name,
            channel_name=channel_name,
            lines=resolved_lines,
            registry_rules=load_game_registry_rules(conn),
        )

        if trace_target:
            relevant_candidates = [
                _v12._trace_candidate(candidate)
                for candidate in candidates
                if _v12._trace_candidate_relevant(candidate)
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
                "registry_fallback_count": result.get("registry_fallback_count", 0),
                "line_diagnostics": result.get("line_diagnostics") or [],
                "result_lines": [_v12._trace_result_line(item) for item in (result.get("lines") or [])],
            }
            _v12.logger.info(
                "%s %s",
                _v12._TRACE_MARKER,
                json.dumps(trace_payload, ensure_ascii=False, default=str),
            )

    identity_total = sum(1 for line in resolved_lines if line.get("game_id"))
    contract_identity_matches = sum(
        1
        for item in (result.get("lines") or [])
        if item.get("rule_source") != "game_registry"
        and item.get("match")
        and any(reason == "游戏名称一致" for reason in (item.get("match", {}).get("reasons") or []))
    )
    return {
        **result,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "game_identity": {
            "resolved": identity_total,
            "total": len([line for line in resolved_lines if str(line.get("game_name") or "").strip()]),
            "contract_identity_matches": contract_identity_matches,
            "registry_fallback_matches": int(result.get("registry_fallback_count") or 0),
            "mode": "contract-first-registry-fallback",
        },
    }
