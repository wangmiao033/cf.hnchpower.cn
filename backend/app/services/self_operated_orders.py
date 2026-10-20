"""大熊游戏独立现金订单入库服务。

正式开关默认关闭。绝不复用或修改渠道账单、研发账单及银行流水。
同订单号再次提交仅对完全一致的金额/游戏/日期/分类幂等跳过；
任何冲突必须整批回滚，且每次成功提交留存批次审计。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session

from app.models.self_operated import SelfOperatedImportBatch, SelfOperatedOrder
from app.schemas.self_operated import (
    SelfOperatedConfirmRequest,
    SelfOperatedConfirmResult,
    SelfOperatedGameSummary,
    SelfOperatedImportAudit,
    SelfOperatedMonthlySummary,
)

_SOURCE = "daxiong"
_MONTH_RE = re.compile(r"^20\d{2}-(0[1-9]|1[0-2])$")
_BATCH_LIMIT = 250
_BACKUP_BRANCH_PATTERN = re.compile(r"^br-[a-z0-9-]{6,70}$")


def _gate_status() -> str:
    """Explicit opt-in after independently verified *production* Neon recovery."""
    verified_branch = os.getenv("DAXIONG_VERIFIED_BACKUP_BRANCH_ID", "").strip()
    verified_at = os.getenv("DAXIONG_VERIFIED_BACKUP_AT", "").strip()
    project = os.getenv("DAXIONG_VERIFIED_PRODUCTION_PROJECT_ID", "").strip()
    if not verified_branch or not _BACKUP_BRANCH_PATTERN.fullmatch(verified_branch) or not project:
        return "backup_not_verified"
    if project != os.getenv("DAXIONG_PRODUCTION_NEON_PROJECT_ID", "").strip():
        return "backup_project_not_confirmed"
    try:
        when = datetime.fromisoformat(verified_at.replace("Z", "+00:00"))
        if when.tzinfo is None:
            raise ValueError("Timezone required")
    except ValueError:
        return "backup_time_not_verified"
    age = datetime.now(timezone.utc) - when.astimezone(timezone.utc)
    if age < timedelta(seconds=-60) or age > timedelta(hours=72):
        return "backup_verification_expired"
    if os.getenv("DAXIONG_ORDERS_WRITES_ENABLED", "").strip().lower() != "true":
        return "writes_disabled"
    return "ready"


def schema_installed(db: Session) -> bool:
    inspector = inspect(db.get_bind())
    return (
        inspector.has_table("self_operated_import_batches")
        and inspector.has_table("self_operated_orders")
    )


def readiness(db: Session) -> tuple[bool, bool, str]:
    schema_ready = schema_installed(db)
    gate = _gate_status()
    return schema_ready, schema_ready and gate == "ready", (
        "schema_not_installed" if not schema_ready else gate
    )


def _canonical(row) -> dict:
    return {
        "order_id": row.order_id,
        "game_id": row.game_id.strip(),
        "game_name": row.game_name.strip(),
        "amount_cents": row.amount_cents,
        "paid_date": row.paid_date.isoformat(),
        "kind": row.kind,
    }


def _signature(row) -> tuple:
    return (
        row.game_id, row.game_name, row.amount_cents,
        row.paid_date.isoformat() if hasattr(row.paid_date, "isoformat") else str(row.paid_date),
        row.order_kind if hasattr(row, "order_kind") else row.kind,
    )


def _request_digest(rows) -> str:
    normalized = sorted((_canonical(row) for row in rows), key=lambda row: row["order_id"])
    payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _chunks(rows, n=_BATCH_LIMIT):
    for offset in range(0, len(rows), n):
        yield rows[offset:offset + n]


def _batch_result(batch, *, replayed: bool) -> SelfOperatedConfirmResult:
    return SelfOperatedConfirmResult(
        import_id=batch.id,
        replayed=replayed,
        submitted=batch.submitted_count,
        inserted=batch.inserted_count,
        skipped_existing=batch.duplicate_count,
        inserted_game_cents=batch.inserted_game_cents,
        inserted_coin_cents=batch.inserted_coin_cents,
        created_at=batch.created_at,
    )


def _already_present(db: Session, ids: list[str]) -> dict[str, SelfOperatedOrder]:
    existing: dict[str, SelfOperatedOrder] = {}
    for chunk in _chunks(ids):
        rows = db.execute(
            select(SelfOperatedOrder).where(
                SelfOperatedOrder.source_label == _SOURCE,
                SelfOperatedOrder.external_order_id.in_(chunk),
            )
        ).scalars().all()
        existing.update((item.external_order_id, item) for item in rows)
    return existing


def _validate_no_conflicts(rows, existing: dict[str, SelfOperatedOrder]) -> None:
    conflict_ids = []
    for row in rows:
        current = existing.get(row.order_id)
        if current is not None and _signature(current) != _signature(row):
            conflict_ids.append(row.order_id)
    if conflict_ids:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "order_conflicts",
                "message": "存在与已保存订单号相同、但金额或业务信息不同的记录；本批次没有写入。",
                "conflict_count": len(conflict_ids),
                "sample_ids": conflict_ids[:5],
            },
        )


def _import_insert(db: Session, records: list[dict]) -> set[str]:
    """INSERT..ON CONFLICT DO NOTHING and RETURNING, supports PostgreSQL and SQLite tests."""
    driver = db.get_bind().dialect.name
    if driver == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    elif driver == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:
        raise RuntimeError("该数据库驱动暂未经过正式入账验证")

    inserted_ids: set[str] = set()
    for chunk in _chunks(records, 200):
        stmt = insert(SelfOperatedOrder).values(chunk)
        stmt = stmt.on_conflict_do_nothing(
            index_elements=["source_label", "external_order_id"]
        ).returning(SelfOperatedOrder.external_order_id)
        inserted_ids.update(db.execute(stmt).scalars().all())
    return inserted_ids


def confirm_order_import(
    db: Session,
    payload: SelfOperatedConfirmRequest,
    *,
    user_id: str,
) -> SelfOperatedConfirmResult:
    ready, write_ready, reason = readiness(db)
    if not write_ready:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "self_operated_write_locked",
                "reason": reason,
                "message": "大熊游戏正式入账未启用：须先完成生产数据库恢复备份和独立迁移。",
            },
        )

    filename = payload.source_filename.replace("\\", "/").split("/")[-1].strip()
    if not filename:
        raise HTTPException(status_code=422, detail="文件名称无效")
    request_key = str(payload.request_key)
    id_set: set[str] = set()
    for row in payload.rows:
        if row.order_id in id_set:
            raise HTTPException(status_code=422, detail={
                "error": "duplicate_order_in_submission",
                "message": "本次请求包含重复订单号，请先在本地预览中去重。",
            })
        id_set.add(row.order_id)

    digest = _request_digest(payload.rows)
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        # Cross-request serialization. Unique constraint remains the ultimate guard.
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext('daxiong_order_import_v1'))"))

    existing_batch = db.execute(
        select(SelfOperatedImportBatch)
        .where(SelfOperatedImportBatch.request_key == request_key)
    ).scalar_one_or_none()
    if existing_batch:
        if (
            existing_batch.payload_digest != digest
            or existing_batch.submitted_by_user_id != user_id
        ):
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "request_key_reused",
                    "message": "相同导入请求标识对应不同数据，禁止覆盖历史导入记录。",
                },
            )
        return _batch_result(existing_batch, replayed=True)

    existing = _already_present(db, list(id_set))
    _validate_no_conflicts(payload.rows, existing)

    now = datetime.now(timezone.utc)
    batch = SelfOperatedImportBatch(
        id=str(uuid4()),
        request_key=request_key,
        payload_digest=digest,
        source_filename=filename,
        source_label=_SOURCE,
        submitted_by_user_id=user_id,
        submitted_count=len(payload.rows),
        inserted_count=0,
        duplicate_count=0,
        inserted_game_cents=0,
        inserted_coin_cents=0,
        created_at=now,
    )
    db.add(batch)
    db.flush()

    values = [
        {
            "id": str(uuid4()),
            "source_label": _SOURCE,
            "external_order_id": item.order_id,
            "game_id": item.game_id.strip(),
            "game_name": item.game_name.strip(),
            "order_kind": item.kind,
            "amount_cents": item.amount_cents,
            "paid_date": item.paid_date,
            "settlement_month": item.paid_date.strftime("%Y-%m"),
            "import_batch_id": batch.id,
            "created_at": now,
        }
        for item in payload.rows
    ]
    inserted_ids = _import_insert(db, values)

    # With a competing import the unique index might have accepted fewer records.
    # Re-query and compare all records before committing anything.
    after = _already_present(db, list(id_set))
    _validate_no_conflicts(payload.rows, after)
    if len(after) != len(id_set):
        raise HTTPException(status_code=409, detail={
            "error": "incomplete_insert",
            "message": "订单写入未完全核对，整个批次已撤销，请重试。",
        })

    batch.inserted_count = len(inserted_ids)
    batch.duplicate_count = len(payload.rows) - len(inserted_ids)
    batch.inserted_game_cents = sum(
        item.amount_cents for item in payload.rows
        if item.order_id in inserted_ids and item.kind == "game"
    )
    batch.inserted_coin_cents = sum(
        item.amount_cents for item in payload.rows
        if item.order_id in inserted_ids and item.kind == "coin"
    )
    db.flush()
    return _batch_result(batch, replayed=False)


def monthly_summary(db: Session, month: str) -> SelfOperatedMonthlySummary:
    if not _MONTH_RE.fullmatch(month):
        raise HTTPException(status_code=422, detail="账期格式必须为 YYYY-MM")

    schema_ready, write_ready, reason = readiness(db)
    summary = SelfOperatedMonthlySummary(
        schema_ready=schema_ready,
        write_ready=write_ready,
        status_reason=reason,
        settlement_month=month,
    )
    if not schema_ready:
        return summary

    order = SelfOperatedOrder
    rollups = db.execute(
        select(
            order.order_kind,
            func.count(order.id),
            func.coalesce(func.sum(order.amount_cents), 0),
        ).where(
            order.source_label == _SOURCE,
            order.settlement_month == month,
        ).group_by(order.order_kind)
    ).all()

    for kind, count, total in rollups:
        if kind == "game":
            summary.game_orders = int(count)
            summary.game_cents = int(total)
        elif kind == "coin":
            summary.coin_orders = int(count)
            summary.coin_cents = int(total)

    games = db.execute(
        select(
            order.game_id,
            order.game_name,
            func.count(order.id),
            func.sum(order.amount_cents),
        ).where(
            order.source_label == _SOURCE,
            order.settlement_month == month,
            order.order_kind == "game",
        ).group_by(order.game_id, order.game_name)
        .order_by(func.sum(order.amount_cents).desc(), order.game_id, order.game_name)
    ).all()
    summary.games = [
        SelfOperatedGameSummary(
            game_id=game_id, game_name=game_name,
            orders=int(count), amount_cents=int(total),
        )
        for game_id, game_name, count, total in games
    ]
    return summary


def import_history(db: Session, limit: int = 30) -> list[SelfOperatedImportAudit]:
    if not schema_installed(db):
        return []
    rows = db.execute(
        select(SelfOperatedImportBatch)
        .where(SelfOperatedImportBatch.source_label == _SOURCE)
        .order_by(SelfOperatedImportBatch.created_at.desc(), SelfOperatedImportBatch.id.desc())
        .limit(limit)
    ).scalars().all()
    return [SelfOperatedImportAudit.model_validate({
        "id": b.id,
        "source_filename": b.source_filename,
        "submitted_count": b.submitted_count,
        "inserted_count": b.inserted_count,
        "duplicate_count": b.duplicate_count,
        "inserted_game_cents": b.inserted_game_cents,
        "inserted_coin_cents": b.inserted_coin_cents,
        "created_at": b.created_at,
    }) for b in rows]
