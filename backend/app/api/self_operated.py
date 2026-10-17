"""大熊游戏自营渠道订单与广告台账。独立存储，不写入历史研发或银行账单。"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.services.permissions import require_module_access
from app.services.self_operated_import import ImportValidationError, MAX_IMPORT_BYTES, parse_orders

router = APIRouter()
manage_access = Depends(require_module_access("reconciliation.manage"))
_MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


class AdEntryInput(BaseModel):
    expense_date: date
    entry_type: str = Field(pattern=r"^(topup|spend)$")
    ad_platform: str = Field(min_length=1, max_length=120)
    game_external_id: str | None = None
    game_name: str | None = None
    amount: Decimal = Field(gt=0, le=Decimal("1000000000"), max_digits=18, decimal_places=2)
    source_bank: str = Field(default="", max_length=120)
    note: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def check_game(self):
        if self.entry_type == "spend" and not str(self.game_external_id or "").strip():
            raise ValueError("广告实际消耗必须关联游戏ID")
        if self.entry_type == "topup":
            self.game_external_id = None
            self.game_name = None
        return self


class ContractLinkInput(BaseModel):
    settlement_month: str = Field(pattern=_MONTH_PATTERN)
    game_external_id: str = Field(min_length=1, max_length=100)
    settlement_status: str = Field(pattern=r"^(unlinked|linked|no_external_share)$")
    contract_access_item_id: str | None = None
    note: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def check_link(self):
        if self.settlement_status == "linked" and not self.contract_access_item_id:
            raise ValueError("关联状态必须选择现有研发合同")
        if self.settlement_status != "linked":
            self.contract_access_item_id = None
        return self


@router.get("/months")
def months(db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT settlement_month AS month, COUNT(*) AS orders
        FROM self_operated_orders GROUP BY settlement_month ORDER BY settlement_month DESC LIMIT 36
    """)).mappings().all()
    return {"items": [{"month": r["month"], "orders": r["orders"]} for r in rows]}


@router.post("/import", dependencies=[manage_access])
async def upload_orders(file: UploadFile = File(...), db: Session = Depends(get_db)):
    raw = await file.read(MAX_IMPORT_BYTES + 1)
    try:
        parsed = parse_orders(file.filename or "upload.csv", raw)
    except (ImportValidationError, UnicodeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    records = parsed["orders"]
    digest = parsed["digest"]
    batch_id = "dax-" + uuid4().hex
    try:
        # One import at a time, so conflicting duplicate orders never overwrite historic values.
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext('daxiong_order_import_v1'))"))
        old_batch = db.execute(text("""
            SELECT id, records_in_file, records_inserted, records_skipped
            FROM self_operated_import_batches WHERE file_sha256=:sha
        """), {"sha": digest}).mappings().first()
        if old_batch:
            db.rollback()
            return {"ok": True, "duplicate_file": True, "batch_id": old_batch["id"],
                    "read": old_batch["records_in_file"], "inserted": 0,
                    "duplicates": len(records), "months": parsed["months"]}
        indexed = {}
        for pos in range(0, len(records), 500):
            rows = records[pos:pos + 500]
            prior = db.execute(text("""
                SELECT order_no, settlement_month, game_external_id, game_name,
                       payment_status, payment_method, face_amount, paid_amount
                FROM self_operated_orders
                WHERE order_kind=:kind AND order_no=ANY(:numbers)
            """), {"kind": parsed["kind"], "numbers": [r["order_no"] for r in rows]}).mappings().all()
            indexed.update({str(r["order_no"]): r for r in prior})
        for new in records:
            existing = indexed.get(new["order_no"])
            if not existing:
                continue
            comparable = ("settlement_month", "game_external_id", "game_name",
                          "payment_status", "payment_method", "face_amount", "paid_amount")
            if any(str(existing[k]) != str(new[k]) for k in comparable):
                raise HTTPException(status_code=409, detail="订单号已存在且金额或状态变化，请人工核对：" + new["order_no"][:60])
        duplicates = len(indexed)
        db.execute(text("""
            INSERT INTO self_operated_import_batches
                (id,file_sha256,file_name,order_kind,records_in_file,records_inserted,records_skipped)
            VALUES (:id,:sha,:name,:kind,:count,:inserted,:skipped)
        """), {"id": batch_id, "sha": digest, "name": parsed["filename"], "kind": parsed["kind"],
               "count": len(records), "inserted": len(records)-duplicates, "skipped": duplicates})
        payload = []
        for r in records:
            if r["order_no"] in indexed:
                continue
            payload.append({**r, "batch_id": batch_id})
        if payload:
            db.execute(text("""
                INSERT INTO self_operated_orders
                    (order_kind,order_no,settlement_month,order_time,game_external_id,
                     game_name,payment_method,payment_status,face_amount,paid_amount,batch_id)
                VALUES
                    (:order_kind,:order_no,:settlement_month,:order_time,:game_external_id,
                     :game_name,:payment_method,:payment_status,:face_amount,:paid_amount,:batch_id)
            """), payload)
        db.commit()
        return {"ok": True, "duplicate_file": False, "batch_id": batch_id,
                "read": len(records), "inserted": len(payload),
                "duplicates": duplicates, "months": parsed["months"]}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.get("/summary")
