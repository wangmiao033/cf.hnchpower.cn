"""渠道对账 CRUD API：主表 + 明细行。"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.blob_storage import delete_private_blob, private_blob_response, upload_private_blob
from app.core.deps import get_db
from app.models.bank_reconciliation_match import BankReconciliationMatch
from app.models.bank_transaction import BankTransaction
from app.models.channel import ChannelReceipt, ChannelRecord, ChannelRecordLineItem
from app.schemas.channel import (
    ChannelLineItemCreate,
    ChannelLineItemRead,
    ChannelReceiptCreate,
    ChannelReceiptListResponse,
    ChannelReceiptRead,
    ChannelRecordCreate,
    ChannelRecordListResponse,
    ChannelRecordRead,
    ChannelRecordUpdate,
)
from app.services.channel_cumulative_batch import refresh_batches_for_bill
from app.services.channel_cumulative_invoice import assert_single_bill_collection_allowed
from app.services.channel_settlement_engine import aggregate_validation, calculate_channel_line

router = APIRouter()
RECEIPT_EPS = 0.01


def _recompute_receipt_rollup(db: Session, row: ChannelRecord) -> None:
    total_raw = db.execute(
        select(func.coalesce(func.sum(ChannelReceipt.amount), 0)).where(ChannelReceipt.channel_record_id == row.id)
    ).scalar_one()
    row.received_amount = float(total_raw or 0)
    receivable = max(0.0, float(row.settlement_amount or 0))
    recv = row.received_amount
    if receivable <= RECEIPT_EPS:
        row.receipt_status = "paid" if recv <= RECEIPT_EPS else "overpaid"
    elif recv > receivable + RECEIPT_EPS:
        row.receipt_status = "overpaid"
    elif recv + RECEIPT_EPS >= receivable:
        row.receipt_status = "paid"
    elif recv <= RECEIPT_EPS:
        row.receipt_status = "unpaid"
    else:
        row.receipt_status = "partial"


def _receipt_total(db: Session, record_id: str) -> float:
    total_raw = db.execute(
        select(func.coalesce(func.sum(ChannelReceipt.amount), 0)).where(ChannelReceipt.channel_record_id == record_id)
    ).scalar_one()
    return float(total_raw or 0)


def _receipt_source_maps(db: Session, receipt_ids: list[str]) -> tuple[dict[str, BankReconciliationMatch], dict[str, BankTransaction]]:
    if not receipt_ids:
        return {}, {}
    matches = (
        db.execute(
            select(BankReconciliationMatch)
            .where(BankReconciliationMatch.generated_receipt_id.in_(receipt_ids))
            .order_by(BankReconciliationMatch.confirmed_at.desc())
        )
        .scalars()
        .all()
    )
    match_map: dict[str, BankReconciliationMatch] = {}
    for match in matches:
        receipt_id = str(match.generated_receipt_id or "")
        if not receipt_id:
            continue
        current = match_map.get(receipt_id)
        if current is None or (current.status != "confirmed" and match.status == "confirmed"):
            match_map[receipt_id] = match
    tx_ids = list({str(match.bank_transaction_id) for match in match_map.values() if match.bank_transaction_id})
    tx_rows = db.execute(select(BankTransaction).where(BankTransaction.id.in_(tx_ids))).scalars().all() if tx_ids else []
    tx_map = {str(row.id): row for row in tx_rows}
    return match_map, tx_map


def _receipt_read(row: ChannelReceipt, match: BankReconciliationMatch | None, tx: BankTransaction | None) -> ChannelReceiptRead:
    base = ChannelReceiptRead.model_validate(row)
    if match is None:
        return base
    active = str(match.status or "") == "confirmed"
    return base.model_copy(update={
        "source_type": "bank_allocation",
        "source_label": "银行流水核销" if active else "银行核销已撤销",
        "bank_match_id": str(match.id),
        "bank_transaction_id": str(match.bank_transaction_id),
        "bank_transaction_no": str(tx.transaction_no or "") if tx is not None else None,
        "bank_match_status": str(match.status or ""),
        "can_delete_directly": not active,
    })


def _sync_denormalized_totals(row: ChannelRecord, db: Session) -> None:
    items = (
        db.execute(
            select(ChannelRecordLineItem)
            .where(ChannelRecordLineItem.channel_record_id == row.id)
            .order_by(ChannelRecordLineItem.sort_order)
        )
        .scalars()
        .all()
    )
    if not items:
        return
    row.billing_flow = round(sum(float(i.billing_flow or 0) * float(i.discount_factor or 1) for i in items), 2)
    row.voucher_cost = float(sum(float(i.voucher_cost or 0) for i in items))
    row.no_worry_cost = float(sum(float(i.no_worry_cost or 0) for i in items))
    row.refund_cost = float(sum(float(i.refund_cost or 0) for i in items))
    row.test_cost = float(sum(float(i.test_cost or 0) for i in items))
    row.welfare_cost = float(sum(float(i.welfare_cost or 0) for i in items))
    row.coin_cost = float(sum(float(i.coin_cost or 0) for i in items))
    row.billing_amount = float(sum(float(i.billing_amount or 0) for i in items))
    row.share_amount = float(sum(float(i.share_amount or 0) for i in items))
    row.gateway_cost = float(sum(float(i.gateway_cost or 0) for i in items))
    row.settlement_amount = float(sum(float(i.settlement_amount or 0) for i in items))
    row.tax_rate = float(items[0].tax_rate or 0)
    row.share_rate = float(items[0].share_rate or 0)
    validation = aggregate_validation(items)
    row.system_settlement_amount = float(validation["system_total"])
    row.platform_settlement_amount = float(validation["platform_total"]) if validation["platform_total"] is not None else None
    row.settlement_difference = float(validation["difference_total"]) if validation["difference_total"] is not None else None
    row.validation_status = validation["validation_status"]
    names = [i.game_name for i in items if i.game_name]
    row.game_name = "、".join(names)[:2000] if names else None


def _legacy_items_from_row(row: ChannelRecord) -> list[ChannelLineItemRead]:
    if not (row.game_name or row.billing_flow):
        return []
    return [
        ChannelLineItemRead(
            id=f"legacy-{row.id}", channel_record_id=row.id, sort_order=0,
            game_name=row.game_name, billing_flow=float(row.billing_flow or 0), discount_factor=1.0,
            voucher_cost=float(row.voucher_cost or 0), no_worry_cost=float(row.no_worry_cost or 0),
            refund_cost=float(row.refund_cost or 0), test_cost=float(row.test_cost or 0),
            welfare_cost=float(row.welfare_cost or 0), coin_cost=float(row.coin_cost or 0), share_rate=float(row.share_rate or 0),
            billing_amount=float(row.billing_amount or 0), share_amount=float(row.share_amount or 0),
            tax_rate=float(row.tax_rate or 0), gateway_cost=float(row.gateway_cost or 0),
            platform_settlement_amount=row.platform_settlement_amount,
            system_settlement_amount=float(row.system_settlement_amount or row.settlement_amount or 0),
            settlement_difference=row.settlement_difference, validation_status=row.validation_status or "unvalidated",
            settlement_amount=float(row.settlement_amount or 0), created_at=row.created_at, updated_at=row.updated_at,
        )
    ]


def _to_read(row: ChannelRecord) -> ChannelRecordRead:
    li = list(row.line_items or [])
    item_reads = [ChannelLineItemRead.model_validate(x) for x in sorted(li, key=lambda x: x.sort_order)] if li else _legacy_items_from_row(row)
    base = ChannelRecordRead.model_validate(row)
    return base.model_copy(update={"items": item_reads})


def _replace_line_items(db: Session, parent: ChannelRecord, items: list[ChannelLineItemCreate]) -> None:
    db.execute(delete(ChannelRecordLineItem).where(ChannelRecordLineItem.channel_record_id == parent.id))
    db.flush()
    for idx, it in enumerate(items):
        raw = it.model_dump(exclude={"billing_amount", "share_amount", "system_settlement_amount", "settlement_difference", "validation_status", "settlement_amount"})
        line = ChannelRecordLineItem(id=str(uuid4()), channel_record_id=parent.id, sort_order=idx, **raw)
        computed = calculate_channel_line(line, parent)
        for key, value in computed.items():
            setattr(line, key, value)
        db.add(line)
    db.flush()


def _apply_filters(stmt, *, search, settlement_month, channel_name, game_name, status):
    if search and search.strip():
        term = f"%{search.strip()}%"
        item_game = exists(select(ChannelRecordLineItem.id).where(ChannelRecordLineItem.channel_record_id == ChannelRecord.id, ChannelRecordLineItem.game_name.ilike(term)))
        stmt = stmt.where(or_(ChannelRecord.statement_no.ilike(term), ChannelRecord.channel_name.ilike(term), ChannelRecord.game_name.ilike(term), ChannelRecord.settlement_month.ilike(term), ChannelRecord.remark.ilike(term), ChannelRecord.start_date.ilike(term), item_game))
    if settlement_month and settlement_month.strip(): stmt = stmt.where(ChannelRecord.settlement_month == settlement_month.strip())
    if channel_name and channel_name.strip(): stmt = stmt.where(ChannelRecord.channel_name.ilike(f"%{channel_name.strip()}%"))
    if game_name and game_name.strip():
        t = f"%{game_name.strip()}%"
        stmt = stmt.where(exists(select(ChannelRecordLineItem.id).where(ChannelRecordLineItem.channel_record_id == ChannelRecord.id, ChannelRecordLineItem.game_name.ilike(t))))
    if status and status.strip(): stmt = stmt.where(ChannelRecord.status == status.strip())
    return stmt


@router.get("", response_model=ChannelRecordListResponse)
def list_channel_records(db: Session = Depends(get_db), search: str | None = Query(None), settlement_month: str | None = Query(None), channel_name: str | None = Query(None), game_name: str | None = Query(None), status: str | None = Query(None), limit: int = Query(200, ge=1, le=500), offset: int = Query(0, ge=0)) -> ChannelRecordListResponse:
    base = _apply_filters(select(ChannelRecord).options(selectinload(ChannelRecord.line_items)), search=search, settlement_month=settlement_month, channel_name=channel_name, game_name=game_name, status=status)
    count_stmt = _apply_filters(select(func.count(ChannelRecord.id)), search=search, settlement_month=settlement_month, channel_name=channel_name, game_name=game_name, status=status)
    total = int(db.execute(count_stmt).scalar_one())
    rows = db.execute(base.order_by(ChannelRecord.created_at.desc()).limit(limit).offset(offset)).scalars().all()
    return ChannelRecordListResponse(items=[_to_read(r) for r in rows], total=total)


@router.post("/receipt-attachment", status_code=status.HTTP_201_CREATED)
async def upload_channel_receipt_attachment(file: UploadFile = File(...)) -> dict[str, str]:
    orig = Path(file.filename or "file").name
    if not orig or orig in (".", ".."): orig = "file"
    filename = f"{uuid4().hex}_{orig}"
    blob_url = await upload_private_blob(f"channel-receipts/{filename}", await file.read(), file.content_type or "application/octet-stream")
    return {"url": f"/api/channel-records/receipt-attachments/{filename}/file", "storage_url": blob_url}


@router.get("/receipt-attachments/{file_id}/file")
async def download_channel_receipt_attachment(file_id: str) -> StreamingResponse:
    safe_name = Path(file_id).name
    if safe_name != file_id or not safe_name: raise HTTPException(status_code=400, detail={"error": "invalid_file_id"})
    return await private_blob_response(f"channel-receipts/{safe_name}", file_name=safe_name, inline=True)


@router.get("/{record_id}/receipts", response_model=ChannelReceiptListResponse)
def list_channel_receipts(record_id: str, db: Session = Depends(get_db)) -> ChannelReceiptListResponse:
    if db.get(ChannelRecord, record_id) is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "id": record_id})
    rows = db.execute(
        select(ChannelReceipt)
        .where(ChannelReceipt.channel_record_id == record_id)
        .order_by(ChannelReceipt.created_at.desc())
    ).scalars().all()
    receipt_ids = [str(row.id) for row in rows]
    match_map, tx_map = _receipt_source_maps(db, receipt_ids)
    items = []
    for row in rows:
        match = match_map.get(str(row.id))
        tx = tx_map.get(str(match.bank_transaction_id)) if match is not None else None
        items.append(_receipt_read(row, match, tx))
    return ChannelReceiptListResponse(items=items)


@router.delete("/{record_id}/receipts/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel_receipt(record_id: str, receipt_id: str, db: Session = Depends(get_db)) -> None:
    parent = db.execute(
        select(ChannelRecord).where(ChannelRecord.id == record_id).with_for_update()
    ).scalar_one_or_none()
    if parent is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "id": record_id})
    rec = db.get(ChannelReceipt, receipt_id)
    if rec is None or rec.channel_record_id != record_id:
        raise HTTPException(status_code=404, detail={"error": "receipt_not_found", "id": receipt_id})
    linked_match = db.execute(
        select(BankReconciliationMatch).where(
            BankReconciliationMatch.generated_receipt_id == receipt_id,
            BankReconciliationMatch.status == "confirmed",
        )
    ).scalar_one_or_none()
    if linked_match is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "bank_generated_receipt_locked",
                "message": "这笔收款来自银行流水核销，不能直接删除。请在银行中心撤销对应核销分配，系统会同步撤回收款。",
                "bank_match_id": str(linked_match.id),
            },
        )
    attachment_url = str(rec.attachment_url or "")
    if attachment_url.startswith("/api/channel-records/receipt-attachments/"):
        await delete_private_blob(f"channel-receipts/{Path(attachment_url).name}")
    db.delete(rec)
    parent.updated_at = datetime.now(timezone.utc)
    db.flush()
    _recompute_receipt_rollup(db, parent)
    refresh_batches_for_bill(db, record_id)
    db.commit()


@router.get("/{record_id}", response_model=ChannelRecordRead)
def get_channel_record(record_id: str, db: Session = Depends(get_db)) -> ChannelRecordRead:
    row = db.execute(select(ChannelRecord).options(selectinload(ChannelRecord.line_items)).where(ChannelRecord.id == record_id)).scalar_one_or_none()
    if row is None: raise HTTPException(status_code=404, detail={"error": "not_found", "id": record_id})
    return _to_read(row)


@router.post("/{record_id}/receipts", response_model=ChannelRecordRead, status_code=status.HTTP_201_CREATED)
def create_channel_receipt(record_id: str, payload: ChannelReceiptCreate, db: Session = Depends(get_db)) -> ChannelRecordRead:
    row = db.execute(
        select(ChannelRecord).where(ChannelRecord.id == record_id).with_for_update()
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "id": record_id})
    assert_single_bill_collection_allowed(db, row)
    receivable = max(0.0, float(row.settlement_amount or 0))
    received = max(0.0, _receipt_total(db, record_id))
    outstanding = max(0.0, round(receivable - received, 2))
    amount = round(float(payload.amount or 0), 2)
    if outstanding <= RECEIPT_EPS:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "channel_bill_already_collected",
                "message": "该渠道账单已经没有未收余额，不能继续登记收款。",
                "receivable": round(receivable, 2),
                "received": round(received, 2),
                "outstanding": round(outstanding, 2),
            },
        )
    if amount > outstanding + RECEIPT_EPS:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "channel_receipt_overpay",
                "message": f"本次收款 {amount:.2f} 超过未收金额 {outstanding:.2f}，请核对后再提交。",
                "receivable": round(receivable, 2),
                "received": round(received, 2),
                "outstanding": round(outstanding, 2),
            },
        )
    data = payload.model_dump()
    data["amount"] = amount
    if not str(data.get("receipt_date") or "").strip():
        data["receipt_date"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    db.add(ChannelReceipt(id=str(uuid4()), channel_record_id=record_id, **data))
    row.updated_at = datetime.now(timezone.utc)
    db.flush()
    _recompute_receipt_rollup(db, row)
    refresh_batches_for_bill(db, record_id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail={"error": "conflict"}) from None
    row = db.execute(select(ChannelRecord).options(selectinload(ChannelRecord.line_items)).where(ChannelRecord.id == record_id)).scalar_one()
    return _to_read(row)


@router.post("", response_model=ChannelRecordRead, status_code=status.HTTP_201_CREATED)
def create_channel_record(payload: ChannelRecordCreate, db: Session = Depends(get_db)) -> ChannelRecordRead:
    if not payload.items: raise HTTPException(status_code=422, detail={"error": "items_required", "message": "至少录入一行游戏明细"})
    row = ChannelRecord(id=str(uuid4()), **payload.model_dump(exclude={"items"}))
    db.add(row); db.flush(); _replace_line_items(db, row, payload.items); _sync_denormalized_totals(row, db); _recompute_receipt_rollup(db, row)
    try: db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(status_code=409, detail={"error": "conflict"}) from None
    row = db.execute(select(ChannelRecord).options(selectinload(ChannelRecord.line_items)).where(ChannelRecord.id == row.id)).scalar_one()
    return _to_read(row)


@router.put("/{record_id}", response_model=ChannelRecordRead)
def update_channel_record(record_id: str, payload: ChannelRecordUpdate, db: Session = Depends(get_db)) -> ChannelRecordRead:
    row = db.execute(
        select(ChannelRecord).where(ChannelRecord.id == record_id).with_for_update()
    ).scalar_one_or_none()
    if row is None: raise HTTPException(status_code=404, detail={"error": "not_found", "id": record_id})
    data = payload.model_dump(exclude_unset=True); items_payload = data.pop("items", None)
    for key, value in data.items(): setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    if items_payload is not None:
        if not items_payload: raise HTTPException(status_code=422, detail={"error": "items_required", "message": "至少保留一行游戏明细"})
        _replace_line_items(db, row, [ChannelLineItemCreate(**x) for x in items_payload]); _sync_denormalized_totals(row, db)
    received = max(0.0, _receipt_total(db, record_id))
    projected_settlement = max(0.0, float(row.settlement_amount or 0))
    if received > projected_settlement + RECEIPT_EPS:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "error": "channel_settlement_below_received",
                "message": "账单修改后的应收金额不能低于已确认收款；如需调整，请先按收款来源撤销对应收款/银行核销。",
                "settlement_amount": round(projected_settlement, 2),
                "received_amount": round(received, 2),
            },
        )
    _recompute_receipt_rollup(db, row)
    try: db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(status_code=409, detail={"error": "conflict"}) from None
    row = db.execute(select(ChannelRecord).options(selectinload(ChannelRecord.line_items)).where(ChannelRecord.id == record_id)).scalar_one()
    return _to_read(row)


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_channel_record(record_id: str, db: Session = Depends(get_db)) -> None:
    row = db.execute(
        select(ChannelRecord).where(ChannelRecord.id == record_id).with_for_update()
    ).scalar_one_or_none()
    if row is None: raise HTTPException(status_code=404, detail={"error": "not_found", "id": record_id})
    bank_match = db.execute(
        select(BankReconciliationMatch).where(
            BankReconciliationMatch.bill_type == "channel",
            BankReconciliationMatch.bill_id == record_id,
            BankReconciliationMatch.status == "confirmed",
        ).limit(1)
    ).scalar_one_or_none()
    if bank_match is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "channel_bill_has_bank_receipts",
                "message": "该账单存在已确认的银行核销，不能直接删除。请先在银行中心撤销对应核销分配。",
                "bank_match_id": str(bank_match.id),
                "action": "reverse_in_bank_center",
            },
        )
    received = max(0.0, _receipt_total(db, record_id))
    if received > RECEIPT_EPS:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "channel_bill_has_receipts",
                "message": "该账单已有收款事实，不能直接删除。请先撤销手工收款；银行核销收款必须从银行中心撤销。",
                "received_amount": round(received, 2),
            },
        )
    db.delete(row); db.commit()
