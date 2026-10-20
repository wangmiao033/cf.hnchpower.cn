"""大熊游戏独立订单永久台账：默认关闭，必须经过数据库备份后显式启用。"""

from __future__ import annotations

import os
from datetime import date
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_current_user
from app.models.user import AuthUser
from app.services.daxiong_order_import import MAX_SOURCE_BYTES, OrderImportRejected, ParsedOrderFile, parse_audited_csv
from app.services.permissions import normalize_role

router = APIRouter()

# Written records cannot be enabled by accident when frontend code is deployed.
# The branch identifier is operational attestation, not a substitute for actually
# checking the recovery point and separately running migration 076.
_FLAG = "DAXIONG_ORDER_SAVE_ENABLED"
_BACKUP_FLAG = "DAXIONG_VERIFIED_BACKUP_BRANCH"


def _admin_only(user: AuthUser) -> None:
    if normalize_role(user.role) != "admin" or not user.is_active:
        raise HTTPException(status_code=403, detail="大熊游戏正式订单保存仅管理员可操作")


def _authorized_to_use_db() -> bool:
    return (
        os.environ.get(_FLAG, "").strip().lower() in {"true", "1", "yes"}
        and bool(os.environ.get(_BACKUP_FLAG, "").strip())
    )


def _require_enabled() -> None:
    if not _authorized_to_use_db():
        raise HTTPException(status_code=423, detail="大熊游戏正式订单尚未开放；须先验证可恢复数据库备份")


def _schema_exists(db: Session) -> bool:
    return bool(db.execute(text(
        "SELECT to_regclass('public.daxiong_order_records') IS NOT NULL "
        "AND to_regclass('public.daxiong_order_import_batches') IS NOT NULL"
    )).scalar_one())


