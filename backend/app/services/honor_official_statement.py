"""Honor-only, source-backed settlement confirmation; never a calculation rule.

The customer master is the identity authority. Only its unique exact 荣耀 row
qualifies. Its ID is pinned in the review and checked again under confirmation.
No aliases, display-name substrings, formula codes or caller-supplied IDs qualify.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text

from app.services.channel_platform_variance_approval import _cents

POLICY_CODE = "honor_official_statement_v1"
CUSTOMER_NAME = "荣耀"


def _blocked(code: str, message: str):
    raise HTTPException(409, detail={"error": code, "message": message})


def resolve_honor_policy(db, bill: Any) -> dict | None:
    # A contradictory legal counterparty must never be rescued by a display name.
    if str(getattr(bill, "partner_name", "") or "").strip() != CUSTOMER_NAME:
        return None
    if str(getattr(bill, "channel_name", "") or "").strip() not in {"", CUSTOMER_NAME}:
        return None
    rows = db.execute(text("""
        SELECT id, name, category FROM cf_partner_records
        WHERE name = :name ORDER BY id LIMIT 2
    """), {"name": CUSTOMER_NAME}).mappings().all()
    if len(rows) != 1 or str(rows[0].get("category") or "").strip() != "渠道":
        _blocked("honor_customer_ambiguous", "荣耀客户身份未唯一确认，请先检查客户资料；不能按名称模糊放行")
    return {"code": POLICY_CODE, "partner_id": str(rows[0]["id"]), "partner_name": CUSTOMER_NAME}


def validate_official_line_confirmations(lines, confirmations: list[dict]) -> None:
    current = {str(line.id): line for line in lines}
    if len(confirmations) != len(current) or {str(row.get("line_id")) for row in confirmations} != set(current):
        _blocked("honor_lines_not_confirmed", "请逐游戏勾选确认官方结算金额，不能只核对账单合计")
    for row in confirmations:
        line = current[str(row["line_id"])]
        if (
            str(row.get("game_name") or "") != str(line.game_name or "")
            or str(row.get("settlement_cycle") or "") != str(line.settlement_cycle or "")
            or _cents(row.get("platform_amount")) != _cents(line.platform_settlement_amount)
            or _cents(row.get("system_amount")) != _cents(line.system_settlement_amount)
        ):
            _blocked("honor_line_review_stale", "逐游戏金额或账期已改变，请重新保存并核对官方结算单")


def _utc(value):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def validate_contract_snapshot(snapshot, bill, lines, contract_rows, partner_id, *, now=None, current_links=None):
    """Only monetary comparison is exceptional; identity, rates and authority remain checked.

    Evidence is an immutable server-generated contract snapshot, not a request
    payload. The bill and every matched contract/term must predate it.
    """
    now = now or datetime.now(timezone.utc)
    created = _utc(snapshot.get("created_at"))
    bill_updated = _utc(getattr(bill, "updated_at", None))
    if (
        snapshot.get("bill_type") != "channel" or str(snapshot.get("bill_id")) != str(bill.id)
        or snapshot.get("event_type") != POLICY_CODE or created is None or bill_updated is None
        or created < bill_updated or created > now + timedelta(seconds=30)
        or now - created > timedelta(minutes=10)
    ):
        _blocked("honor_contract_snapshot_stale", "合同核验依据已变化或过期，请重新点击确认；原金额不变")
    result = snapshot.get("result_json") or {}
    if not isinstance(result, dict) or any(c.get("status") == "fail" for c in result.get("bill_checks") or []):
        _blocked("honor_contract_bill_failed", "账单级合同核验未通过，不能按荣耀官方金额确认")
    checked = result.get("lines") or []
    current = {str(line.id): line for line in lines}
    if len(checked) != len(current) or {str(row.get("line_id")) for row in checked} != set(current):
        _blocked("honor_contract_lines_incomplete", "合同核验明细不完整或已变化，暂不能确认")
    contracts = {str(row["access_item_id"]): row for row in contract_rows}
    revisions = result.get("honor_source_revisions")
    if not isinstance(revisions, dict):
        _blocked("honor_contract_revisions_missing", "缺少合同来源版本依据，请重新核验")
    if current_links is not None:
        previous_links = result.get("honor_binding_revisions")
        if not isinstance(previous_links, dict) or set(previous_links) != set(current_links):
            _blocked("honor_contract_binding_changed", "合同绑定新增或删除，请重新核验")
        for line_id, previous in previous_links.items():
            current_link = current_links[line_id]
            if (previous.get("access_item_id") != current_link.get("access_item_id")
                    or _utc(previous.get("updated_at")) != _utc(current_link.get("updated_at"))):
                _blocked("honor_contract_binding_changed", "合同绑定在核验后发生变化，请重新确认")
    for row in checked:
        line = current[str(row["line_id"])]
        match = row.get("match") or {}
        checks = row.get("checks") or []
        amount = row.get("contract_amount") or {}
        authority = next((c for c in checks if c.get("key") == "authorization"), {})
        if (
            str(row.get("game_name") or "") != str(line.game_name or "")
            or str(row.get("settlement_cycle") or "") != str(line.settlement_cycle or "")
            or not match.get("contract_id") or not match.get("access_item_id")
            or match.get("confidence") != "high" or authority.get("status") != "pass"
            or any(c.get("status") == "fail" and c.get("key") != "contract_standard_settlement" for c in checks)
            or not amount.get("deterministic") or not amount.get("supported")
            or _cents(amount.get("actual_amount")) != _cents(line.platform_settlement_amount)
        ):
            _blocked("honor_contract_identity_or_terms_failed", "合同主体、游戏、授权期或费率未通过核验；荣耀官方金额规则只处理金额比较差异")
        if current_links is not None:
            binding = row.get("binding") or {}
            current_binding = current_links.get(str(line.id)) or {}
            if (str(binding.get("access_item_id") or "") != str(current_binding.get("access_item_id") or "")
                    or (_utc(current_binding.get("updated_at")) or created) > created):
                _blocked("honor_contract_binding_changed", "合同绑定在核验后发生变化，请重新确认")
        contract = contracts.get(str(match["access_item_id"]))
        if not contract or str(contract.get("contract_id")) != str(match["contract_id"]):
            _blocked("honor_contract_changed", "合同合作清单已变化，请重新核验")
        linked_id = str(contract.get("partner_id") or "")
        if (linked_id and linked_id != partner_id) or (not linked_id and contract.get("counterparty") != CUSTOMER_NAME):
            _blocked("honor_contract_wrong_customer", "合同不属于已核实的荣耀客户，不能使用专属规则")
        revision = revisions.get(str(match["access_item_id"]))
        if not isinstance(revision, dict):
            _blocked("honor_contract_revisions_missing", "合同来源版本不完整，请重新核验")
        for field in ("contract_updated_at", "access_updated_at", "terms_updated_at"):
            changed = _utc(contract.get(field))
            if changed != _utc(revision.get(field)) or (changed is not None and changed > created):
                _blocked("honor_contract_changed", "合同规则在核验后发生变化，请重新确认")
    return result


def load_and_validate_contract_snapshot(db, snapshot_id, bill, lines, partner_id):
    snapshot = db.execute(text("""
        SELECT id, bill_type, bill_id, event_type, created_at, result_json
        FROM cf_contract_reconciliation_snapshots WHERE id = :id
    """), {"id": snapshot_id}).mappings().first()
    if not snapshot:
        _blocked("honor_contract_snapshot_missing", "缺少本次服务器合同核验记录，暂不能确认")
    result = snapshot.get("result_json") or {}
    access_ids = [str((row.get("match") or {}).get("access_item_id") or "") for row in result.get("lines") or []]
    contracts = db.execute(text("""
        SELECT a.id AS access_item_id, a.contract_id, c.partner_id, c.counterparty,
               c.updated_at AS contract_updated_at, a.updated_at AS access_updated_at,
               t.updated_at AS terms_updated_at
        FROM cf_contract_access_items a
        JOIN cf_contract_records c ON c.id = a.contract_id
        LEFT JOIN cf_contract_access_terms t ON t.access_item_id = a.id
        WHERE a.id = ANY(:ids)
        FOR SHARE OF a, c
    """), {"ids": access_ids}).mappings().all()
    # Terms are optional, so PostgreSQL cannot lock them through the nullable
    # side of the outer join. Lock/re-read existing terms separately.
    terms = db.execute(text("""
        SELECT access_item_id, updated_at FROM cf_contract_access_terms
        WHERE access_item_id = ANY(:ids) FOR SHARE
    """), {"ids": access_ids}).mappings().all()
    terms_updated = {str(row["access_item_id"]): row["updated_at"] for row in terms}
    contracts = [dict(row, terms_updated_at=terms_updated.get(str(row["access_item_id"]))) for row in contracts]
    links = db.execute(text("""
        SELECT line_id, access_item_id, updated_at FROM cf_bill_contract_links
        WHERE bill_type = 'channel' AND bill_id = :bill_id FOR SHARE
    """), {"bill_id": str(bill.id)}).mappings().all()
    validate_contract_snapshot(snapshot, bill, lines, contracts, partner_id,
                               current_links={str(row["line_id"]): row for row in links})
    return dict(snapshot)


def official_amount_case_ids(cases, lines):
    """Accept only plain monetary cases, including stale IDs for the same game/month.

    Fresh complete server snapshot validation runs first. Active adjustment,
    carry-forward or edit workflows and non-amount failures are never waived.
    """
    keys = {(str(line.game_name or ""), str(line.settlement_cycle or "")) for line in lines}
    accepted = []
    for case in cases:
        if (str(case.get("game_name") or ""), str(case.get("settlement_cycle") or "")) not in keys:
            continue
        if case.get("status") == "resolved":
            continue
        snapshot = case.get("source_snapshot_json") or {}
        checks = snapshot.get("checks") or []
        if (
            case.get("status") != "pending" or case.get("handling_type")
            or not checks
            or any(c.get("status") == "fail" and c.get("key") != "contract_standard_settlement" for c in checks)
        ):
            _blocked("honor_contract_workflow_open", "仍有费率、授权或正在处理的合同差异，不能用官方金额规则覆盖")
        accepted.append(str(case["id"]))
    return accepted
