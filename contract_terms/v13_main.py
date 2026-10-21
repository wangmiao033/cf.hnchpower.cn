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
    from .matcher import normalize_company
except ImportError:  # Vercel imports modules from the service root.
    import v12_main as _v12
    from game_rule_fallback import apply_game_registry_fallback, load_game_registry_rules
    from matcher import normalize_company

app = _v12.app
_extended = _v12._extended
_CHANNEL_RULE_PATH = _v12._CHANNEL_RULE_PATH

def _verified_partner_selection(
    conn, partner_id: str, partner_name: str, *, for_binding: bool = False,
) -> dict | None:
    """Use a selected customer ID only after verifying its current legal identity.

    Never let a stale/forged ID silently borrow a different customer's contracts.
    Older callers without an ID continue using the conservative name matcher.
    """
    if not partner_id:
        return None
    selected = conn.execute(
        "SELECT id, name, short_name FROM cf_partner_records WHERE id = %s",
        [partner_id],
    ).fetchone()
    if not selected:
        raise HTTPException(status_code=409, detail="已选择的客户不存在，请从客户库重新选择合作方。")
    selected = dict(selected)
    keys = {
        normalize_company(selected.get("name")),
        normalize_company(selected.get("short_name")),
    }
    keys.discard("")
    if normalize_company(partner_name) not in keys:
        raise HTTPException(status_code=409, detail="客户名称与客户库关联 ID 不一致，请重新选择合作方后匹配合同。")
    if for_binding:
        # Core persistence resolves the bill's stored name by exact equality,
        # not fuzzy aliases, and refuses duplicate customer names. Certify only
        # the same identity here without changing legacy automatic matching.
        exact_names = {str(selected.get(key) or "").strip() for key in ("name", "short_name")}
        exact_names.discard("")
        if partner_name.strip() not in exact_names:
            raise HTTPException(status_code=409, detail="引用合同需使用客户库原始名称或简称，请重新选择当前客户。")
        exact_rows = conn.execute(
            "SELECT id FROM cf_partner_records WHERE name = %s OR short_name = %s",
            [partner_name.strip(), partner_name.strip()],
        ).fetchall()
        if len(exact_rows) != 1 or str(exact_rows[0].get("id") or "") != str(selected["id"]):
            raise HTTPException(status_code=409, detail="当前名称未唯一关联客户库，不能认证合同引用，请先核对同名客户。")
    return selected


def _prepare_explicit_selection_lines(lines: list[dict]) -> list[dict]:
    """Only the server may supply registry/original-name evidence for a binding."""
    prepared = []
    for source in lines:
        row = dict(source)
        if str(row.get("access_item_id") or "").strip():
            for key in ("input_game_name", "game_identity_source", "game_id", "gameId"):
                row.pop(key, None)
        prepared.append(row)
    return prepared


def _scope_linked_candidates(candidates: list[dict], selected: dict | None) -> list[dict]:
    """Respect a verified contract/customer FK before attempting name fuzzy matching.

    A linked contract of another customer is never a candidate, even when the
    display names look similar. Unlinked legacy contracts may still match by name.
    """
    if selected is None:
        return candidates
    selected_id = str(selected.get("id") or "")
    scoped = []
    for candidate in candidates:
        linked_id = str(candidate.get("partner_id") or "")
        if linked_id and linked_id != selected_id:
            continue
        if linked_id == selected_id:
            candidate = {
                **candidate,
                "partner_name": str(selected.get("name") or ""),
                "partner_short_name": str(selected.get("short_name") or ""),
            }
        scoped.append(candidate)
    return scoped


def _linked_contract_catalog(conn, partner_id: str) -> dict:
    """Identify master contracts that exist but have no structured game list.

    This is read-only and is deliberately separate from the financial matcher:
    a master contract alone is not proof of any game's settlement percentage.
    """
    rows = conn.execute(
        """
        SELECT contract.id, contract.contract_name, contract.contract_no,
               COUNT(access.id) AS access_item_count
        FROM cf_contract_records AS contract
        LEFT JOIN cf_contract_access_items AS access ON access.contract_id = contract.id
        WHERE contract.partner_id = %s
        GROUP BY contract.id, contract.contract_name, contract.contract_no, contract.updated_at
        ORDER BY contract.updated_at DESC
        LIMIT 50
        """,
        [partner_id],
    ).fetchall()
    catalog = [dict(row) for row in rows]
    return {
        "contract_count": len(catalog),
        "access_item_count": sum(int(row.get("access_item_count") or 0) for row in catalog),
        "contracts": [
            {
                "contract_id": str(row.get("id") or ""),
                "contract_name": str(row.get("contract_name") or ""),
                "contract_no": str(row.get("contract_no") or ""),
                "access_item_count": int(row.get("access_item_count") or 0),
            }
            for row in catalog[:10]
        ],
        "truncated": len(catalog) == 50,
    }


def _explain_missing_contract_list(result: dict, catalog: dict) -> dict:
    """Return a useful recovery reason instead of claiming the contract is absent."""
    count = int(catalog.get("contract_count") or 0)
    access_count = int(catalog.get("access_item_count") or 0)
    if count and not access_count:
        reason = (
            f"客户已关联 {count} 份合同，但尚未录入任何合作游戏清单。"
            "请在原合同下补入对应游戏和实际分成/通道费，不需要重复新建合同。"
        )
    elif count:
        reason = (
            f"客户已关联 {count} 份合同、{access_count} 条合作游戏清单，"
            "但当前游戏/商业版本、渠道或账期没有找到可用项；请核对原合同下的合作清单。"
        )
    else:
        reason = "客户库目前没有关联的合同，请先核对合同台账中的签约方和客户关联。"
    updated = dict(result)
    updated["contract_catalog"] = catalog
    updated["lines"] = [
        {**line, "message": reason}
        if not line.get("match") and not line.get("auto_apply") and not line.get("selection_error") and not line.get("platform_conflict") and not line.get("platform_ambiguity") and not line.get("commercial_identity_conflict")
        else line
        for line in (result.get("lines") or [])
    ]
    if any(not line.get("match") and not line.get("auto_apply") and not line.get("selection_error") and not line.get("platform_conflict") and not line.get("platform_ambiguity") and not line.get("commercial_identity_conflict")
           for line in (result.get("lines") or [])):
        updated["message"] = reason
    return updated


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
    partner_id = str(payload.get("partner_id") or "").strip()[:128]
    with psycopg.connect(_extended._database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        selected = _verified_partner_selection(
            conn, partner_id, partner_name,
            for_binding=any(str(line.get("access_item_id") or "").strip() for line in lines),
        )
        candidates = _scope_linked_candidates(
            _v12.enrich_candidates_with_game_ids(conn, _extended._candidate_rows(conn)),
            selected,
        )
        resolved_lines = _v12.enrich_lines_with_game_ids(conn, _prepare_explicit_selection_lines(lines))
        result = _extended.recommend_channel_rules(
            partner_name, channel_name, resolved_lines, candidates,
            verified_partner_id=str(selected["id"]) if selected else "",
        )
        result = apply_game_registry_fallback(
            result,
            partner_name=partner_name,
            channel_name=channel_name,
            lines=resolved_lines,
            registry_rules=load_game_registry_rules(conn),
        )
        if selected and any(not item.get("match") and not item.get("auto_apply") for item in result.get("lines") or []):
            catalog = _linked_contract_catalog(conn, str(selected["id"]))
            result = _explain_missing_contract_list(result, catalog)

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
