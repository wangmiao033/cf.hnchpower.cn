"""Electronic VAT invoice fast-entry API."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from fastapi import Depends

from app.core.blob_storage import (
    MAX_SERVER_UPLOAD_BYTES,
    private_blob_response,
    upload_private_blob,
)
from app.core.deps import get_db
from app.models.invoice import InvoiceRecord
from app.services.electronic_invoice_parser import (
    SUPPORTED_ELECTRONIC_INVOICE_TYPES,
    extract_electronic_invoice_text,
    parse_electronic_invoice_text,
)

router = APIRouter()


@router.post("/parse")
async def parse_electronic_invoice_file(
    file: UploadFile = File(...),
    direction: str = Query("output", pattern="^(output|input)$"),
    db: Session = Depends(get_db),
) -> dict:
    original_name = Path(file.filename or "invoice").name.strip() or "invoice"
    suffix = Path(original_name).suffix.lower()
    if suffix not in SUPPORTED_ELECTRONIC_INVOICE_TYPES:
        raise HTTPException(status_code=400, detail="仅支持电子发票 PDF、OFD 或 XML 文件")

    body = await file.read()
    if not body:
        raise HTTPException(status_code=400, detail="发票文件内容为空")
    if len(body) > MAX_SERVER_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="单张电子发票暂不能超过 4MB")

    try:
        extracted_text, parser, content_type = extract_electronic_invoice_text(original_name, body)
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "invoice_file_parse_failed", "message": "电子发票文件无法解析，请确认文件未损坏。"},
        ) from exc

    if len(extracted_text.strip()) < 12:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invoice_text_layer_missing",
                "message": "该 PDF 没有可读取的文本层；请改用原始电子发票 PDF/OFD/XML，或使用完整录入。",
            },
        )

    parsed = parse_electronic_invoice_text(extracted_text, direction=direction)
    now = datetime.now(timezone.utc)
    pathname = f"invoice-files/{now:%Y/%m}/{uuid4().hex}{suffix}"
    file_url = await upload_private_blob(pathname, body, content_type)

    digital_no = str(parsed.get("digital_invoice_no") or "").strip()
    invoice_code = str(parsed.get("invoice_code") or "").strip()
    invoice_no = str(parsed.get("invoice_no") or "").strip()
    identity_key = f"digital:{digital_no}" if digital_no else (
        f"legacy:{invoice_code}:{invoice_no}" if invoice_code and invoice_no else None
    )
    existing_invoice_id = None
    if identity_key:
        existing_invoice_id = db.execute(
            select(InvoiceRecord.id).where(InvoiceRecord.invoice_identity_key == identity_key).limit(1)
        ).scalar_one_or_none()

    parsed.update({
        "source_file_name": original_name,
        "source_file_url": file_url,
        "source_file_type": content_type,
        "source_file_size": len(body),
    })
    return {
        "parser": parser,
        "confidence": parsed.pop("confidence", 0),
        "warnings": parsed.pop("warnings", []),
        "existing_invoice_id": existing_invoice_id,
        "invoice": parsed,
    }


@router.get("/{invoice_id}/file")
async def get_electronic_invoice_file(
    invoice_id: str,
    inline: bool = Query(True),
    db: Session = Depends(get_db),
):
    row = db.get(InvoiceRecord, invoice_id)
    if row is None:
        raise HTTPException(status_code=404, detail="发票不存在")
    if not row.source_file_url:
        raise HTTPException(status_code=404, detail="该发票没有保存电子原文件")
    return await private_blob_response(
        row.source_file_url,
        file_name=row.source_file_name or "invoice",
        content_type=row.source_file_type or "application/octet-stream",
        inline=inline,
    )
