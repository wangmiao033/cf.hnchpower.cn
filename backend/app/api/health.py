"""Health endpoints."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import zlib
from uuid import UUID, uuid5

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_engine, test_db_connection
from app.models.invoice import InvoiceRecord

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)

_IMPORT_NAMESPACE = UUID("c6c7ae3e-cc48-4d7d-bb50-16b5af61c614")
_SOURCE_FILES = {
    "6月全量发票查询导出结果 (1).xlsx",
    "7月全量发票查询导出结果.xlsx",
}
_BUYER_NAME = "广州熊动科技有限公司"
_BUYER_TAX_NO = "91440104MABURP0XXA"


@router.get("/health")
def health() -> dict:
    return {"ok": True}


@router.get("/health/db", response_model=None)
def health_db():
    ok, detail = test_db_connection()
    if ok:
        return {"ok": True, "database": "connected"}

    logger.error("Database health check failed: %s", detail)
    return JSONResponse(
        status_code=503,
        content={"ok": False, "database": "error"},
        headers={"Cache-Control": "no-store"},
    )


def _require_temporary_input_import_key(request: Request, key: str) -> None:
    deployment_host = (os.environ.get("VERCEL_URL") or "").strip().lower()
    host = (request.headers.get("host") or "").split(":", 1)[0].strip().lower()
    if not deployment_host or host not in {deployment_host, "cf.hnchpower.cn"}:
        raise HTTPException(status_code=404, detail="Not found")
    expected = hashlib.sha256(
        f"{deployment_host}|input-invoice-import|2026-08-09".encode("utf-8")
    ).hexdigest()
    if key != expected:
        raise HTTPException(status_code=404, detail="Not found")


def _decode_import_payload(payload: str) -> list[dict]:
    try:
        padded = payload + ("=" * (-len(payload) % 4))
        compressed = base64.urlsafe_b64decode(padded.encode("ascii"))
        raw = zlib.decompress(compressed)
        data = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid import payload") from exc
    if not isinstance(data, list) or not data or len(data) > 15:
        raise HTTPException(status_code=400, detail="Import batch must contain 1-15 rows")
    return data


def _import_summary(db: Session) -> dict:
    source_filter = or_(
        InvoiceRecord.remark.ilike("%来源文件：6月全量发票查询导出结果 (1).xlsx%"),
        InvoiceRecord.remark.ilike("%来源文件：7月全量发票查询导出结果.xlsx%"),
    )
    base_filter = (
        InvoiceRecord.invoice_direction == "input",
        InvoiceRecord.buyer_tax_no == _BUYER_TAX_NO,
        source_filter,
    )
    count = int(
        db.execute(select(func.count(InvoiceRecord.id)).where(*base_filter)).scalar_one() or 0
    )
    gross = float(
        db.execute(
            select(func.coalesce(func.sum(InvoiceRecord.amount_with_tax), 0)).where(*base_filter)
        ).scalar_one()
        or 0
    )
    tax = float(
        db.execute(
            select(func.coalesce(func.sum(InvoiceRecord.tax_amount), 0)).where(*base_filter)
        ).scalar_one()
        or 0
    )
    red = int(
        db.execute(
            select(func.count(InvoiceRecord.id)).where(
                *base_filter, InvoiceRecord.tax_status == "red"
            )
        ).scalar_one()
        or 0
    )
    return {"count": count, "gross": round(gross, 2), "tax": round(tax, 2), "red": red}


@router.get("/api/internal/input-invoice-import")
def internal_input_invoice_import(
    request: Request,
    key: str = Query(..., min_length=64, max_length=64),
    payload: str | None = Query(None, max_length=24000),
) -> dict:
    """Temporary importer for the explicitly supplied 2026-06/07 input invoice batch."""
    _require_temporary_input_import_key(request, key)

    with Session(get_engine()) as db:
        if not payload:
            return {"ok": True, "summary": _import_summary(db)}

        items = _decode_import_payload(payload)
        created = 0
        updated = 0

        for item in items:
            number = str(item.get("n") or "").strip()
            invoice_code = str(item.get("ic") or "").strip() or None
            invoice_no = str(item.get("ino") or "").strip() or None
            seller_name = str(item.get("sn") or "").strip()
            seller_tax_no = str(item.get("st") or "").strip()
            buyer_name = str(item.get("bn") or "").strip()
            buyer_tax_no = str(item.get("bt") or "").strip()
            invoice_date = str(item.get("d") or "").strip()
            source_file = str(item.get("f") or "").strip()
            invoice_type = str(item.get("typ") or "").strip() or None
            invoice_source = str(item.get("src") or "").strip() or None
            issuer = str(item.get("iss") or "").strip() or None

            if (
                not number
                or not seller_name
                or not seller_tax_no
                or buyer_name != _BUYER_NAME
                or buyer_tax_no != _BUYER_TAX_NO
                or source_file not in _SOURCE_FILES
            ):
                raise HTTPException(status_code=400, detail="Invalid invoice row")

            invoice_amount = float(item.get("a") or 0)
            tax_amount = float(item.get("t") or 0)
            gross_amount = float(item.get("g") or 0)
            raw_status = str(item.get("s") or "").strip()
            positive_flag = str(item.get("p") or "").strip()
            risk_level = str(item.get("r") or "").strip()
            source_remark = str(item.get("m") or "").strip()
            identity = f"digital:{number}"

            display_status = "作废" if "作废" in raw_status else "已开"
            if "作废" in raw_status:
                tax_status = "void"
            elif "红" in raw_status or gross_amount < 0 or positive_flag == "否":
                tax_status = "red"
            elif risk_level and risk_level not in {"正常", "无风险"}:
                tax_status = "pending"
            else:
                tax_status = "normal"

            remark_parts = []
            if source_remark:
                remark_parts.append(source_remark)
            remark_parts.append(f"[税务Excel] 来源文件：{source_file}")
            remark_parts.append(f"税务状态：{raw_status or '-'}")
            if positive_flag:
                remark_parts.append(f"正数发票：{positive_flag}")
            if risk_level:
                remark_parts.append(f"风险等级：{risk_level}")
            remark = "\n".join(remark_parts)

            row = (
                db.execute(
                    select(InvoiceRecord)
                    .where(
                        or_(
                            InvoiceRecord.invoice_identity_key == identity,
                            InvoiceRecord.digital_invoice_no == number,
                        )
                    )
                    .limit(1)
                )
                .scalars()
                .first()
            )

            fields = {
                "invoice_direction": "input",
                "invoice_type": invoice_type,
                "digital_invoice_no": number,
                "invoice_code": invoice_code,
                "invoice_no": invoice_no,
                "invoice_identity_key": identity,
                "buyer_name": buyer_name,
                "buyer_tax_no": buyer_tax_no,
                "seller_name": seller_name,
                "seller_tax_no": seller_tax_no,
                "title": None,
                "tax_no": None,
                "invoice_amount": invoice_amount,
                "tax_amount": tax_amount,
                "amount_with_tax": gross_amount,
                "invoice_date": invoice_date,
                "issuer": issuer,
                "invoice_source": invoice_source,
                "tax_status": tax_status,
                "status": display_status,
                "remark": remark,
            }

            if row is None:
                row = InvoiceRecord(
                    id=str(uuid5(_IMPORT_NAMESPACE, f"input-invoice:{number}")),
                    verified=False,
                    verified_amount=0,
                    verified_record_ids=[],
                    **fields,
                )
                db.add(row)
                created += 1
            else:
                for field_name, value in fields.items():
                    setattr(row, field_name, value)
                updated += 1

        db.commit()
        return {
            "ok": True,
            "batch": len(items),
            "created": created,
            "updated": updated,
            "summary": _import_summary(db),
        }
