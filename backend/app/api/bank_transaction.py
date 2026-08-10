"""银行流水统一台账 CRUD。"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import Numeric, cast, func, or_, select, text
from sqlalchemy.orm import Session

from app.core.blob_storage import private_blob_response, upload_private_blob
from app.core.deps import get_db
from app.models.bank_transaction import BankTransaction
from app.schemas.bank_transaction import (
    BankAccountSummaryListResponse,
    BankAccountSummaryRead,
    BankImportBatchListResponse,
    BankImportBatchRead,
    BankTransactionBulkImportRequest,
    BankTransactionBulkImportResponse,
    BankTransactionCreate,
    BankTransactionListResponse,
    BankTransactionRead,
    BankTransactionUpdate,
)
from app.services.bank_auto_reconciliation import has_confirmed_match_for_transaction

router = APIRouter()

_ALLOWED_TYPES = frozenset({"statement_import", "payment_register", "collection_register"})
_MATCH_SAFE_UPDATE_FIELDS = frozenset({"remark", "attachment_url"})


def _row_to_read(row: BankTransaction) -> BankTransactionRead:
    return BankTransactionRead.model_validate(row)


def _clean_text(value: object | None) -> str:
    return str(value or "").strip()


def _money_key(value: object | None) -> str:
    if value is None or value == "":
        return ""
    try:
        return f"{Decimal(str(value)).quantize(Decimal('0.01')):.2f}"
    except Exception:
        return _clean_text(value)


def _build_dedupe_key(data: dict) -> str:
    """Stable import signature independent of file name / row position."""
    source_bank = _clean_text(data.get("source_bank")).upper() or "BANK"
    pieces = (
        source_bank,
        _clean_text(data.get("trade_date")),
        _money_key(data.get("income_amount")),
        _money_key(data.get("expense_amount")),
        _money_key(data.get("balance")),
        _clean_text(data.get("payer_name")),
        _clean_text(data.get("payer_account")),
        _clean_text(data.get("payee_name")),
        _clean_text(data.get("payee_account")),
        _clean_text(data.get("transaction_no")),
        _clean_text(data.get("summary")),
        _clean_text(data.get("purpose")),
    )
    return hashlib.sha256("\x1f".join(pieces).encode("utf-8")).hexdigest()


def _valid_statement_import(data: dict) -> bool:
    if not _clean_text(data.get("trade_date")):
        return False
    income = Decimal(str(data.get("income_amount") or 0))
    expense = Decimal(str(data.get("expense_amount") or 0))
    return (income > 0) ^ (expense > 0)


def _decimal_sum(prepared: list[tuple[dict, str, int | None]], field: str) -> Decimal:
    total = Decimal("0")
    for data, _, _ in prepared:
        try:
            total += Decimal(str(data.get(field) or 0))
        except Exception:
            continue
    return total.quantize(Decimal("0.01"))


@router.get("", response_model=BankTransactionListResponse)
def list_bank_transactions(
    db: Session = Depends(get_db),
    q: str | None = Query(None, description="关键词：户名、账号、流水号、备注等"),
    transaction_type: str | None = Query(None, alias="type"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    amount_min: Decimal | None = Query(None),
    amount_max: Decimal | None = Query(None),
    bank_account: str | None = Query(None),
    source_bank: str | None = Query(None),
    source_file_name: str | None = Query(None),
    import_batch_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> BankTransactionListResponse:
    stmt = select(BankTransaction)
    if transaction_type and transaction_type.strip():
        t = transaction_type.strip()
        if t not in _ALLOWED_TYPES:
            raise HTTPException(status_code=400, detail={"error": "invalid_type", "allowed": list(_ALLOWED_TYPES)})
        stmt = stmt.where(BankTransaction.type == t)
    if date_from and date_from.strip():
        stmt = stmt.where(BankTransaction.trade_date.isnot(None), BankTransaction.trade_date >= date_from.strip())
    if date_to and date_to.strip():
        stmt = stmt.where(BankTransaction.trade_date.isnot(None), BankTransaction.trade_date <= date_to.strip())
    if amount_min is not None:
        stmt = stmt.where(BankTransaction.amount.isnot(None), cast(BankTransaction.amount, Numeric) >= amount_min)
    if amount_max is not None:
        stmt = stmt.where(BankTransaction.amount.isnot(None), cast(BankTransaction.amount, Numeric) <= amount_max)
    if bank_account and bank_account.strip():
        stmt = stmt.where(BankTransaction.bank_account == bank_account.strip())
    if source_bank and source_bank.strip():
        stmt = stmt.where(func.upper(BankTransaction.source_bank) == source_bank.strip().upper())
    if source_file_name and source_file_name.strip():
        stmt = stmt.where(BankTransaction.source_file_name == source_file_name.strip())
    if import_batch_id and import_batch_id.strip():
        stmt = stmt.where(BankTransaction.import_batch_id == import_batch_id.strip())
    if q and q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                BankTransaction.payer_name.ilike(term),
                BankTransaction.payee_name.ilike(term),
                BankTransaction.bank_account.ilike(term),
                BankTransaction.payer_account.ilike(term),
                BankTransaction.payee_account.ilike(term),
                BankTransaction.transaction_no.ilike(term),
                BankTransaction.instruction_no.ilike(term),
                BankTransaction.remark.ilike(term),
                BankTransaction.summary.ilike(term),
                BankTransaction.source_file_name.ilike(term),
                BankTransaction.reconciliation_no.ilike(term),
            )
        )
    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())
    rows = db.execute(stmt.order_by(BankTransaction.trade_date.desc().nullslast(), BankTransaction.created_at.desc()).limit(limit).offset(offset)).scalars().all()
    return BankTransactionListResponse(items=[_row_to_read(r) for r in rows], total=total)


@router.get("/import-batches", response_model=BankImportBatchListResponse)
def list_bank_import_batches(
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> BankImportBatchListResponse:
    total = int(db.execute(text("SELECT COUNT(*) FROM bank_import_batches")).scalar_one())
    rows = db.execute(
        text(
            """
            SELECT
              id,
              source_bank,
              source_file_name,
              source_sheet_name,
              bank_account,
              total,
              inserted,
              duplicates,
              invalid,
              income_total,
              expense_total,
              date_from,
              date_to,
              duplicate_row_nos,
              invalid_row_nos,
              legacy_backfill,
              created_at
            FROM bank_import_batches
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        {"limit": limit, "offset": offset},
    ).mappings().all()
    return BankImportBatchListResponse(
        items=[BankImportBatchRead(**dict(row)) for row in rows],
        total=total,
    )