@router.get("/status")
def status(
    user: AuthUser = Depends(require_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _admin_only(user)
    if not _authorized_to_use_db():
        return {"can_save": False, "can_read": False, "reason": "backup_or_flag_missing"}
    if not _schema_exists(db):
        return {"can_save": False, "can_read": False, "reason": "migration_not_applied"}
    return {"can_save": True, "can_read": True, "reason": None}


def _required_ready(db: Session, user: AuthUser) -> None:
    _admin_only(user)
    _require_enabled()
    if not _schema_exists(db):
        raise HTTPException(status_code=503, detail="自营订单新表尚未创建，不允许直接写入其他财务表")


def _check_expected(
    parsed: ParsedOrderFile,
    *,
    game_cash_cents: int,
    coin_topup_cents: int,
    eligible_count: int,
) -> None:
    if (
        parsed.game_cash_cents != game_cash_cents
        or parsed.coin_topup_cents != coin_topup_cents
        or parsed.eligible_count != eligible_count
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "error": "source_totals_changed",
                "message": "浏览器预览与服务端再次核对金额或订单数不一致，已阻止整次保存；请先核对原始文件",
            },
        )


def _batch_result(existing, *, duplicate_file: bool) -> dict:
    return {
        "batch_id": str(existing["id"]),
        "duplicate_file": duplicate_file,
        "rows": int(existing["records_read"]),
        "eligible": int(existing["records_eligible"]),
        "inserted": 0 if duplicate_file else int(existing["records_inserted"]),
        "existing": int(existing["records_eligible"]) if duplicate_file else int(existing["records_existing"]),
        "excluded": int(existing["records_excluded"]),
        "game_cash_cents": int(existing["game_cash_cents"]),
        "coin_topup_cents": int(existing["coin_topup_cents"]),
    }


@router.post("/import")
async def import_csv(
    file: UploadFile = File(...),
    expected_game_cash_cents: int = Form(..., ge=0),
    expected_coin_topup_cents: int = Form(..., ge=0),
    expected_eligible_count: int = Form(..., ge=1, le=30000),
    confirm: str = Form(...),
    user: AuthUser = Depends(require_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _required_ready(db, user)
    if confirm != "CONFIRM_DAXIONG_CASH_ORDERS":
        raise HTTPException(status_code=422, detail="必须在核对服务端金额后明确确认保存")
    blob = await file.read(MAX_SOURCE_BYTES+1)
    try:
        parsed = parse_audited_csv(file.filename or "orders.csv", blob)
    except OrderImportRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _check_expected(
        parsed, game_cash_cents=expected_game_cash_cents,
        coin_topup_cents=expected_coin_topup_cents, eligible_count=expected_eligible_count,
    )

    try:
        # All imports are serialized; idempotency is also enforced by unique
        # constraints, so simultaneous submissions cannot add duplicate income.
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext('daxiong_cash_import_v2'))"))
        prior_batch = db.execute(text("""
            SELECT id, records_read, records_eligible, records_inserted,
                   records_existing, records_excluded, game_cash_cents, coin_topup_cents
            FROM daxiong_order_import_batches WHERE source_file_sha256=:sha
        """), {"sha": parsed.sha256}).mappings().first()
        if prior_batch:
            db.rollback()
            return _batch_result(prior_batch, duplicate_file=True)

        orders = parsed.orders
        prior: dict[str, str] = {}
        for start in range(0,len(orders),500):
            ids = [o.order_id for o in orders[start:start+500]]
            matches=db.execute(text("""
                SELECT order_id, source_fingerprint FROM daxiong_order_records
                WHERE order_id = ANY(:ids)
            """), {"ids": ids}).mappings().all()
            for match in matches:
                prior[str(match["order_id"])] = str(match["source_fingerprint"])
        for item in orders:
            existing_fingerprint = prior.get(item.order_id)
            if existing_fingerprint is not None and existing_fingerprint != item.fingerprint:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "error": "conflicting_order_number",
                        "message": "数据库已有同订单号但金额、日期、游戏或类型不同的记录；已回滚整次导入",
                    },
                )

        inserted = [item for item in orders if item.order_id not in prior]
        batch_id = "dax-import-" + uuid4().hex
        db.execute(text("""
            INSERT INTO daxiong_order_import_batches
              (id,source_file_sha256,source_file_name,source_size_bytes,original_csv,
               records_read,records_eligible,records_inserted,records_existing,records_excluded,
               game_cash_cents,coin_topup_cents,imported_by_user_id)
            VALUES
              (:id,:sha,:name,:size,:raw,
               :read,:eligible,:inserted,:existing,:excluded,
               :game_cents,:coin_cents,:user_id)
        """), {
            "id":batch_id,"sha":parsed.sha256,"name":parsed.filename,"size":len(blob),"raw":parsed.raw,
            "read":parsed.records_read,"eligible":parsed.eligible_count,
            "inserted":len(inserted),"existing":len(prior),
            "excluded":parsed.excluded,"game_cents":parsed.game_cash_cents,
            "coin_cents":parsed.coin_topup_cents,"user_id":str(user.id),
        })
        payload=[]
        for item in inserted:
            payload.append({
                "order_id": item.order_id, "paid_date": item.paid_date,
                "paid_month": item.paid_month,"game_id":item.game_external_id,
                "game_name":item.game_name,"cents":item.cash_paid_cents,
                "kind":item.order_kind,"method":item.payment_method,
                "fingerprint":item.fingerprint,"batch_id":batch_id,
                "user_id":str(user.id),
            })
        if payload:
            db.execute(text("""
                INSERT INTO daxiong_order_records
                  (order_id,paid_date,paid_month,game_external_id,game_name,
                   cash_paid_cents,order_kind,payment_method,source_fingerprint,
                   first_batch_id,recorded_by_user_id)
                VALUES
                  (:order_id,:paid_date,:paid_month,:game_id,:game_name,
                   :cents,:kind,:method,:fingerprint,:batch_id,:user_id)
            """), payload)
        db.commit()
        return {
            "batch_id":batch_id,"duplicate_file":False,
            "rows":parsed.records_read,"eligible":parsed.eligible_count,
            "inserted":len(inserted),"existing":len(prior),
            "excluded":parsed.excluded,"game_cash_cents":parsed.game_cash_cents,
            "coin_topup_cents":parsed.coin_topup_cents,
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.get("/months")
def available_months(
    user: AuthUser = Depends(require_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _required_ready(db,user)
    months=db.execute(text("""
        SELECT paid_month, COUNT(*) AS records,
               COALESCE(SUM(cash_paid_cents) FILTER (WHERE order_kind='game'),0) AS game_cents,
               COALESCE(SUM(cash_paid_cents) FILTER (WHERE order_kind='coin'),0) AS coin_cents
        FROM daxiong_order_records
        GROUP BY paid_month ORDER BY paid_month DESC LIMIT 48
    """)).mappings().all()
    return {"items":[{
        "month":r["paid_month"],"records":int(r["records"]),
        "game_cash_cents":int(r["game_cents"]),"coin_topup_cents":int(r["coin_cents"]),
    } for r in months]}


@router.get("/summary")
def monthly_summary(
    month: str = Query(...,pattern=r"^20\d{2}-(0[1-9]|1[0-2])$"),
    user: AuthUser = Depends(require_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _required_ready(db,user)
    totals=db.execute(text("""
        SELECT COUNT(*) FILTER (WHERE order_kind='game') AS game_orders,
               COUNT(*) FILTER (WHERE order_kind='coin') AS coin_orders,
               COALESCE(SUM(cash_paid_cents) FILTER (WHERE order_kind='game'),0) AS game_cents,
               COALESCE(SUM(cash_paid_cents) FILTER (WHERE order_kind='coin'),0) AS coin_cents
        FROM daxiong_order_records WHERE paid_month=:month
    """),{"month":month}).mappings().one()
    games=db.execute(text("""
        SELECT game_external_id AS id,game_name AS name,
               COUNT(*) AS orders, SUM(cash_paid_cents) AS cash_cents
        FROM daxiong_order_records WHERE paid_month=:month AND order_kind='game'
        GROUP BY game_external_id,game_name
        ORDER BY cash_cents DESC,game_external_id,game_name LIMIT 250
    """),{"month":month}).mappings().all()
    return {
        "month":month,"source":"saved-orders",
        "game_orders":int(totals["game_orders"] or 0),
        "coin_orders":int(totals["coin_orders"] or 0),
        "game_cash_cents":int(totals["game_cents"]),
        "coin_topup_cents":int(totals["coin_cents"]),
        "games":[{
            "id":r["id"],"name":r["name"],
            "orders":int(r["orders"]),"cash_cents":int(r["cash_cents"]),
        } for r in games],
        "rd_payable":None,"ad_spend":None,"profit":None,
    }


@router.get("/batches")
def import_history(
    user: AuthUser = Depends(require_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _required_ready(db,user)
    batches=db.execute(text("""
        SELECT id, source_file_name,source_file_sha256,records_read,
               records_eligible,records_inserted,records_existing,records_excluded,
               game_cash_cents,coin_topup_cents,created_at
        FROM daxiong_order_import_batches ORDER BY created_at DESC LIMIT 100
    """)).mappings().all()
    return {"items":[{
        **{key:(str(val) if key in ("created_at",) else val) for key,val in row.items()}
    } for row in batches]}


@router.get("/batches/{batch_id}/source")
def archived_source(
    batch_id: str,
    user: AuthUser = Depends(require_current_user),
    db: Session = Depends(get_db),
) -> Response:
    _required_ready(db,user)
    row=db.execute(text("""
        SELECT source_file_name,original_csv
        FROM daxiong_order_import_batches WHERE id=:id
    """),{"id":batch_id}).mappings().first()
    if row is None:
        raise HTTPException(status_code=404,detail="未找到对应订单导入批次")
    return Response(
        content=bytes(row["original_csv"]),
        media_type="application/octet-stream",
        headers={"Content-Disposition":"attachment; filename*=UTF-8''"+quote(str(row["source_file_name"]))},
    )
