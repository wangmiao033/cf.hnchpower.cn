"""Upload and manage stamped bill scans."""

from __future__ import annotations

import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.blob_storage import (
    MAX_SERVER_UPLOAD_BYTES,
    delete_private_blob,
    private_blob_response,
    upload_private_blob,
)
from app.core.deps import get_db
from app.models.bill_attachment import BillAttachment
from app.models.channel import ChannelRecord
from app.models.reconciliation import ReconciliationRecord

router = APIRouter()

ALLOWED_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
}
PARENT_MODELS = {"rd": ReconciliationRecord, "channel": ChannelRecord}


def _require_parent(db: Session, bill_type: str, bill_id: str) -> None:
    model = PARENT_MODELS.get(bill_type)
    if model is None:
        raise HTTPException(status_code=400, detail="不支持的账单类型")
    if db.get(model, bill_id) is None:
        raise HTTPException(status_code=404, detail="账单不存在")


def _serialize(item: BillAttachment) -> dict:
    return {
        "id": item.id,
        "bill_type": item.bill_type,
        "bill_id": item.bill_id,
        "file_name": item.file_name,
        "file_type": item.file_type,
        "file_size": item.file_size,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


def _get_attachment(db: Session, bill_type: str, bill_id: str, attachment_id: str) -> BillAttachment:
    item = db.get(BillAttachment, attachment_id)
    if item is None or item.bill_type != bill_type or item.bill_id != bill_id:
        raise HTTPException(status_code=404, detail="附件不存在")
    return item


@router.get("/{bill_type}/{bill_id}")
def list_attachments(bill_type: str, bill_id: str, db: Session = Depends(get_db)):
    _require_parent(db, bill_type, bill_id)
    items = db.scalars(
        select(BillAttachment)
        .where(BillAttachment.bill_type == bill_type, BillAttachment.bill_id == bill_id)
        .order_by(BillAttachment.created_at.desc())
    ).all()
    return {"items": [_serialize(item) for item in items]}


@router.post("/{bill_type}/{bill_id}", status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    bill_type: str,
    bill_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    _require_parent(db, bill_type, bill_id)
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="仅支持 JPG、PNG、GIF、WebP 或 PDF")
    body = await file.read()
    if not body:
        raise HTTPException(status_code=400, detail="附件内容为空")
    if len(body) > MAX_SERVER_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="单个附件不能超过 4 MB")

    attachment_id = uuid.uuid4().hex
    original_name = Path(file.filename or "scan").name
    suffix = re.sub(r"[^.a-zA-Z0-9]", "", Path(original_name).suffix.lower())[:10]
    pathname = f"bill-scans/{bill_type}/{bill_id}/{attachment_id}{suffix}"
    file_url = await upload_private_blob(pathname, body, content_type)
    item = BillAttachment(
        id=attachment_id,
        bill_type=bill_type,
        bill_id=bill_id,
        file_name=original_name,
        file_url=file_url,
        file_type=content_type,
        file_size=len(body),
    )
    try:
        db.add(item)
        db.commit()
        db.refresh(item)
    except Exception:
        db.rollback()
        await delete_private_blob(file_url)
        raise
    return _serialize(item)


@router.delete("/{bill_type}/{bill_id}/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    bill_type: str, bill_id: str, attachment_id: str, db: Session = Depends(get_db)
):
    _require_parent(db, bill_type, bill_id)
    item = _get_attachment(db, bill_type, bill_id, attachment_id)
    file_url = item.file_url
    db.delete(item)
    db.commit()
    await delete_private_blob(file_url)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{bill_type}/{bill_id}/{attachment_id}/file")
async def get_attachment_file(
    bill_type: str,
    bill_id: str,
    attachment_id: str,
    inline: bool = Query(True),
    db: Session = Depends(get_db),
):
    _require_parent(db, bill_type, bill_id)
    item = _get_attachment(db, bill_type, bill_id, attachment_id)
    return await private_blob_response(
        item.file_url,
        file_name=item.file_name,
        content_type=item.file_type,
        inline=inline,
    )
