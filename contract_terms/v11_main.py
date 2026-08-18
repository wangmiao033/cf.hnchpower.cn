"""Production contract service entrypoint with R&D special-settlement closure.

V10 stabilizes the service and removes runtime schema DDL. V11 closes the final
R&D workflow gap: an explicitly documented special settlement on the saved bill
must become the auditable difference disposition instead of forcing finance to
repeat the same decision in a second panel before confirmation.
"""

from __future__ import annotations

from typing import Any

import psycopg
from fastapi import Query, Request
from psycopg.rows import dict_row

try:
    from . import v10_main as _v10
    from . import v9_main as _v9
    from . import v8_main as _v8
    from . import v4_main as _v4
    from .matcher import summarize_results
except ImportError:
    import v10_main as _v10
    import v9_main as _v9
    import v8_main as _v8
    import v4_main as _v4
    from matcher import summarize_results


SPECIAL_SETTLEMENT_REASON = "商务特殊约定"
SPECIAL_SETTLEMENT_MARKERS = (
    "特殊申请",
    "特殊结算",
    "商务特批",
    "特殊审批",
    "特批",
)

# A saved special settlement approves settlement-business deviations for this
# bill line only. Contract identity and authorization are deliberately excluded:
# a finance exception must never silently rewrite who the contract is with or
# extend the legal authorization period.
SPECIAL_SETTLEMENT_OVERRIDEABLE_CHECKS = {
    "share_rate",
    "tax_rate",
    "channel_fee_rate",
    "testing_fee",
    "contract_standard_settlement",
}

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


def _special_overrides_for_bill(bill_id: str) -> tuple[dict[str, dict], str]:
    """Return saved line id -> special-settlement evidence from latest snapshot."""
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

        result: dict[str, dict] = {}
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
                result[line_id] = {
                    "reason": _text(raw.get("override_reason")),
                    "deviations": [
                        _text(item, 100)
                        for item in (raw.get("deviations") or [])
                        if _text(item, 100)
                    ],
                }
        return result, str(snapshot.get("id") or "")


def _auto_accept_special_settlements(
    request: Request,
    bill_id: str,
    result: dict,
    overrides: dict[str, dict] | None = None,
    snapshot_id: str = "",
) -> int:
    """Close amount-difference cases backed by a saved special-settlement decision.

    The approval decision is the persisted R&D entry snapshot itself: the user had
    to save a line that materially deviates from the contract and provide an
    explicit special-settlement reason. Requiring ``contracts.manage`` again here
    incorrectly blocks finance users who are allowed to edit/confirm bills but not
    contract master data. Reconciliation already requires ``contracts.view``; this
    step merely closes the difference case from the immutable saved audit evidence.
    """
    if overrides is None:
        overrides, snapshot_id = _special_overrides_for_bill(bill_id)
    if not overrides:
        return 0

    accepted = 0
    for line in result.get("lines") or []:
        if not isinstance(line, dict):
            continue
        line_id = _text(line.get("line_id"), 128)
        override = overrides.get(line_id) or {}
        reason = _text(override.get("reason"))
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


def _apply_special_settlement_line_policy(result: dict, overrides: dict[str, dict]) -> dict:
    """Make a saved special settlement effective for line-level business deviations.

    Difference cases only exist when the deterministic *amount* differs. A line can
    still intentionally deviate from share/channel-fee/tax/test-fee contract fields
    while both expected and actual settlement are zero. Those rows used to stay
    ``fail`` forever because there was no amount case to accept. This policy treats
    the saved special-settlement snapshot as the approval for those explicit
    settlement fields, while retaining hard blockers such as authorization expiry.
    """
    if not overrides:
        return result

    lines: list[dict] = []
    special_count = 0
    for source in result.get("lines") or []:
        line = dict(source)
        line_id = _text(line.get("line_id"), 128)
        override = overrides.get(line_id)
        if not override:
            lines.append(line)
            continue

        reason = _text(override.get("reason"))
        if not reason or not line.get("match"):
            # A special settlement cannot manufacture a missing contract identity.
            lines.append(line)
            continue

        checks: list[dict] = []
        hard_fail_labels: list[str] = []
        overridden_labels: list[str] = []
        for raw_check in line.get("checks") or []:
            check = dict(raw_check)
            if check.get("status") == "fail":
                key = _text(check.get("key"), 100)
                if key in SPECIAL_SETTLEMENT_OVERRIDEABLE_CHECKS:
                    overridden_labels.append(_text(check.get("label"), 100) or key)
                    check["original_status"] = "fail"
                    check["status"] = "manual"
                    check["special_settlement_override"] = True
                    original_message = _text(check.get("message"), 1000)
                    check["message"] = (
                        f"特殊结算已核准；本期允许偏离合同。原核验：{original_message}"
                        if original_message
                        else "特殊结算已核准；本期允许偏离合同。"
                    )
                else:
                    hard_fail_labels.append(_text(check.get("label"), 100) or key or "合同硬性条件")
            checks.append(check)

        line["checks"] = checks
        line["special_settlement"] = {
            "approved": not hard_fail_labels,
            "reason_type": SPECIAL_SETTLEMENT_REASON,
            "reason": reason,
            "declared_deviations": list(override.get("deviations") or []),
            "overridden_checks": overridden_labels,
            "hard_fail_checks": hard_fail_labels,
        }

        if hard_fail_labels:
            line["status"] = "fail"
            line["message"] = (
                "特殊结算已留痕，但以下合同硬性条件不能被特批跳过："
                + "、".join(hard_fail_labels)
            )
        else:
            # Keep the audit visible as a warning, but remove it from confirmation
            # blockers. The original contract and original failed check remain in
            # the payload through original_status + contract values.
            line["status"] = "warning"
            line["message"] = f"特殊结算已核准 · {reason}"
            special_count += 1
        lines.append(line)

    summary = summarize_results(lines)
    bill_checks = list(result.get("bill_checks") or [])
    if bill_checks:
        summary["warning_count"] += len(bill_checks)
        summary["issue_count"] += len(bill_checks)
        if summary["overall_status"] == "pass":
            summary["overall_status"] = "warning"
        summary["can_auto_confirm"] = False

    old_summary = result.get("summary") or {}
    for key in (
        "binding_count",
        "manual_binding_count",
        "auto_binding_count",
        "amount_status",
        "amount_comparable_lines",
        "amount_deterministic_lines",
        "amount_expected",
        "amount_actual",
        "amount_difference",
        "handled_difference_lines",
        "unresolved_difference_lines",
    ):
        if key in old_summary:
            summary[key] = old_summary.get(key)
    summary["special_settlement_lines"] = special_count

    updated = dict(result)
    updated["lines"] = lines
    updated["summary"] = summary
    updated["special_settlement_summary"] = {
        "approved_lines": special_count,
        "total_saved_overrides": len(overrides),
    }
    return updated


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
    overrides: dict[str, dict] = {}
    if bill_type == "rd":
        overrides, snapshot_id = _special_overrides_for_bill(bill_id)
        accepted = _auto_accept_special_settlements(
            request,
            bill_id,
            result,
            overrides=overrides,
            snapshot_id=snapshot_id,
        )
        if accepted:
            # Re-run after the disposition so amount cases are represented with
            # their final resolved state before line-level override policy runs.
            result = _v9.reconcile_bill_contract_v31(
                request,
                bill_type=bill_type,
                bill_id=bill_id,
            )
        result = _apply_special_settlement_line_policy(result, overrides)

    output = dict(result)
    output["entry_version"] = "contract-driven-rd-v3.3-special-settlement-line-policy"
    output["special_settlement_auto_resolved"] = accepted
    return output
