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
                      contract.contract_name,
                      contract.counterparty,
                      contract.performance_status,
                      partner.name AS partner_name,
                      partner.short_name AS partner_short_name,
                      terms.invoice_tax_rate
                    FROM cf_contract_access_items AS access
                    JOIN cf_contract_records AS contract ON contract.id = access.contract_id
                    LEFT JOIN cf_partner_records AS partner ON partner.id = contract.partner_id
                    LEFT JOIN cf_contract_access_terms AS terms ON terms.access_item_id = access.id
                    WHERE access.product_name ILIKE :product
                    ORDER BY contract.updated_at DESC, access.updated_at DESC
                    LIMIT 50
                    """
                ),
                {"product": "%一起来修仙%"},
            ).mappings().all()
        compact_rows = []
        for row in rows:
            item = dict(row)
            compact_rows.append({
                "id": item.get("access_item_id"),
                "game": item.get("product_name"),
                "channel": item.get("channel_name"),
                "auth": f"{item.get('authorization_start')}~{item.get('authorization_end')}",
                "share": str(item.get("share_rate")),
                "fee": str(item.get("channel_fee_rate")),
                "tax": str(item.get("invoice_tax_rate")),
                "access_status": item.get("access_status"),
                "contract": item.get("contract_name"),
                "contract_status": item.get("performance_status"),
                "counterparty": item.get("counterparty"),
                "partner": item.get("partner_name"),
                "short": item.get("partner_short_name"),
            })
        logger.warning("CONTRACT_PROBE_XIUXIAN count=%s rows=%s", len(compact_rows), compact_rows)
    except Exception:
        logger.exception("CONTRACT_PROBE_XIUXIAN failed")


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