@router.get("/accounts", response_model=BankAccountSummaryListResponse)
def list_bank_account_summaries(db: Session = Depends(get_db)) -> BankAccountSummaryListResponse:
    rows = db.execute(
        text(
            """
            WITH ranked AS (
              SELECT
                COALESCE(NULLIF(UPPER(TRIM(source_bank)), ''), 'BANK') AS source_bank,
                TRIM(bank_account) AS bank_account,
                trade_date,
                balance,
                source_file_name,
                import_batch_id,
                created_at,
                COUNT(*) OVER (PARTITION BY TRIM(bank_account)) AS transaction_count,
                ROW_NUMBER() OVER (
                  PARTITION BY TRIM(bank_account)
                  ORDER BY trade_date DESC NULLS LAST, created_at DESC
                ) AS row_rank
              FROM bank_transactions
              WHERE type = 'statement_import'
                AND bank_account IS NOT NULL
                AND TRIM(bank_account) <> ''
            )
            SELECT
              source_bank,
              bank_account,
              transaction_count,
              trade_date AS latest_trade_date,
              balance AS latest_balance,
              source_file_name AS latest_file_name,
              import_batch_id AS latest_import_batch_id,
              created_at AS last_imported_at
            FROM ranked
            WHERE row_rank = 1
            ORDER BY created_at DESC
            """
        )
    ).mappings().all()
    return BankAccountSummaryListResponse(
        items=[BankAccountSummaryRead(**dict(row)) for row in rows]
    )