def summary(
    month: str = Query(..., pattern=_MONTH_PATTERN),
    db: Session = Depends(get_db)
):
    status = db.execute(text("""
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE payment_status <> '支付成功') AS abnormal
        FROM self_operated_orders WHERE settlement_month=:m
    """), {"m": month}).mappings().one()
    data = db.execute(text("""
        SELECT
            COALESCE(SUM(paid_amount) FILTER (
                WHERE order_kind='game' AND payment_status='支付成功' AND payment_method<>'竹B'),0) AS cash_paid,
            COALESCE(COUNT(*) FILTER (
                WHERE order_kind='game' AND payment_status='支付成功' AND payment_method<>'竹B'),0) AS cash_orders,
            COALESCE(SUM(paid_amount) FILTER (
                WHERE order_kind='token' AND payment_status='支付成功'),0) AS token_topups,
            COALESCE(SUM(paid_amount) FILTER (
                WHERE order_kind='game' AND payment_status='支付成功' AND payment_method='竹B'),0) AS bamboo_used
        FROM self_operated_orders WHERE settlement_month=:m
    """), {"m": month}).mappings().one()
    games = db.execute(text("""
        SELECT o.game_external_id,
               MAX(o.game_name) AS game_name,
               COALESCE(SUM(o.paid_amount),0) AS cash_paid,
               COUNT(*) AS cash_orders,
               link.settlement_status AS contract_status,
               link.contract_access_item_id
        FROM self_operated_orders o
        LEFT JOIN self_operated_contract_links link
          ON link.game_external_id=o.game_external_id AND link.settlement_month=:m
        WHERE o.settlement_month=:m AND o.order_kind='game'
          AND o.payment_status='支付成功' AND o.payment_method<>'竹B'
        GROUP BY o.game_external_id,link.settlement_status,link.contract_access_item_id
        ORDER BY cash_paid DESC, o.game_external_id
    """), {"m": month}).mappings().all()
    ads = db.execute(text("""
        SELECT entry_type, COALESCE(SUM(amount),0) AS total
        FROM self_operated_ad_ledger WHERE expense_month=:m AND deleted_at IS NULL GROUP BY entry_type
    """), {"m": month}).mappings().all()
    by_kind = {r["entry_type"]: float(r["total"]) for r in ads}
    return {
        "month": month, "status": "imported" if status["total"] else "no_import",
        "order_rows": status["total"], "abnormal_orders": status["abnormal"],
        "cash_paid": float(data["cash_paid"]), "cash_orders": data["cash_orders"],
        "token_topups": float(data["token_topups"]),
        "bamboo_used": float(data["bamboo_used"]),
        "ad_topups": by_kind.get("topup", 0), "ad_spend": by_kind.get("spend", 0),
        "rd_payable": None, "profit": None, "profit_status": "pending_contract_and_expenses",
        "games": [
            {"game_external_id": r["game_external_id"], "game_name": r["game_name"],
             "cash_paid": float(r["cash_paid"]), "cash_orders": r["cash_orders"],
             "contract_status": r["contract_status"] or "unlinked",
             "contract_access_item_id": r["contract_access_item_id"]}
            for r in games
        ],
    }


