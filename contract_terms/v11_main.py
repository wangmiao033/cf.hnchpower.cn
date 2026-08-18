"""Production contract service entrypoint with R&D special-settlement closure.

V10 stabilizes the service and removes runtime schema DDL. V11 closes the final
R&D workflow gap: an explicitly documented special settlement on the saved bill
must become the auditable difference disposition instead of forcing finance to
repeat the same decision in a second panel before confirmation.
"""

from __future__ import annotations

from typing import Any

import psycopg
from fastapi import HTTPException, Query, Request
from psycopg.rows import dict_row

try:
    from . import v10_main as _v10
    from . import v9_main as _v9
    from . import v8_main as _v8
    from . import v4_main as _v4
except ImportError:
    import v10_main as _v10
    import v9_main as _v9
    import v8_main as _v8
    import v4_main as _v4


SPECIAL_SETTLEMENT_REASON = "商务特殊约定"
SPECIAL_SETTLEMENT_MARKERS = (
    "特殊申请",
    "特殊结算",
    "商务特批",
    "特殊审批",
    "特批",
)

# Keep the existing difference-case transport/API, but make the dedicated
# special-settlement reason a first-class accepted reason. The v4 handler reads
# this module-level set at request time, so the existing secured v8 endpoint and
# UI button immediately use the same canonical value.
_v4.REASON_TYPES.add(SPECIAL_SETTLEMENT_REASON)


def _text(value: Any, limit: int = 1000) -> str:
    return str(value or "").strip()[:limit]


def _is_special_override(item: dict) -> bool:
    reason = _text(item.get("override_reason"))
    deviations = item.get("deviations")
    has_deviation = isinstance(deviations, list) and len(deviations) > 0
    explicit = bool(item.get("special_settlement")) or any(
        marker in reason for marker in SPECIAL_SETTLEMENT_MARKERS
    )
    return bool(reason and has_deviation and explicit)


def _special_overrides_for_bill(bill_id: str) -> tuple[dict[str, str], str]:
    """Return saved line id -> special-settlement reason from latest RD snapshot."""
    with psycopg.connect(_v9._database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        snapshot = _v9._latest_snapshot(conn, bill_id)
        if not snapshot:
            return {}, ""
        metadata = snapshot.get("metadata") or []
        if not isinstance(metadata, list):
            return {}, str(snapshot.get("id") or "")

        # Older finalized snapshots normally have saved_line_id. Keep an index
        # fallback so previously saved bills can benefit without being edited again.
        line_rows = conn.execute(
            """
            SELECT id, sort_order
            FROM reconciliation_line_items
            WHERE reconciliation_id = %s
            ORDER BY sort_order, created_at, id
            """,
            [bill_id],
        ).fetchall()
        indexed_ids = [str(row["id"]) for row in line_rows]

        result: dict[str, str] = {}
        for position, raw in enumerate(metadata):
            if not isinstance(raw, dict) or not _is_special_override(raw):
                continue
            line_id = _text(raw.get("saved_line_id"), 128)
            if not line_id:
                try:
                    line_index = int(raw.get("line_index", position))
                except (TypeError, ValueError):
                    line_index = position
                if 0 <= line_index < len(indexed_ids):
                    line_id = indexed_ids[line_index]
            if line_id:
                result[line_id] = _text(raw.get("override_reason"))
        return result, str(snapshot.get("id") or "")


def _can_manage_contracts(request: Request) -> bool:
    try:
        _v9._require_permission(request, "contracts.manage")
        return True
    except HTTPException:
        return False


def _auto_accept_special_settlements(request: Request, bill_id: str, result: dict) -> int:
    overrides, snapshot_id = _special_overrides_for_bill(bill_id)
    if not overrides or not _can_manage_contracts(request):
        return 0

    accepted = 0
    for line in result.get("lines") or []:
        if not isinstance(line, dict):
            continue
        line_id = _text(line.get("line_id"), 128)
        reason = overrides.get(line_id)
        case = line.get("difference_case") or {}
        case_id = _text(case.get("id"), 128)
        if not reason or not case_id:
            continue

        status = _text(case.get("status"), 40)
        handling = _text(case.get("handling_type"), 80)
        if status == "resolved":
            continue
        # Never silently replace a deliberate adjustment/carry-forward workflow.
        if handling not in {"", "edit_bill"}:
            continue

        _v8._handle_difference_case(
            request,
            case_id,
            {
                "action": "accept_difference",
                "reason_type": SPECIAL_SETTLEMENT_REASON,
                "description": reason,
                "owner": "",
                "evidence": [
                    {
                        "source": "rd_contract_entry_snapshot",
                        "snapshot_id": snapshot_id,
                        "line_id": line_id,
                    }
                ],
            },
        )
        accepted += 1
    return accepted


# Reuse V10 so all DDL-free guards, structured commercial variants and exception
# handling remain active. Replace only the reconcile-v3 GET route.
app = _v10.app
app.router.routes[:] = [
    route
    for route in app.router.routes
    if not (
        getattr(route, "path", "") == "/api/contract-terms/reconcile-v3"
        and "GET" in (getattr(route, "methods", set()) or set())
    )
]


@app.get("/api/contract-terms/reconcile-v3")
def reconcile_bill_contract_v32(
    request: Request,
    bill_type: str = Query(..., pattern="^(rd|channel)$"),
    bill_id: str = Query(..., min_length=1, max_length=128),
) -> dict:
    # First pass preserves the complete V3.1 flow: recover pending entry snapshot,
    # reconcile contract amounts and create/update difference cases.
    result = _v9.reconcile_bill_contract_v31(
        request,
        bill_type=bill_type,
        bill_id=bill_id,
    )

    accepted = 0
    if bill_type == "rd":
        accepted = _auto_accept_special_settlements(request, bill_id, result)
        if accepted:
            # Re-run after the disposition so the caller receives the final policy
            # result in the same request: resolved special differences are no longer
            # counted as blocking failures.
            result = _v9.reconcile_bill_contract_v31(
                request,
                bill_type=bill_type,
                bill_id=bill_id,
            )

    output = dict(result)
    output["entry_version"] = "contract-driven-rd-v3.2-special-settlement"
    output["special_settlement_auto_resolved"] = accepted
    return output
