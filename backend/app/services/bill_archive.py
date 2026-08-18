"""账单归档：只影响日常列表可见性，不改账单生命周期和财务事实。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.models.channel import ChannelRecord
from app.models.operation_log import OperationLog
from app.models.reconciliation import ReconciliationRecord
from app.models.user import AuthUser
from app.services.bill_lifecycle import bill_financial_state, normalize_status

AUTO_ARCHIVE_DAYS = 7
NON_ARCHIVABLE_STATUSES = {"draft", "pending", "cancelled", "canceled"}


def _bill_model(bill_type: str):
    if bill_type == "rd":
        return ReconciliationRecord
    if bill_type == "channel":
        return ChannelRecord
    raise HTTPException(status_code=422, detail={"error": "invalid_bill_type", "message": "账单类型无效"})


def _load_bill(db: Session, bill_type: str, bill_id: str):
    model = _bill_model(bill_type)
    bill = db.get(model, bill_id)
    if bill is None:
        raise HTTPException(status_code=404, detail={"error": "bill_not_found", "message": "账单不存在"})
    return bill


def _is_archived(db: Session, bill_type: str, bill_id: str) -> bool:
    value = db.execute(
        text(
            """
            SELECT 1
            FROM bill_archive_states
            WHERE bill_type = :bill_type AND bill_id = :bill_id
            """
        ),
        {"bill_type": bill_type, "bill_id": bill_id},
    ).scalar_one_or_none()
    return value is not None


def _last_activity_at(db: Session, bill_type: str, bill) -> datetime:
    latest_log = db.execute(
        select(OperationLog.created_at)
        .where(OperationLog.entity_type == bill_type, OperationLog.entity_id == str(bill.id))
        .order_by(OperationLog.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    candidates = [getattr(bill, "updated_at", None), latest_log, getattr(bill, "created_at", None)]
    values = [value for value in candidates if isinstance(value, datetime)]
    if not values:
        return datetime.now(timezone.utc)
    normalized = []
    for value in values:
        normalized.append(value if value.tzinfo else value.replace(tzinfo=timezone.utc))
    return max(normalized)


def archive_eligibility(db: Session, bill_type: str, bill) -> tuple[bool, str, datetime | None]:
    current_status = normalize_status(getattr(bill, "status", None))
    if current_status in NON_ARCHIVABLE_STATUSES:
        return False, "账单尚未完成核对或已作废", None

    financial = bill_financial_state(db, bill_type, bill)
    if financial.bill_amount <= 0.01:
        return False, "零结算账单暂不自动归档", None

    if bill_type == "rd" and financial.invoice_coverage_status != "complete":
        return False, "研发账单发票尚未收齐", None

    if financial.payment_phase != "paid":
        verb = "付款" if bill_type == "rd" else "收款"
        return False, f"{verb}尚未结清", None

    if bill_type == "rd":
        return True, "发票已收齐且付款已结清，可自动归档", _last_activity_at(db, bill_type, bill)
    return True, "已结清，可归档", _last_activity_at(db, bill_type, bill)


def _write_archive_log(
    db: Session,
    bill_type: str,
    bill,
    *,
    action: str,
    source: str,
    user: AuthUser | None,
    closure_at: datetime | None = None,
) -> None:
    is_archive = action == "archive"
    db.add(
        OperationLog(
            id=str(uuid4()),
            entity_type=bill_type,
            entity_id=str(bill.id),
            entity_number=str(getattr(bill, "statement_no", None) or "") or None,
            action=action,
            summary=("系统自动归档账单" if source == "auto" else "账单已归档") if is_archive else "账单已取消归档",
            actor_user_id=str(getattr(user, "id", None) or "") or None,
            actor_email=str(getattr(user, "email", None) or "") or None,
            changes={
                "archive_state": {
                    "before": "未归档" if is_archive else "已归档",
                    "after": "已归档" if is_archive else "未归档",
                }
            },
            metadata_json={
                "archive_source": source,
                "closure_at": closure_at.isoformat() if closure_at else None,
                "auto_archive_days": (
                    0 if source == "auto" and bill_type == "rd"
                    else AUTO_ARCHIVE_DAYS if source == "auto"
                    else None
                ),
            },
        )
    )


def archive_bill(
    db: Session,
    bill_type: str,
    bill_id: str,
    *,
    user: AuthUser | None,
    source: str = "manual",
    enforce_eligibility: bool = True,
) -> dict:
    bill = _load_bill(db, bill_type, bill_id)
    if _is_archived(db, bill_type, bill_id):
        return {"bill_type": bill_type, "bill_id": bill_id, "archived": True, "already_archived": True}

    eligible, reason, closure_at = archive_eligibility(db, bill_type, bill)
    if enforce_eligibility and not eligible:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "archive_not_ready", "message": reason},
        )

    db.execute(
        text(
            """
            INSERT INTO bill_archive_states (
              bill_type, bill_id, archived_at, archived_by_user_id, archived_by_email,
              archive_source, closure_at
            ) VALUES (
              :bill_type, :bill_id, NOW(), :user_id, :email, :source, :closure_at
            )
            ON CONFLICT (bill_type, bill_id) DO NOTHING
            """
        ),
        {
            "bill_type": bill_type,
            "bill_id": bill_id,
            "user_id": str(getattr(user, "id", None) or "") or None,
            "email": str(getattr(user, "email", None) or "") or None,
            "source": source,
            "closure_at": closure_at,
        },
    )
    _write_archive_log(db, bill_type, bill, action="archive", source=source, user=user, closure_at=closure_at)
    db.commit()
    return {"bill_type": bill_type, "bill_id": bill_id, "archived": True, "already_archived": False}


def auto_archive_bill_if_ready(db: Session, bill_type: str, bill_id: str) -> bool:
    """Immediately archive a single RD bill once invoice and payment are both complete."""
    if bill_type != "rd" or _is_archived(db, bill_type, bill_id):
        return False
    bill = _load_bill(db, bill_type, bill_id)
    eligible, _, _ = archive_eligibility(db, bill_type, bill)
    if not eligible:
        return False
    archive_bill(
        db,
        bill_type,
        bill_id,
        user=None,
        source="auto",
        enforce_eligibility=False,
    )
    return True


def unarchive_bill(db: Session, bill_type: str, bill_id: str, *, user: AuthUser) -> dict:
    bill = _load_bill(db, bill_type, bill_id)
    if not _is_archived(db, bill_type, bill_id):
        return {"bill_type": bill_type, "bill_id": bill_id, "archived": False, "already_unarchived": True}

    db.execute(
        text("DELETE FROM bill_archive_states WHERE bill_type = :bill_type AND bill_id = :bill_id"),
        {"bill_type": bill_type, "bill_id": bill_id},
    )
    _write_archive_log(db, bill_type, bill, action="unarchive", source="manual", user=user)
    db.commit()
    return {"bill_type": bill_type, "bill_id": bill_id, "archived": False, "already_unarchived": False}


def auto_archive_settled_bills(db: Session, bill_type: str) -> int:
    model = _bill_model(bill_type)
    bills = db.execute(select(model)).scalars().all()
    archived_ids = {
        str(row[0])
        for row in db.execute(
            text("SELECT bill_id FROM bill_archive_states WHERE bill_type = :bill_type"),
            {"bill_type": bill_type},
        ).all()
    }
    cutoff = datetime.now(timezone.utc) - timedelta(days=AUTO_ARCHIVE_DAYS)
    archived_count = 0

    for bill in bills:
        bill_id = str(bill.id)
        if bill_id in archived_ids:
            continue
        eligible, _, closure_at = archive_eligibility(db, bill_type, bill)
        if not eligible:
            continue

        # 研发账单：收到完整进项发票且付款结清后立即归档，不再等待 7 天。
        # 渠道账单继续保留原来的 7 天缓冲期，避免改变应收侧既有习惯。
        if bill_type != "rd":
            if closure_at is None:
                continue
            safe_closure = closure_at if closure_at.tzinfo else closure_at.replace(tzinfo=timezone.utc)
            if safe_closure > cutoff:
                continue

        archive_bill(
            db,
            bill_type,
            bill_id,
            user=None,
            source="auto",
            enforce_eligibility=False,
        )
        archived_count += 1
        archived_ids.add(bill_id)

    return archived_count


def archive_snapshot(db: Session, bill_type: str, *, run_auto: bool = True) -> dict:
    auto_count = auto_archive_settled_bills(db, bill_type) if run_auto else 0
    model = _bill_model(bill_type)
    bills = db.execute(select(model)).scalars().all()
    archive_rows = db.execute(
        text(
            """
            SELECT bill_id, archived_at, archived_by_email, archive_source, closure_at
            FROM bill_archive_states
            WHERE bill_type = :bill_type
            ORDER BY archived_at DESC
            """
        ),
        {"bill_type": bill_type},
    ).mappings().all()
    archived_ids = {str(row["bill_id"]) for row in archive_rows}

    eligible_ids: list[str] = []
    for bill in bills:
        bill_id = str(bill.id)
        if bill_id in archived_ids:
            continue
        eligible, _, _ = archive_eligibility(db, bill_type, bill)
        if eligible:
            eligible_ids.append(bill_id)

    items = [
        {
            "bill_id": str(row["bill_id"]),
            "archived_at": row["archived_at"].isoformat() if row["archived_at"] else None,
            "archived_by_email": row["archived_by_email"],
            "archive_source": row["archive_source"],
            "closure_at": row["closure_at"].isoformat() if row["closure_at"] else None,
        }
        for row in archive_rows
    ]
    return {
        "bill_type": bill_type,
        "archived_ids": sorted(archived_ids),
        "eligible_ids": sorted(eligible_ids),
        "items": items,
        "auto_archived_count": auto_count,
        "auto_archive_days": 0 if bill_type == "rd" else AUTO_ARCHIVE_DAYS,
    }
