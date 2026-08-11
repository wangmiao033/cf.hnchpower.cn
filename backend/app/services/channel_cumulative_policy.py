"""Partner-level cumulative settlement policy and pool calculations."""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.bill_invoice_allocation import BillInvoiceAllocation
from app.models.channel import ChannelRecord
from app.models.channel_cumulative_settlement import (
    ChannelCumulativeSettlementBatch,
    ChannelCumulativeSettlementBatchItem,
    ChannelCumulativeSettlementPolicy,
)

EPS = 0.01
ACTIVE_ALLOCATION_STATUSES = ("suggested", "confirmed")


def _num(value: Any) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed == parsed else 0.0


def normalize_partner_key(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    text = re.sub(r"[\s()（）·,，.。\-_/\\]", "", text)
    for suffix in ("股份有限公司", "有限责任公司", "有限公司"):
        if text.endswith(suffix):
            text = text[: -len(suffix)]
            break
    return text[:500]


def policy_to_dict(row: ChannelCumulativeSettlementPolicy | None, partner_name: str = "") -> dict:
    if row is None:
        return {
            "id": None,
            "partner_key": normalize_partner_key(partner_name),
            "partner_name": str(partner_name or "").strip(),
            "settlement_mode": "periodic",
            "threshold_basis": "billing_flow",
            "threshold_amount": 0.0,
            "scope": "partner",
            "enabled": False,
            "note": "",
        }
    return {
        "id": str(row.id),
        "partner_key": str(row.partner_key),
        "partner_name": str(row.partner_name),
        "settlement_mode": str(row.settlement_mode or "periodic"),
        "threshold_basis": str(row.threshold_basis or "billing_flow"),
        "threshold_amount": round(_num(row.threshold_amount), 2),
        "scope": str(row.scope or "partner"),
        "enabled": bool(row.enabled),
        "note": str(row.note or ""),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def policy_for_partner(db: Session, partner_name: Any) -> ChannelCumulativeSettlementPolicy | None:
    key = normalize_partner_key(partner_name)
    if not key:
        return None
    return db.execute(
        select(ChannelCumulativeSettlementPolicy).where(
            ChannelCumulativeSettlementPolicy.partner_key == key,
            ChannelCumulativeSettlementPolicy.enabled.is_(True),
        )
    ).scalar_one_or_none()


def is_threshold_policy(policy: ChannelCumulativeSettlementPolicy | None) -> bool:
    return bool(
        policy
        and policy.enabled
        and str(policy.settlement_mode or "") == "threshold"
        and _num(policy.threshold_amount) > EPS
    )


def basis_amount_for_bill(row: ChannelRecord, basis: str) -> float:
    if basis == "settlement_amount":
        return round(max(0.0, _num(row.settlement_amount)), 2)
    return round(max(0.0, _num(row.billing_flow)), 2)


def active_batch_bill_ids(db: Session, bill_ids: Iterable[str] | None = None) -> set[str]:
    stmt = (
        select(ChannelCumulativeSettlementBatchItem.bill_id)
        .join(ChannelCumulativeSettlementBatch, ChannelCumulativeSettlementBatch.id == ChannelCumulativeSettlementBatchItem.batch_id)
        .where(
            ChannelCumulativeSettlementBatchItem.released_at.is_(None),
            ChannelCumulativeSettlementBatch.status != "cancelled",
        )
    )
    ids = [str(item) for item in (bill_ids or []) if item]
    if ids:
        stmt = stmt.where(ChannelCumulativeSettlementBatchItem.bill_id.in_(ids))
    return {str(value) for value in db.execute(stmt).scalars().all()}


def invoice_touched_bill_ids(db: Session, bill_ids: list[str]) -> set[str]:
    if not bill_ids:
        return set()
    return {
        str(value)
        for value in db.execute(
            select(BillInvoiceAllocation.bill_id).where(
                BillInvoiceAllocation.bill_type == "channel",
                BillInvoiceAllocation.bill_id.in_(bill_ids),
                BillInvoiceAllocation.status.in_(ACTIVE_ALLOCATION_STATUSES),
                BillInvoiceAllocation.allocated_gross_amount > EPS,
            )
        ).scalars().all()
    }


def pool_candidates(db: Session, policy: ChannelCumulativeSettlementPolicy) -> list[ChannelRecord]:
    key = str(policy.partner_key)
    rows = db.execute(
        select(ChannelRecord).where(
            func.lower(func.coalesce(ChannelRecord.status, "pending")) == "confirmed",
            ChannelRecord.settlement_amount >= 0,
        ).order_by(ChannelRecord.settlement_month.asc(), ChannelRecord.created_at.asc())
    ).scalars().all()
    rows = [row for row in rows if normalize_partner_key(row.partner_name or row.channel_name) == key]
    ids = [str(row.id) for row in rows]
    batched = active_batch_bill_ids(db, ids)
    invoiced = invoice_touched_bill_ids(db, ids)
    return [
        row for row in rows
        if str(row.id) not in batched
        and str(row.id) not in invoiced
        and abs(_num(row.received_amount)) <= EPS
    ]


def pool_state(db: Session, partner_name: Any) -> dict:
    raw_partner = str(partner_name or "").strip()
    policy = policy_for_partner(db, raw_partner)
    policy_payload = policy_to_dict(policy, raw_partner)
    if not is_threshold_policy(policy):
        return {
            "policy": policy_payload,
            "state": "periodic",
            "ready": False,
            "deferred": False,
            "basis_total": 0.0,
            "settlement_total": 0.0,
            "remaining_to_threshold": 0.0,
            "progress_percent": 0.0,
            "bill_count": 0,
            "period_start": None,
            "period_end": None,
            "bills": [],
        }

    rows = pool_candidates(db, policy)
    basis = str(policy.threshold_basis or "billing_flow")
    threshold = round(_num(policy.threshold_amount), 2)
    bills = [
        {
            "bill_id": str(row.id),
            "bill_number": str(row.statement_no or row.id),
            "settlement_month": str(row.settlement_month or ""),
            "game_name": str(row.game_name or ""),
            "basis_amount": basis_amount_for_bill(row, basis),
            "settlement_amount": round(_num(row.settlement_amount), 2),
        }
        for row in rows
    ]
    basis_total = round(sum(item["basis_amount"] for item in bills), 2)
    settlement_total = round(sum(item["settlement_amount"] for item in bills), 2)
    ready = basis_total + EPS >= threshold
    months = sorted({item["settlement_month"] for item in bills if item["settlement_month"]})
    return {
        "policy": policy_payload,
        "state": "ready" if ready else "accumulating",
        "ready": ready,
        "deferred": bool(bills),
        "basis_total": basis_total,
        "settlement_total": settlement_total,
        "remaining_to_threshold": round(max(0.0, threshold - basis_total), 2),
        "progress_percent": round(min(100.0, basis_total / threshold * 100), 1) if threshold > EPS else 0.0,
        "bill_count": len(bills),
        "period_start": months[0] if months else None,
        "period_end": months[-1] if months else None,
        "bills": bills,
    }


def deferred_bill_ids(db: Session, rows: Iterable[ChannelRecord]) -> set[str]:
    candidates = [row for row in rows if str(row.status or "pending").strip().lower() == "confirmed"]
    if not candidates:
        return set()
    policies = db.execute(
        select(ChannelCumulativeSettlementPolicy).where(
            ChannelCumulativeSettlementPolicy.enabled.is_(True),
            ChannelCumulativeSettlementPolicy.settlement_mode == "threshold",
            ChannelCumulativeSettlementPolicy.threshold_amount > EPS,
        )
    ).scalars().all()
    policy_keys = {str(row.partner_key) for row in policies}
    ids = [str(row.id) for row in candidates]
    batched = active_batch_bill_ids(db, ids)
    invoiced = invoice_touched_bill_ids(db, ids)
    return {
        str(row.id)
        for row in candidates
        if normalize_partner_key(row.partner_name or row.channel_name) in policy_keys
        and str(row.id) not in batched
        and str(row.id) not in invoiced
        and abs(_num(row.received_amount)) <= EPS
        and _num(row.settlement_amount) >= 0
    }
