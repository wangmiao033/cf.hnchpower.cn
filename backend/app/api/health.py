"""Health endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.database import get_engine, test_db_connection

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)


def _log_contract_match_probe() -> None:
    """Temporary read-only production diagnostic for the stubborn channel match."""
    try:
        with get_engine().connect() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT
                      access.id AS access_item_id,
                      access.product_name,
                      access.channel_name,
                      access.authorization_start,
                      access.authorization_end,
                      access.share_rate,
                      access.channel_fee_rate,
                      access.status AS access_status,
                      contract.id AS contract_id,
                      contract.contract_no,
                      contract.contract_name,
                      contract.counterparty,
                      contract.effective_date,
                      contract.end_date,
                      contract.performance_status,
                      partner.id AS partner_id,
                      partner.name AS partner_name,
                      partner.short_name AS partner_short_name,
                      terms.invoice_tax_rate,
                      access.updated_at AS access_updated_at,
                      contract.updated_at AS contract_updated_at
                    FROM cf_contract_access_items AS access
                    JOIN cf_contract_records AS contract ON contract.id = access.contract_id
                    LEFT JOIN cf_partner_records AS partner ON partner.id = contract.partner_id
                    LEFT JOIN cf_contract_access_terms AS terms ON terms.access_item_id = access.id
                    WHERE access.product_name ILIKE :product
                       OR partner.name ILIKE :partner
                       OR partner.short_name ILIKE :short_name
                       OR contract.counterparty ILIKE :partner
                    ORDER BY contract.updated_at DESC, access.updated_at DESC
                    LIMIT 100
                    """
                ),
                {
                    "product": "%一起来修仙%",
                    "partner": "%爱趣%",
                    "short_name": "%爱趣%",
                },
            ).mappings().all()
        safe_rows = [
            {
                key: (value.isoformat() if hasattr(value, "isoformat") else value)
                for key, value in dict(row).items()
            }
            for row in rows
        ]
        logger.warning("CONTRACT_PROBE_AIQU_XIUXIAN rows=%s", safe_rows)
    except Exception:
        logger.exception("CONTRACT_PROBE_AIQU_XIUXIAN failed")


@router.get("/health")
def health() -> dict:
    return {"ok": True}


@router.get("/health/db", response_model=None)
def health_db():
    ok, detail = test_db_connection()
    if ok:
        _log_contract_match_probe()
        return {"ok": True, "database": "connected"}

    # 具体数据库错误只记录在服务端，避免健康检查接口泄露连接信息。
    logger.error("Database health check failed: %s", detail)
    return JSONResponse(
        status_code=503,
        content={"ok": False, "database": "error"},
        headers={"Cache-Control": "no-store"},
    )