"""Same-origin proxy for the existing Caiwu production API."""

from __future__ import annotations

import os
import re

import httpx
import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import Response
from psycopg.rows import dict_row

app = FastAPI(title="caiwu-api-proxy", docs_url=None, redoc_url=None)

UPSTREAM_ORIGIN = os.environ.get(
    "UPSTREAM_API_ORIGIN",
    "https://caiwuapi.hnchpower.cn",
).rstrip("/")
QUICKSDK_DATABASE_URL = os.environ.get("QUICKSDK_DATABASE_URL", "").strip()

_HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def _request_headers(request: Request) -> dict[str, str]:
    excluded = _HOP_BY_HOP_HEADERS | {"host", "content-length", "accept-encoding"}
    headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower() not in excluded
    }
    # The proxy returns httpx's decoded response body, so request an identity
    # payload from the upstream to avoid forwarding compressed bytes without
    # their original Content-Encoding header.
    headers["accept-encoding"] = "identity"
    headers["x-forwarded-host"] = request.headers.get("host", "")
    headers["x-forwarded-proto"] = request.url.scheme
    return headers


def _response_headers(response: httpx.Response) -> dict[str, str]:
    excluded = _HOP_BY_HOP_HEADERS | {
        "content-length",
        "content-encoding",
        "set-cookie",
        "access-control-allow-origin",
        "access-control-allow-credentials",
    }
    return {
        name: value
        for name, value in response.headers.items()
        if name.lower() not in excluded
    }


def _host_cookie(value: str) -> str:
    """Remove an upstream Domain attribute so browsers accept it for this host."""
    return re.sub(r";\s*Domain=[^;]+", "", value, flags=re.IGNORECASE)


async def _require_authenticated(request: Request) -> None:
    """Validate the proxied session with the existing production auth service."""
    cookie = request.headers.get("cookie", "")
    if not cookie:
        raise HTTPException(status_code=401, detail="请先登录")
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{UPSTREAM_ORIGIN}/api/auth/me",
            headers={"cookie": cookie},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="请先登录")


def _database_url() -> str:
    if not QUICKSDK_DATABASE_URL:
        raise HTTPException(status_code=503, detail="QuickSDK 数据库尚未配置")
    return QUICKSDK_DATABASE_URL


def _month_filter(month: str | None) -> tuple[str, list[str]]:
    normalized = str(month or "").strip()
    if not normalized:
        return "", []
    return ' AND d."reportDate" LIKE %s', [f"{normalized}%"]


@app.get("/api/quicksdk/summary")
async def quicksdk_summary(
    request: Request,
    settlement_month: str | None = Query(None),
) -> dict:
    await _require_authenticated(request)
    clause, params = _month_filter(settlement_month)
    sql = f"""
        SELECT
          COUNT(DISTINCT d."reportDate") AS batch_count,
          COUNT(*) AS row_count,
          COUNT(DISTINCT d."gameId") AS game_count,
          COUNT(DISTINCT d.channel) AS channel_count,
          COALESCE(SUM(d."payAmount"), 0) AS total_flow
        FROM "DailyReport" d
        WHERE d.source = 'quickgame' {clause}
    """
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        row = conn.execute(sql, params).fetchone()
    return {
        "batch_count": int(row["batch_count"] or 0),
        "row_count": int(row["row_count"] or 0),
        "game_count": int(row["game_count"] or 0),
        "channel_count": int(row["channel_count"] or 0),
        "total_flow": round(float(row["total_flow"] or 0), 2),
    }