@router.get("/ad-ledger")
def ad_ledger(
    month: str = Query(..., pattern=_MONTH_PATTERN),
    db: Session = Depends(get_db)
):
    rows = db.execute(text("""
        SELECT id, expense_date, entry_type, ad_platform, game_external_id, game_name,
               amount, source_bank, note
        FROM self_operated_ad_ledger WHERE expense_month=:m AND deleted_at IS NULL
        ORDER BY expense_date DESC, created_at DESC LIMIT 2000
    """), {"m": month}).mappings().all()
    return {"items": [
        {**dict(r), "expense_date": str(r["expense_date"]), "amount": float(r["amount"])}
        for r in rows
    ]}


@router.post("/ad-ledger", dependencies=[manage_access])
def add_ad_entry(payload: AdEntryInput, db: Session = Depends(get_db)):
    item = payload.model_dump()
    item["id"] = "daxad-" + uuid4().hex
    item["expense_month"] = payload.expense_date.strftime("%Y-%m")
    item["ad_platform"] = payload.ad_platform.strip()
    db.execute(text("""
        INSERT INTO self_operated_ad_ledger
            (id,expense_month,expense_date,entry_type,ad_platform,game_external_id,
             game_name,amount,source_bank,note)
        VALUES (:id,:expense_month,:expense_date,:entry_type,:ad_platform,:game_external_id,
                :game_name,:amount,:source_bank,:note)
    """), item)
    db.commit()
    return {"ok": True, "id": item["id"]}


@router.get("/contract-candidates")
def contract_candidates(
    game_name: str = Query("", max_length=120),
    db: Session = Depends(get_db),
):
    # Lists existing contract *access items*, not background order's "游戏厂商".
    # Exact linking requires human selection; this API never guesses an R&D contract.
    rows = db.execute(text("""
        SELECT a.id, a.product_name, a.contract_id,
               t.settlement_basis, t.settlement_mode
        FROM cf_contract_access_items a
        LEFT JOIN cf_contract_access_terms t ON t.access_item_id=a.id
        WHERE :q='' OR a.product_name ILIKE :pat
        ORDER BY a.product_name ASC LIMIT 100
    """), {"q": game_name.strip(), "pat": "%" + game_name.strip() + "%"}).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.put("/contract-link", dependencies=[manage_access])
def set_contract_link(payload: ContractLinkInput, db: Session = Depends(get_db)):
    if payload.settlement_status == "linked":
        found = db.execute(text("SELECT 1 FROM cf_contract_access_items WHERE id=:id"),
                           {"id": payload.contract_access_item_id}).first()
        if not found:
            raise HTTPException(status_code=422, detail="所选合同合作游戏不存在，请在合同与客户中确认")
    db.execute(text("""
        INSERT INTO self_operated_contract_links
          (game_external_id,settlement_month,contract_access_item_id,settlement_status,note)
        VALUES (:game_external_id,:settlement_month,:contract_access_item_id,:settlement_status,:note)
        ON CONFLICT (game_external_id,settlement_month) DO UPDATE SET
          contract_access_item_id=EXCLUDED.contract_access_item_id,
          settlement_status=EXCLUDED.settlement_status,
          note=EXCLUDED.note, updated_at=NOW()
    """), payload.model_dump(exclude={"settlement_basis"}))
    db.commit()
    return {"ok": True, "month": payload.settlement_month, "game_id": payload.game_external_id}
