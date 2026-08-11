"""One-time guarded ICBC ledger rebuild helper.

This route is intentionally temporary. It transports encrypted staging chunks,
verifies no active bank reconciliation exists, then rebuilds only the requested
ICBC account/date window in one database transaction.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import zlib
from collections import defaultdict
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from app.api.bank_transaction import _build_dedupe_key
from app.core.deps import get_db
from app.models.bank_reconciliation_match import BankReconciliationMatch
from app.models.bank_transaction import BankTransaction

router = APIRouter()

ACCOUNT = "3602841509200157769"
DATE_FROM = "2026-01-01"
DATE_TO = "2026-08-07"
EXPECTED_ROWS = 266
TOKEN_SHA256 = "aee551c4496dc68dc6f8151421b4ab4f0687e3c7cdba18d60edaa93ebcf8df94"

_SESSION_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS maintenance_bank_rebuild_sessions (
    id TEXT PRIMARY KEY,
    session_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
"""

_CHUNK_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS maintenance_bank_rebuild_chunks (
    session_id TEXT NOT NULL,
    chunk_no INTEGER NOT NULL,
    payload_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, chunk_no)
)
"""


def _target_predicate():
    return (
        BankTransaction.trade_date.isnot(None),
        BankTransaction.trade_date >= DATE_FROM,
        BankTransaction.trade_date <= DATE_TO,
        or_(
            BankTransaction.bank_account == ACCOUNT,
            (
                func.coalesce(func.trim(BankTransaction.bank_account), "") == ""
            )
            & (func.upper(func.coalesce(BankTransaction.source_bank, "")) == "ICBC"),
        ),
    )


def _token_ok(token: str) -> bool:
    digest = hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()
    return hmac.compare_digest(digest, TOKEN_SHA256)


def _session_proof(session_key: str, action: str) -> str:
    return hmac.new(
        session_key.encode("utf-8"),
        action.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _load_session(db: Session, session_id: str) -> str:
    row = db.execute(
        text(
            "SELECT session_key FROM maintenance_bank_rebuild_sessions "
            "WHERE id = :id AND created_at >= NOW() - INTERVAL '2 hours'"
        ),
        {"id": session_id},
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="维护会话不存在或已过期")
    return str(row)


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        out.extend(hashlib.sha256(key + nonce + counter.to_bytes(8, "big")).digest())
        counter += 1
    return bytes(out[:length])


def _decrypt_payload(session_key: str, payload: str) -> list[dict]:
    try:
        raw = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
        if len(raw) < 48:
            raise ValueError("payload too short")
        nonce, tag, ciphertext = raw[:16], raw[16:48], raw[48:]
        root = hashlib.sha256(session_key.encode("utf-8")).digest()
        enc_key = hashlib.sha256(root + b"enc").digest()
        mac_key = hashlib.sha256(root + b"mac").digest()
        expected = hmac.new(mac_key, nonce + ciphertext, hashlib.sha256).digest()
        if not hmac.compare_digest(tag, expected):
            raise ValueError("payload MAC mismatch")
        stream = _keystream(enc_key, nonce, len(ciphertext))
        compressed = bytes(a ^ b for a, b in zip(ciphertext, stream))
        plain = zlib.decompress(compressed)
        rows = json.loads(plain.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"加密分片无法解码: {exc}") from exc
    if not isinstance(rows, list) or not rows or len(rows) > 30:
        raise HTTPException(status_code=422, detail="分片行数无效")
    return rows


def _money_key(value) -> str:
    if value is None or value == "":
        return ""
    try:
        return f"{Decimal(str(value)).quantize(Decimal('0.01')):.2f}"
    except Exception:
        return str(value or "").strip()


def _identity_key(data: dict) -> str:
    pieces = (
        str(data.get("trade_date") or "").strip(),
        _money_key(data.get("income_amount")),
        _money_key(data.get("expense_amount")),
        _money_key(data.get("balance")),
        str(data.get("payer_name") or "").strip(),
        str(data.get("payer_account") or "").strip(),
        str(data.get("payee_name") or "").strip(),
        str(data.get("payee_account") or "").strip(),
        str(data.get("transaction_no") or "").strip(),
        str(data.get("summary") or "").strip(),
        str(data.get("purpose") or "").strip(),
    )
    return hashlib.sha256("\x1f".join(pieces).encode("utf-8")).hexdigest()


def _orm_payload(row: BankTransaction) -> dict:
    return {
        "source_bank": row.source_bank,
        "trade_date": row.trade_date,
        "income_amount": float(row.income_amount) if row.income_amount is not None else None,
        "expense_amount": float(row.expense_amount) if row.expense_amount is not None else None,
        "balance": float(row.balance) if row.balance is not None else None,
        "payer_name": row.payer_name,
        "payer_account": row.payer_account,
        "payee_name": row.payee_name,
        "payee_account": row.payee_account,
        "transaction_no": row.transaction_no,
        "summary": row.summary,
        "purpose": row.purpose,
    }


def _validate_staged_rows(rows: list[dict]) -> None:
    if len(rows) != EXPECTED_ROWS:
        raise HTTPException(
            status_code=409,
            detail=f"分片合并后应为 {EXPECTED_ROWS} 笔，实际 {len(rows)} 笔，拒绝重建。",
        )
    dedupe_seen: set[str] = set()
    for index, row in enumerate(rows, start=1):
        if str(row.get("type") or "") != "statement_import":
            raise HTTPException(status_code=422, detail=f"第 {index} 笔类型不是 statement_import")
        if str(row.get("bank_account") or "") != ACCOUNT:
            raise HTTPException(status_code=422, detail=f"第 {index} 笔本方账号不一致")
        if str(row.get("source_bank") or "").upper() != "ICBC":
            raise HTTPException(status_code=422, detail=f"第 {index} 笔来源银行不是 ICBC")
        trade_date = str(row.get("trade_date") or "")
        if not (DATE_FROM <= trade_date <= DATE_TO):
            raise HTTPException(status_code=422, detail=f"第 {index} 笔日期超出目标范围")
        recalculated = _build_dedupe_key(row)
        if row.get("dedupe_key") and str(row.get("dedupe_key")) != recalculated:
            raise HTTPException(status_code=422, detail=f"第 {index} 笔去重指纹不一致")
        row["dedupe_key"] = recalculated
        if recalculated in dedupe_seen:
            raise HTTPException(status_code=409, detail=f"上传数据内部存在重复流水，第 {index} 笔")
        dedupe_seen.add(recalculated)


@router.get("/init", include_in_schema=False)
def init_rebuild(
    token: str = Query(..., min_length=20, max_length=128),
    db: Session = Depends(get_db),
) -> dict:
    if not _token_ok(token):
        raise HTTPException(status_code=404, detail="not found")
    db.execute(text(_SESSION_TABLE_SQL))
    db.execute(text(_CHUNK_TABLE_SQL))
    db.execute(
        text(
            "DELETE FROM maintenance_bank_rebuild_chunks "
            "WHERE session_id IN (SELECT id FROM maintenance_bank_rebuild_sessions "
            "WHERE created_at < NOW() - INTERVAL '2 hours')"
        )
    )
    db.execute(
        text(
            "DELETE FROM maintenance_bank_rebuild_sessions "
            "WHERE created_at < NOW() - INTERVAL '2 hours'"
        )
    )

    target_ids = [
        str(value)
        for value in db.execute(
            select(BankTransaction.id).where(*_target_predicate())
        ).scalars().all()
    ]
    confirmed = 0
    reversed_count = 0
    if target_ids:
        status_rows = db.execute(
            select(
                BankReconciliationMatch.status,
                func.count(BankReconciliationMatch.id),
            )
            .where(BankReconciliationMatch.bank_transaction_id.in_(target_ids))
            .group_by(BankReconciliationMatch.status)
        ).all()
        counts = {str(status): int(count or 0) for status, count in status_rows}
        confirmed = counts.get("confirmed", 0)
        reversed_count = counts.get("reversed", 0)
    if confirmed:
        raise HTTPException(
            status_code=409,
            detail=f"目标范围仍有 {confirmed} 条有效核销记录，已停止，不会删除任何流水。",
        )

    session_id = str(uuid4())
    session_key = secrets.token_urlsafe(32)
    db.execute(
        text(
            "INSERT INTO maintenance_bank_rebuild_sessions(id, session_key) "
            "VALUES (:id, :session_key)"
        ),
        {"id": session_id, "session_key": session_key},
    )
    db.commit()
    return {
        "ok": True,
        "session_id": session_id,
        "session_key": session_key,
        "existing_transactions": len(target_ids),
        "confirmed_matches": confirmed,
        "reversed_matches": reversed_count,
        "account": ACCOUNT,
        "date_from": DATE_FROM,
        "date_to": DATE_TO,
        "expected_rows": EXPECTED_ROWS,
    }


@router.get("/append", include_in_schema=False)
def append_chunk(
    session_id: str = Query(..., min_length=10, max_length=80),
    chunk_no: int = Query(..., ge=0, le=100),
    payload: str = Query(..., min_length=20, max_length=7000),
    db: Session = Depends(get_db),
) -> dict:
    session_key = _load_session(db, session_id)
    rows = _decrypt_payload(session_key, payload)
    db.execute(
        text(
            "INSERT INTO maintenance_bank_rebuild_chunks(session_id, chunk_no, payload_json) "
            "VALUES (:session_id, :chunk_no, CAST(:payload AS JSONB)) "
            "ON CONFLICT (session_id, chunk_no) DO UPDATE "
            "SET payload_json = EXCLUDED.payload_json, created_at = NOW()"
        ),
        {
            "session_id": session_id,
            "chunk_no": chunk_no,
            "payload": json.dumps(rows, ensure_ascii=False, separators=(",", ":")),
        },
    )
    db.commit()
    return {"ok": True, "chunk_no": chunk_no, "rows": len(rows)}


@router.get("/finalize", include_in_schema=False)
def finalize_rebuild(
    session_id: str = Query(..., min_length=10, max_length=80),
    proof: str = Query(..., min_length=64, max_length=64),
    db: Session = Depends(get_db),
) -> dict:
    session_key = _load_session(db, session_id)
    expected_proof = _session_proof(session_key, "finalize")
    if not hmac.compare_digest(proof, expected_proof):
        raise HTTPException(status_code=404, detail="not found")

    chunk_rows = db.execute(
        text(
            "SELECT chunk_no, payload_json "
            "FROM maintenance_bank_rebuild_chunks "
            "WHERE session_id = :session_id ORDER BY chunk_no"
        ),
        {"session_id": session_id},
    ).mappings().all()
    if not chunk_rows:
        raise HTTPException(status_code=409, detail="没有已上传的分片")
    chunk_numbers = [int(row["chunk_no"]) for row in chunk_rows]
    if chunk_numbers != list(range(len(chunk_numbers))):
        raise HTTPException(status_code=409, detail=f"分片序号不连续: {chunk_numbers}")
    staged: list[dict] = []
    for chunk in chunk_rows:
        staged.extend(list(chunk["payload_json"] or []))
    _validate_staged_rows(staged)

    old_rows = db.execute(
        select(BankTransaction).where(*_target_predicate()).order_by(BankTransaction.created_at.asc())
    ).scalars().all()
    old_ids = [str(row.id) for row in old_rows]

    matches = (
        db.execute(
            select(BankReconciliationMatch).where(
                BankReconciliationMatch.bank_transaction_id.in_(old_ids)
            )
        ).scalars().all()
        if old_ids
        else []
    )
    if any(str(match.status) == "confirmed" for match in matches):
        raise HTTPException(
            status_code=409,
            detail="执行前再次检查发现有效核销，已停止，数据库未发生删除。",
        )
    matches_by_tx: dict[str, list[BankReconciliationMatch]] = defaultdict(list)
    for match in matches:
        matches_by_tx[str(match.bank_transaction_id)].append(match)

    staged_by_identity = {_identity_key(row): row for row in staged}
    old_by_identity: dict[str, list[BankTransaction]] = defaultdict(list)
    for row in old_rows:
        old_by_identity[_identity_key(_orm_payload(row))].append(row)

    staged_keys = [str(row["dedupe_key"]) for row in staged]
    external_stmt = select(BankTransaction.id).where(BankTransaction.dedupe_key.in_(staged_keys))
    if old_ids:
        external_stmt = external_stmt.where(~BankTransaction.id.in_(old_ids))
    external_conflicts = db.execute(external_stmt).scalars().all()
    if external_conflicts:
        raise HTTPException(
            status_code=409,
            detail=f"目标流水中有 {len(external_conflicts)} 笔已存在于本次清理范围之外，拒绝自动覆盖。",
        )

    for row in old_rows:
        row.dedupe_key = None
    db.flush()

    reused = 0
    deleted_old = 0
    relinked_reversed = 0
    deleted_reversed = 0
    survivor_ids: set[str] = set()
    deleted_ids: set[str] = set()
    used_identities: set[str] = set()

    for identity, candidates in old_by_identity.items():
        authoritative = staged_by_identity.get(identity)
        if authoritative is None:
            continue

        def survivor_score(item: BankTransaction):
            history = matches_by_tx.get(str(item.id), [])
            return (
                1 if history else 0,
                1 if item.attachment_url else 0,
                1 if item.remark else 0,
                -(item.created_at.timestamp() if item.created_at else 0),
            )

        candidates = sorted(candidates, key=survivor_score, reverse=True)
        survivor = candidates[0]
        survivor_id = str(survivor.id)
        survivor_ids.add(survivor_id)
        used_identities.add(identity)
        old_remark = survivor.remark
        old_attachment = survivor.attachment_url

        for duplicate in candidates[1:]:
            duplicate_id = str(duplicate.id)
            for match in matches_by_tx.get(duplicate_id, []):
                match.bank_transaction_id = survivor_id
                relinked_reversed += 1
            db.delete(duplicate)
            deleted_ids.add(duplicate_id)
            deleted_old += 1

        for field in (
            "type", "trade_date", "bank_account", "payer_name", "payer_account",
            "payer_bank_name", "payee_name", "payee_account", "payee_bank_name",
            "amount", "income_amount", "expense_amount", "balance", "currency",
            "transaction_no", "instruction_no", "summary", "purpose", "remark",
            "status", "raw_text", "attachment_url", "source_bank",
            "source_file_name", "source_row_no", "dedupe_key",
        ):
            setattr(survivor, field, authoritative.get(field))
        if old_remark and not survivor.remark:
            survivor.remark = old_remark
        if old_attachment and not survivor.attachment_url:
            survivor.attachment_url = old_attachment
        survivor.reconciliation_id = None
        survivor.reconciliation_type = None
        survivor.reconciliation_no = None
        survivor.linked_amount = None
        reused += 1

    for row in old_rows:
        row_id = str(row.id)
        if row_id in survivor_ids or row_id in deleted_ids:
            continue
        identity = _identity_key(_orm_payload(row))
        if identity in used_identities:
            continue
        for match in matches_by_tx.get(row_id, []):
            if str(match.status) != "confirmed":
                db.delete(match)
                deleted_reversed += 1
        db.delete(row)
        deleted_ids.add(row_id)
        deleted_old += 1

    db.execute(
        text(
            "DELETE FROM bank_import_batches "
            "WHERE (bank_account = :account "
            "   OR ((bank_account IS NULL OR TRIM(bank_account) = '') "
            "       AND UPPER(COALESCE(source_bank,'')) = 'ICBC')) "
            "AND COALESCE(date_from, :date_from) <= :date_to "
            "AND COALESCE(date_to, :date_to) >= :date_from"
        ),
        {
            "account": ACCOUNT,
            "date_from": DATE_FROM,
            "date_to": DATE_TO,
        },
    )

    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in staged:
        grouped[str(row.get("source_file_name") or "ICBC.xlsx")].append(row)
    batch_ids = {name: str(uuid4()) for name in grouped}

    for identity in used_identities:
        authoritative = staged_by_identity[identity]
        candidates = old_by_identity.get(identity) or []
        survivor = next((item for item in candidates if str(item.id) in survivor_ids), None)
        if survivor is not None:
            survivor.import_batch_id = batch_ids[str(authoritative.get("source_file_name") or "ICBC.xlsx")]

    inserted = 0
    for identity, authoritative in staged_by_identity.items():
        if identity in used_identities:
            continue
        data = dict(authoritative)
        data.pop("direction", None)
        data["import_batch_id"] = batch_ids[str(data.get("source_file_name") or "ICBC.xlsx")]
        row = BankTransaction(id=str(uuid4()), **data)
        db.add(row)
        inserted += 1

    for file_name, rows in grouped.items():
        dates = sorted(str(row.get("trade_date") or "") for row in rows if row.get("trade_date"))
        income_total = sum(Decimal(str(row.get("income_amount") or 0)) for row in rows)
        expense_total = sum(Decimal(str(row.get("expense_amount") or 0)) for row in rows)
        db.execute(
            text(
                "INSERT INTO bank_import_batches ("
                "id, source_bank, source_file_name, source_sheet_name, bank_account, "
                "total, inserted, duplicates, invalid, income_total, expense_total, "
                "date_from, date_to, duplicate_row_nos, invalid_row_nos, legacy_backfill"
                ") VALUES ("
                ":id, 'ICBC', :file_name, 'Sheet0', :account, "
                ":total, :total, 0, 0, :income_total, :expense_total, "
                ":date_from, :date_to, CAST('[]' AS JSONB), CAST('[]' AS JSONB), FALSE"
                ")"
            ),
            {
                "id": batch_ids[file_name],
                "file_name": file_name,
                "account": ACCOUNT,
                "total": len(rows),
                "income_total": income_total,
                "expense_total": expense_total,
                "date_from": dates[0],
                "date_to": dates[-1],
            },
        )

    db.flush()
    final_count = int(
        db.execute(
            select(func.count(BankTransaction.id)).where(
                BankTransaction.bank_account == ACCOUNT,
                BankTransaction.trade_date >= DATE_FROM,
                BankTransaction.trade_date <= DATE_TO,
                func.upper(func.coalesce(BankTransaction.source_bank, "")) == "ICBC",
            )
        ).scalar_one()
        or 0
    )
    if final_count != EXPECTED_ROWS:
        raise HTTPException(
            status_code=409,
            detail=f"重建后校验应为 {EXPECTED_ROWS} 笔，实际 {final_count} 笔；事务已停止。",
        )

    db.execute(text("DROP TABLE IF EXISTS maintenance_bank_rebuild_chunks"))
    db.execute(text("DROP TABLE IF EXISTS maintenance_bank_rebuild_sessions"))
    db.commit()
    return {
        "ok": True,
        "account": ACCOUNT,
        "date_from": DATE_FROM,
        "date_to": DATE_TO,
        "old_transactions": len(old_rows),
        "reused_transactions": reused,
        "deleted_old_transactions": deleted_old,
        "inserted_transactions": inserted,
        "relinked_reversed_matches": relinked_reversed,
        "deleted_stale_reversed_matches": deleted_reversed,
        "final_transactions": final_count,
        "import_batches": [
            {
                "file_name": name,
                "rows": len(rows),
                "batch_id": batch_ids[name],
            }
            for name, rows in grouped.items()
        ],
    }