@app.get("/api/quicksdk/batches")
async def quicksdk_batches(
    request: Request,
    settlement_month: str | None = Query(None),
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    await _require_authenticated(request)
    clause, params = _month_filter(settlement_month)
    sql = f"""
        SELECT
          d."reportDate" AS report_date,
          COUNT(*) AS row_count,
          COUNT(DISTINCT d."gameId") AS game_count,
          COUNT(DISTINCT d.channel) AS channel_count,
          COALESCE(SUM(d."payAmount"), 0) AS total_flow,
          MAX(d."updatedAt") AS imported_at
        FROM "DailyReport" d
        WHERE d.source = 'quickgame' {clause}
        GROUP BY d."reportDate"
        ORDER BY d."reportDate" DESC
        LIMIT %s OFFSET %s
    """
    count_sql = f"""
        SELECT COUNT(DISTINCT d."reportDate")
        FROM "DailyReport" d
        WHERE d.source = 'quickgame' {clause}
    """
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        total = int(conn.execute(count_sql, params).fetchone()["count"] or 0)
        rows = conn.execute(sql, [*params, limit, offset]).fetchall()
    return {
        "items": [
            {
                "id": f"quickgame-{row['report_date']}",
                "source_file": f"QuickSDK 自动同步 {row['report_date']}",
                "settlement_month": str(row["report_date"])[:7],
                "row_count": int(row["row_count"] or 0),
                "game_count": int(row["game_count"] or 0),
                "channel_count": int(row["channel_count"] or 0),
                "total_flow": round(float(row["total_flow"] or 0), 2),
                "note": "来自 qkshuju2026",
                "imported_at": row["imported_at"].isoformat(),
            }
            for row in rows
        ],
        "total": total,
    }


@app.get("/api/quicksdk/flows")
async def quicksdk_flows(
    request: Request,
    settlement_month: str | None = Query(None),
    game_name: str | None = Query(None),
    channel_name: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict:
    await _require_authenticated(request)
    filters = ["d.source = 'quickgame'"]
    params: list[object] = []
    if settlement_month:
        filters.append('d."reportDate" LIKE %s')
        params.append(f"{settlement_month.strip()}%")
    if game_name:
        filters.append("g.name ILIKE %s")
        params.append(f"%{game_name.strip()}%")
    if channel_name:
        filters.append("COALESCE(d.channel, '') ILIKE %s")
        params.append(f"%{channel_name.strip()}%")
    if q:
        filters.append("(g.name ILIKE %s OR COALESCE(d.channel, '') ILIKE %s)")
        params.extend([f"%{q.strip()}%", f"%{q.strip()}%"])
    where = " AND ".join(filters)
    base = f'FROM "DailyReport" d JOIN "Game" g ON g.id = d."gameId" WHERE {where}'
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        total = int(conn.execute(f"SELECT COUNT(*) {base}", params).fetchone()["count"] or 0)
        rows = conn.execute(
            f"""
              SELECT d.id, d."reportDate", g.name AS game_name, d.channel,
                     d."payAmount", d."createdAt"
              {base}
              ORDER BY d."reportDate" DESC, d."payAmount" DESC
              LIMIT %s OFFSET %s
            """,
            [*params, limit, offset],
        ).fetchall()
    return {
        "items": [
            {
                "id": row["id"],
                "flow_date": row["reportDate"],
                "settlement_month": str(row["reportDate"])[:7],
                "game_name": row["game_name"],
                "channel_name": row["channel"],
                "gross_flow": round(float(row["payAmount"] or 0), 2),
                "created_at": row["createdAt"].isoformat(),
            }
            for row in rows
        ],
        "total": total,
    }


@app.get("/api/quicksdk/analytics")
async def quicksdk_analytics(
    request: Request,
    settlement_month: str | None = Query(None),
    limit: int = Query(10, ge=1, le=100),
) -> dict:
    await _require_authenticated(request)
    clause, params = _month_filter(settlement_month)
    where = f"d.source = 'quickgame' {clause}"
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        total_flow = float(
            conn.execute(
                f'SELECT COALESCE(SUM(d."payAmount"), 0) AS total FROM "DailyReport" d WHERE {where}',
                params,
            ).fetchone()["total"]
            or 0
        )
        games = conn.execute(
            f"""
              SELECT g.name, SUM(d."payAmount") AS flow, COUNT(*) AS row_count
              FROM "DailyReport" d JOIN "Game" g ON g.id = d."gameId"
              WHERE {where}
              GROUP BY g.name ORDER BY flow DESC LIMIT %s
            """,
            [*params, limit],
        ).fetchall()
        channels = conn.execute(
            f"""
              SELECT COALESCE(d.channel, '未填写') AS name,
                     SUM(d."payAmount") AS flow, COUNT(*) AS row_count
              FROM "DailyReport" d
              WHERE {where}
              GROUP BY COALESCE(d.channel, '未填写') ORDER BY flow DESC LIMIT %s
            """,
            [*params, limit],
        ).fetchall()
        monthly = conn.execute(
            """
              SELECT SUBSTRING(d."reportDate", 1, 7) AS settlement_month,
                     COUNT(*) AS row_count,
                     COUNT(DISTINCT d."gameId") AS game_count,
                     COUNT(DISTINCT d.channel) AS channel_count,
                     SUM(d."payAmount") AS total_flow
              FROM "DailyReport" d
              WHERE d.source = 'quickgame'
              GROUP BY SUBSTRING(d."reportDate", 1, 7)
              ORDER BY settlement_month DESC
            """
        ).fetchall()

    def rankings(rows: list[dict]) -> list[dict]:
        return [
            {
                "name": row["name"],
                "flow": round(float(row["flow"] or 0), 2),
                "row_count": int(row["row_count"] or 0),
                "percentage": round(float(row["flow"] or 0) / total_flow * 100, 1)
                if total_flow
                else 0,
            }
            for row in rows
        ]

    return {
        "game_rankings": rankings(games),
        "channel_rankings": rankings(channels),
        "monthly": [
            {
                **dict(row),
                "row_count": int(row["row_count"] or 0),
                "game_count": int(row["game_count"] or 0),
                "channel_count": int(row["channel_count"] or 0),
                "total_flow": round(float(row["total_flow"] or 0), 2),
            }
            for row in monthly
        ],
    }


@app.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy(request: Request, path: str) -> Response:
    url = f"{UPSTREAM_ORIGIN}{request.url.path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    async with httpx.AsyncClient(follow_redirects=False, timeout=60.0) as client:
        upstream = await client.request(
            request.method,
            url,
            headers=_request_headers(request),
            content=await request.body(),
        )

    if request.method == "GET" and request.url.path == "/api/reconciliation":
        try:
            payload = upstream.json()
            items = payload.get("items") if isinstance(payload, dict) else None
            print(
                "[reconciliation-proxy] response summary",
                {
                    "status": upstream.status_code,
                    "total": payload.get("total") if isinstance(payload, dict) else None,
                    "item_count": len(items) if isinstance(items, list) else None,
                },
            )
        except ValueError:
            print(
                "[reconciliation-proxy] non-json response",
                {"status": upstream.status_code, "bytes": len(upstream.content)},
            )

    result = Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=_response_headers(upstream),
        media_type=None,
    )
    for cookie in upstream.headers.get_list("set-cookie"):
        result.headers.append("set-cookie", _host_cookie(cookie))
    return result
