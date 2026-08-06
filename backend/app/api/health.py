"""Health endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.database import test_db_connection

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)


@router.get("/health")
def health() -> dict:
    return {"ok": True}


@router.get("/health/db", response_model=None)
def health_db():
    ok, detail = test_db_connection()
    if ok:
        return {"ok": True, "database": "connected"}

    # 具体数据库错误只记录在服务端，避免健康检查接口泄露连接信息。
    logger.error("Database health check failed: %s", detail)
    return JSONResponse(
        status_code=503,
        content={"ok": False, "database": "error"},
        headers={"Cache-Control": "no-store"},
    )