@router.post("/upload-attachment", status_code=status.HTTP_201_CREATED)
async def upload_bank_transaction_attachment(file: UploadFile = File(...)) -> dict[str, str]:
    orig = Path(file.filename or "file").name
    if not orig or orig in (".", ".."):
        orig = "file"
    filename = f"{uuid4().hex}_{orig}"
    blob_url = await upload_private_blob(
        f"bank-transactions/{filename}",
        await file.read(),
        file.content_type or "application/octet-stream",
    )
    return {"url": f"/api/bank-transactions/attachments/{filename}/file", "storage_url": blob_url}


@router.get("/attachments/{file_id}/file")
async def download_bank_transaction_attachment(file_id: str) -> StreamingResponse:
    safe_name = Path(file_id).name
    if safe_name != file_id or not safe_name:
        raise HTTPException(status_code=400, detail={"error": "invalid_file_id"})
    return await private_blob_response(f"bank-transactions/{safe_name}", file_name=safe_name, inline=True)


@router.post("/bulk-import", response_model=BankTransactionBulkImportResponse, status_code=status.HTTP_201_CREATED)
def bulk_import_bank_transactions(
    payload: BankTransactionBulkImportRequest,
    db: Session = Depends(get_db),
) -> BankTransactionBulkImportResponse:
    batch_id = str(uuid4())
    source_bank = _clean_text(payload.source_bank).upper() or "ICBC"
    source_file_name = _clean_text(payload.source_file_name) or None
    source_sheet_name = _clean_text(payload.source_sheet_name) or None
    bank_account = _clean_text(payload.bank_account) or None

    prepared: list[tuple[dict, str, int | None]] = []
    invalid_rows: list[int] = sorted({int(row) for row in payload.source_invalid_row_nos if isinstance(row, int) and row > 0})
    for item in payload.items:
        data = item.model_dump(exclude_unset=True)
        data["type"] = "statement_import"
        data["source_bank"] = source_bank
        if source_file_name:
            data["source_file_name"] = source_file_name
        if bank_account:
            data["bank_account"] = bank_account
        row_no = data.get("source_row_no")
        if not _valid_statement_import(data):
            if isinstance(row_no, int) and row_no > 0:
                invalid_rows.append(row_no)
            continue
        dedupe_key = _build_dedupe_key(data)
        data["dedupe_key"] = dedupe_key
        prepared.append((data, dedupe_key, row_no if isinstance(row_no, int) else None))

    invalid_rows = sorted(set(invalid_rows))
    keys = [key for _, key, _ in prepared]
    existing_keys: set[str] = set()
    if keys:
        existing_keys = set(
            db.execute(
                select(BankTransaction.dedupe_key).where(BankTransaction.dedupe_key.in_(keys))
            ).scalars().all()
        )
        existing_keys.discard(None)

    seen = set(existing_keys)
    duplicate_rows: list[int] = []
    inserted = 0
    for data, dedupe_key, row_no in prepared:
        if dedupe_key in seen:
            if row_no is not None:
                duplicate_rows.append(row_no)
            continue
        data["import_batch_id"] = batch_id
        row = BankTransaction(id=str(uuid4()), **data)
        db.add(row)
        seen.add(dedupe_key)
        inserted += 1

    duplicates = len(prepared) - inserted
    valid_dates = sorted(
        _clean_text(data.get("trade_date"))
        for data, _, _ in prepared
        if _clean_text(data.get("trade_date"))
    )
    total_rows = payload.source_total_rows or (len(payload.items) + len(payload.source_invalid_row_nos))
    total_rows = max(total_rows, len(payload.items), inserted + duplicates + len(invalid_rows))

    db.execute(
        text(
            """
            INSERT INTO bank_import_batches (
              id,
              source_bank,
              source_file_name,
              source_sheet_name,
              bank_account,
              total,
              inserted,
              duplicates,
              invalid,
              income_total,
              expense_total,
              date_from,
              date_to,
              duplicate_row_nos,
              invalid_row_nos,
              legacy_backfill
            ) VALUES (
              :id,
              :source_bank,
              :source_file_name,
              :source_sheet_name,
              :bank_account,
              :total,
              :inserted,
              :duplicates,
              :invalid,
              :income_total,
              :expense_total,
              :date_from,
              :date_to,
              CAST(:duplicate_row_nos AS JSONB),
              CAST(:invalid_row_nos AS JSONB),
              FALSE
            )
            """
        ),
        {
            "id": batch_id,
            "source_bank": source_bank,
            "source_file_name": source_file_name,
            "source_sheet_name": source_sheet_name,
            "bank_account": bank_account,
            "total": total_rows,
            "inserted": inserted,
            "duplicates": duplicates,
            "invalid": len(invalid_rows),
            "income_total": _decimal_sum(prepared, "income_amount"),
            "expense_total": _decimal_sum(prepared, "expense_amount"),
            "date_from": valid_dates[0] if valid_dates else None,
            "date_to": valid_dates[-1] if valid_dates else None,
            "duplicate_row_nos": json.dumps(sorted(set(duplicate_rows))),
            "invalid_row_nos": json.dumps(invalid_rows),
        },
    )

    db.commit()
    return BankTransactionBulkImportResponse(
        batch_id=batch_id,
        total=total_rows,
        inserted=inserted,
        duplicates=duplicates,
        invalid=len(invalid_rows),
        duplicate_row_nos=sorted(set(duplicate_rows)),
        invalid_row_nos=invalid_rows,
    )


