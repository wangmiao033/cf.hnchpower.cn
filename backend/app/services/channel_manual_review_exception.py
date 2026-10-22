"""One authorized July bill exception, not a channel-wide settlement policy.

Only the attachment requirement is exceptional. Amount calculation, contracts,
permissions and the saved bill's full revision remain independent controls.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
import hmac
import json

from fastapi import HTTPException
from sqlalchemy import text

from app.models.channel import ChannelRecord, ChannelRecordLineItem
from app.services.bill_write_preflight import _as_utc
from app.services.channel_platform_variance_approval import _cents, assess_channel_platform_variance

EXCEPTION_CODE = "4399_july_2026_single_bill_v1"
STATEMENT_NO = "QD-20261015-041F2B"
PARTNER_NAME = "四三九九网络股份有限公司"
CHANNEL_NAME = "4399"
MONTH = "2026-07"
# The authorized bill was observed in the previous day's saved UI inventory.
# A newly created bill must never acquire this exception by taking its number.
ORIGIN_CUTOFF = datetime(2026, 10, 22, tzinfo=timezone.utc)


def _blocked(code, message):
    raise HTTPException(409, detail={"error": code, "message": message})


def _value(value):
    if isinstance(value, datetime):
        return _as_utc(value).isoformat()
    if isinstance(value, (Decimal, float)):
        return str(Decimal(str(value)).normalize())
    return value


def _row_snapshot(row, model):
    # Include every persisted original field, not only totals. A name/rule edit
    # which happens to preserve the amount must invalidate the pending review.
    return {column.key: _value(getattr(row, column.key, None)) for column in model.__table__.columns}


def _original_bill_identity(db, bill):
    # Migration 075 makes original creation events append-only. Fail closed if
    # that safety migration is absent/disabled; current mutable numbers are not
    # an authority for transferring the exception to another internal bill ID.
    protected = db.execute(text("""
        SELECT EXISTS (
            SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
            WHERE t.tgrelid = 'operation_logs'::regclass
              AND t.tgname = 'trg_operation_logs_append_only'
              AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')
              AND t.tgtype = 27 AND p.proname = 'app_reject_operation_log_mutation'
        )
    """)).scalar_one()
    if protected is not True:
        _blocked("manual_review_origin_unverified", "原始创建记录的不可变保护未验证，单笔例外暂不可用")
    origins = db.execute(text("""
        SELECT id, entity_id, created_at, metadata
        FROM operation_logs
        WHERE entity_type = 'channel' AND action = 'create' AND entity_number = :number
        ORDER BY created_at, id LIMIT 2
    """), {"number": STATEMENT_NO}).mappings().all()
    if len(origins) != 1:
        _blocked("manual_review_origin_unverified", "原始创建记录缺失或不唯一，不能将单笔例外转移到其他账单")
    origin = origins[0]
    created = origin.get("created_at")
    metadata = origin.get("metadata") or {}
    if (str(origin.get("entity_id")) != str(bill.id)
            or not isinstance(created, datetime) or _as_utc(created) >= ORIGIN_CUTOFF
            or not isinstance(getattr(bill, "created_at", None), datetime)
            or _as_utc(bill.created_at) >= ORIGIN_CUTOFF
            or not isinstance(metadata, dict)
            or metadata.get("table") != "channel_records" or metadata.get("operation") != "INSERT"):
        _blocked("manual_review_origin_unverified", "当前内部账单ID与获授权原始创建记录不一致，单笔例外不可迁移")
    return {"event_id": str(origin["id"]), "bill_id": str(origin["entity_id"]), "created_at": _value(created)}


def resolve_manual_review_exception(db, bill, lines):
    if (getattr(bill, "statement_no", None) != STATEMENT_NO
            or getattr(bill, "partner_name", None) != PARTNER_NAME
            or getattr(bill, "channel_name", None) != CHANNEL_NAME
            or getattr(bill, "settlement_month", None) != MONTH
            or getattr(bill, "status", None) != "pending"):
        return None
    if (not lines or any(getattr(line, "settlement_cycle", None) != MONTH for line in lines)
            or not isinstance(getattr(bill, "updated_at", None), datetime)):
        return None
    assessment = assess_channel_platform_variance(bill, lines, allow_documented_variance=True)
    if (_cents(assessment["system_amount"]) != 13585
            or _cents(assessment["platform_amount"]) != 14440
            or _cents(assessment["recorded_settlement_amount"]) != 14440
            or assessment["signed_difference_cents"] != -855):
        return None
    origin = _original_bill_identity(db, bill)
    customers = db.execute(text("""
        SELECT id, name, category FROM cf_partner_records
        WHERE name = :name ORDER BY id LIMIT 2
    """), {"name": PARTNER_NAME}).mappings().all()
    if len(customers) != 1 or customers[0].get("category") != "渠道":
        _blocked("manual_review_customer_ambiguous", "4399结算主体未唯一确认，不能使用单笔例外")
    partner_id = str(customers[0]["id"])
    snapshot = {
        "exception": EXCEPTION_CODE, "partner_id": partner_id, "origin": origin,
        "bill": _row_snapshot(bill, ChannelRecord),
        "lines": [_row_snapshot(line, ChannelRecordLineItem) for line in sorted(lines, key=lambda row: str(row.id))],
    }
    revision = sha256(json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {
        "code": EXCEPTION_CODE, "partner_id": partner_id, "partner_name": PARTNER_NAME,
        "bill_id": str(bill.id), "statement_no": STATEMENT_NO, "settlement_month": MONTH,
        "review_revision": revision, "updated_at": _as_utc(bill.updated_at).isoformat(),
        "origin": origin,
    }


def validate_manual_review_exception(db, bill, lines, *, code, revision, partner_id, confirmed, reason):
    if code != EXCEPTION_CODE:
        _blocked("manual_review_exception_invalid", "本次人工例外不适用于当前账单")
    if db.get_bind().dialect.name == "postgresql":
        # Row locks alone cannot prevent a concurrent duplicate-name INSERT.
        # Hold only for this short confirmation transaction, never persist a
        # customer-setting change. GET is advisory; POST repeats every check.
        db.execute(text("LOCK TABLE cf_partner_records IN SHARE MODE"))
    policy = resolve_manual_review_exception(db, bill, lines)
    if not policy or partner_id != policy["partner_id"]:
        _blocked("manual_review_exception_invalid", "账单、主体、月份或金额不符合已授权的单笔例外")
    if not revision or not hmac.compare_digest(str(revision), policy["review_revision"]):
        _blocked("manual_review_revision_changed", "账单原始字段或版本已变化，请重新打开并人工核对；本次未确认")
    if not confirmed or len(str(reason or "").strip()) < 12:
        raise HTTPException(422, detail={"error": "manual_review_basis_required", "message": "请填写至少12个字的真实核对依据，并明确勾选本次单笔人工确认"})
    return policy