@router.get("/{transaction_id}", response_model=BankTransactionRead)
def get_bank_transaction(transaction_id: str, db: Session = Depends(get_db)) -> BankTransactionRead:
    row = db.get(BankTransaction, transaction_id)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "id": transaction_id})
    return _row_to_read(row)


@router.post("", response_model=BankTransactionRead, status_code=status.HTTP_201_CREATED)
def create_bank_transaction(payload: BankTransactionCreate, db: Session = Depends(get_db)) -> BankTransactionRead:
    if payload.type not in _ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail={"error": "invalid_type", "allowed": list(_ALLOWED_TYPES)})
    data = payload.model_dump(exclude_unset=True)
    if payload.type == "statement_import" and _clean_text(data.get("source_bank")):
        data["dedupe_key"] = _build_dedupe_key(data)
        exists = db.execute(
            select(BankTransaction.id).where(BankTransaction.dedupe_key == data["dedupe_key"]).limit(1)
        ).scalar_one_or_none()
        if exists:
            raise HTTPException(
                status_code=409,
                detail={"error": "duplicate_bank_transaction", "message": "该银行流水已存在，无需重复录入。"},
            )
    row = BankTransaction(id=str(uuid4()), **data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_to_read(row)


@router.put("/{transaction_id}", response_model=BankTransactionRead)
def update_bank_transaction(
    transaction_id: str, payload: BankTransactionUpdate, db: Session = Depends(get_db)
) -> BankTransactionRead:
    row = db.get(BankTransaction, transaction_id)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "id": transaction_id})
    data = payload.model_dump(exclude_unset=True)
    if has_confirmed_match_for_transaction(db, transaction_id):
        protected = sorted(set(data) - _MATCH_SAFE_UPDATE_FIELDS)
        if protected:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "bank_transaction_reconciled",
                    "message": "该流水已核销。需要修改金额、方向或账单关联时，请先撤销核销。",
                    "protected_fields": protected,
                },
            )
    if "type" in data and data["type"] not in _ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail={"error": "invalid_type", "allowed": list(_ALLOWED_TYPES)})
    for k, v in data.items():
        setattr(row, k, v)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return _row_to_read(row)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bank_transaction(transaction_id: str, db: Session = Depends(get_db)) -> None:
    row = db.get(BankTransaction, transaction_id)
    if row is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "id": transaction_id})
    if has_confirmed_match_for_transaction(db, transaction_id):
        raise HTTPException(
            status_code=409,
            detail={"error": "bank_transaction_reconciled", "message": "该流水已核销，请先撤销核销后再删除。"},
        )
    db.delete(row)
    db.commit()
