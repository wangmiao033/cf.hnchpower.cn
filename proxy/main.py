"""Same-origin proxy for the existing Caiwu production API."""

from __future__ import annotations

import asyncio
import json
import os
import re
from uuid import uuid4

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


async def _require_authenticated(request: Request) -> str:
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
    return cookie


def _database_url() -> str:
    if not QUICKSDK_DATABASE_URL:
        raise HTTPException(status_code=503, detail="QuickSDK 数据库尚未配置")
    return QUICKSDK_DATABASE_URL


def _month_filter(month: str | None) -> tuple[str, list[str]]:
    normalized = str(month or "").strip()
    if not normalized:
        return "", []
    return ' AND d."reportDate" LIKE %s', [f"{normalized}%"]


PARTNER_CATEGORIES = {"研发商", "发行商", "渠道", "供应商", "其他"}
PARTNER_FIELDS = {
    "name",
    "category",
    "tag",
    "tax_registration_no",
    "bank_name",
    "bank_account",
    "invoice_content",
    "recipient",
    "recipient_phone",
    "mailing_address",
}


def _partner_name_key(value: object) -> str:
    return (
        str(value or "")
        .strip()
        .lower()
        .replace("（", "(")
        .replace("）", ")")
        .replace(" ", "")
    )


def _clean_partner_value(value: object, *, limit: int = 2000) -> str:
    return str(value or "").strip()[:limit]


def _partner_payload(raw: dict, *, require_name: bool = True) -> dict[str, str]:
    payload = {
        key: _clean_partner_value(raw.get(key), limit=500 if key != "mailing_address" else 2000)
        for key in PARTNER_FIELDS
    }
    if require_name and not payload["name"]:
        raise HTTPException(status_code=422, detail="请填写客户名称")
    category = payload["category"] or "研发商"
    if category not in PARTNER_CATEGORIES:
        category = "其他"
    payload["category"] = category
    return payload


def _ensure_partners_table(conn: psycopg.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_partner_records (
          id TEXT PRIMARY KEY,
          normalized_name TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT '研发商',
          tag TEXT NOT NULL DEFAULT '',
          tax_registration_no TEXT NOT NULL DEFAULT '',
          bank_name TEXT NOT NULL DEFAULT '',
          bank_account TEXT NOT NULL DEFAULT '',
          invoice_content TEXT NOT NULL DEFAULT '',
          recipient TEXT NOT NULL DEFAULT '',
          recipient_phone TEXT NOT NULL DEFAULT '',
          mailing_address TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_partner_records_category
        ON cf_partner_records (category)
        """
    )


def _partner_row(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "category": row["category"],
        "tag": row["tag"],
        "tax_registration_no": row["tax_registration_no"],
        "bank_name": row["bank_name"],
        "bank_account": row["bank_account"],
        "invoice_content": row["invoice_content"],
        "recipient": row["recipient"],
        "recipient_phone": row["recipient_phone"],
        "mailing_address": row["mailing_address"],
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }


async def _upstream_list(client: httpx.AsyncClient, cookie: str, path: str) -> list[dict]:
    try:
        response = await client.get(
            f"{UPSTREAM_ORIGIN}{path}",
            headers={"cookie": cookie, "accept-encoding": "identity"},
        )
        if response.status_code != 200:
            return []
        payload = response.json()
        items = payload.get("items") if isinstance(payload, dict) else None
        return items if isinstance(items, list) else []
    except (httpx.HTTPError, ValueError):
        return []


def _payment_remark_fields(raw: object) -> dict[str, str]:
    if not raw:
        return {}
    try:
        payload = json.loads(str(raw))
    except (TypeError, ValueError):
        return {}
    if not isinstance(payload, dict) or payload.get("v") != 1:
        return {}
    return {
        "recipient_phone": _clean_partner_value(payload.get("recipientPhone"), limit=200),
        "mailing_address": _clean_partner_value(payload.get("address"), limit=2000),
    }


async def _bootstrap_partners(cookie: str) -> list[dict]:
    """Recover server-known customer data when the new partner table is empty."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        reconciliation, channels, invoices, payments = await asyncio.gather(
            _upstream_list(client, cookie, "/api/reconciliation?limit=500&offset=0"),
            _upstream_list(client, cookie, "/api/channel-records?limit=500&offset=0"),
            _upstream_list(client, cookie, "/api/invoices?limit=500&offset=0"),
            _upstream_list(client, cookie, "/api/payments?limit=500&offset=0"),
        )

    recovered: dict[str, dict[str, str]] = {}

    def add_name(value: object, category: str) -> None:
        name = _clean_partner_value(value, limit=500)
        key = _partner_name_key(name)
        if not key:
            return
        recovered.setdefault(
            key,
            _partner_payload({"name": name, "category": category}),
        )

    for item in reconciliation:
        add_name(item.get("partner_name") or item.get("partner"), "研发商")
    for item in channels:
        add_name(item.get("partner_name") or item.get("partner"), "渠道")

    for item in invoices:
        candidates = [
            (item.get("buyer_name"), item.get("buyer_tax_no")),
            (item.get("seller_name"), item.get("seller_tax_no")),
            (item.get("title"), item.get("tax_no")),
        ]
        for raw_name, raw_tax_no in candidates:
            partner = recovered.get(_partner_name_key(raw_name))
            tax_no = _clean_partner_value(raw_tax_no, limit=500)
            if partner is not None and tax_no and not partner["tax_registration_no"]:
                partner["tax_registration_no"] = tax_no

    for item in payments:
        partner = recovered.get(_partner_name_key(item.get("customer")))
        if partner is None:
            continue
        recipient = _clean_partner_value(item.get("recipient"), limit=500)
        if recipient and not partner["recipient"]:
            partner["recipient"] = recipient
        for key, value in _payment_remark_fields(item.get("remark")).items():
            if value and not partner[key]:
                partner[key] = value

    return list(recovered.values())


def _upsert_partner(conn: psycopg.Connection, payload: dict[str, str]) -> None:
    key = _partner_name_key(payload["name"])
    if not key:
        return
    conn.execute(
        """
        INSERT INTO cf_partner_records (
          id, normalized_name, name, category, tag, tax_registration_no,
          bank_name, bank_account, invoice_content, recipient,
          recipient_phone, mailing_address
        )
        VALUES (
          %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s,
          %s, %s
        )
        ON CONFLICT (normalized_name) DO UPDATE SET
          name = EXCLUDED.name,
          category = CASE
            WHEN cf_partner_records.category = '' THEN EXCLUDED.category
            ELSE cf_partner_records.category
          END,
          tag = COALESCE(NULLIF(EXCLUDED.tag, ''), cf_partner_records.tag),
          tax_registration_no = COALESCE(
            NULLIF(EXCLUDED.tax_registration_no, ''),
            cf_partner_records.tax_registration_no
          ),
          bank_name = COALESCE(NULLIF(EXCLUDED.bank_name, ''), cf_partner_records.bank_name),
          bank_account = COALESCE(
            NULLIF(EXCLUDED.bank_account, ''),
            cf_partner_records.bank_account
          ),
          invoice_content = COALESCE(
            NULLIF(EXCLUDED.invoice_content, ''),
            cf_partner_records.invoice_content
          ),
          recipient = COALESCE(NULLIF(EXCLUDED.recipient, ''), cf_partner_records.recipient),
          recipient_phone = COALESCE(
            NULLIF(EXCLUDED.recipient_phone, ''),
            cf_partner_records.recipient_phone
          ),
          mailing_address = COALESCE(
            NULLIF(EXCLUDED.mailing_address, ''),
            cf_partner_records.mailing_address
          ),
          updated_at = NOW()
        """,
        [
            str(uuid4()),
            key,
            payload["name"],
            payload["category"],
            payload["tag"],
            payload["tax_registration_no"],
            payload["bank_name"],
            payload["bank_account"],
            payload["invoice_content"],
            payload["recipient"],
            payload["recipient_phone"],
            payload["mailing_address"],
        ],
    )


@app.get("/api/partners/health")
def partner_health() -> dict:
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_partners_table(conn)
        count = int(
            conn.execute("SELECT COUNT(*) AS count FROM cf_partner_records").fetchone()["count"]
        )
        conn.commit()
    return {"status": "ok", "storage": "postgres", "count": count}


@app.get("/api/partners")
async def list_partners(
    request: Request,
    q: str | None = Query(None),
    category: str | None = Query(None),
) -> dict:
    cookie = await _require_authenticated(request)
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_partners_table(conn)
        count = int(conn.execute("SELECT COUNT(*) AS count FROM cf_partner_records").fetchone()["count"])
        conn.commit()

    bootstrapped = False
    if count == 0:
        recovered = await _bootstrap_partners(cookie)
        if recovered:
            with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
                _ensure_partners_table(conn)
                for partner in recovered:
                    _upsert_partner(conn, partner)
                conn.commit()
            print("[partners] recovered customers from server records", {"count": len(recovered)})
            bootstrapped = True

    filters: list[str] = []
    params: list[object] = []
    if q and q.strip():
        filters.append(
            """
            (name ILIKE %s OR tag ILIKE %s OR tax_registration_no ILIKE %s
             OR bank_name ILIKE %s OR recipient ILIKE %s)
            """
        )
        term = f"%{q.strip()}%"
        params.extend([term, term, term, term, term])
    if category and category.strip():
        filters.append("category = %s")
        params.append(category.strip())
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_partners_table(conn)
        rows = conn.execute(
            f"""
            SELECT * FROM cf_partner_records
            {where}
            ORDER BY category, name
            """,
            params,
        ).fetchall()
    return {
        "items": [_partner_row(row) for row in rows],
        "total": len(rows),
        "bootstrapped": bootstrapped,
    }


@app.post("/api/partners", status_code=201)
async def create_partner(request: Request, payload: dict) -> dict:
    await _require_authenticated(request)
    clean = _partner_payload(payload)
    key = _partner_name_key(clean["name"])
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_partners_table(conn)
        try:
            row = conn.execute(
                """
                INSERT INTO cf_partner_records (
                  id, normalized_name, name, category, tag, tax_registration_no,
                  bank_name, bank_account, invoice_content, recipient,
                  recipient_phone, mailing_address
                )
                VALUES (
                  %s, %s, %s, %s, %s, %s,
                  %s, %s, %s, %s,
                  %s, %s
                )
                RETURNING *
                """,
                [
                    str(uuid4()),
                    key,
                    clean["name"],
                    clean["category"],
                    clean["tag"],
                    clean["tax_registration_no"],
                    clean["bank_name"],
                    clean["bank_account"],
                    clean["invoice_content"],
                    clean["recipient"],
                    clean["recipient_phone"],
                    clean["mailing_address"],
                ],
            ).fetchone()
            conn.commit()
        except psycopg.errors.UniqueViolation as exc:
            raise HTTPException(status_code=409, detail="同名客户已存在") from exc
    return _partner_row(row)


@app.put("/api/partners/{partner_id}")
async def update_partner(partner_id: str, request: Request, payload: dict) -> dict:
    await _require_authenticated(request)
    clean = _partner_payload(payload)
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_partners_table(conn)
        try:
            row = conn.execute(
                """
                UPDATE cf_partner_records SET
                  normalized_name = %s,
                  name = %s,
                  category = %s,
                  tag = %s,
                  tax_registration_no = %s,
                  bank_name = %s,
                  bank_account = %s,
                  invoice_content = %s,
                  recipient = %s,
                  recipient_phone = %s,
                  mailing_address = %s,
                  updated_at = NOW()
                WHERE id = %s
                RETURNING *
                """,
                [
                    _partner_name_key(clean["name"]),
                    clean["name"],
                    clean["category"],
                    clean["tag"],
                    clean["tax_registration_no"],
                    clean["bank_name"],
                    clean["bank_account"],
                    clean["invoice_content"],
                    clean["recipient"],
                    clean["recipient_phone"],
                    clean["mailing_address"],
                    partner_id,
                ],
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="客户不存在")
            conn.commit()
        except psycopg.errors.UniqueViolation as exc:
            raise HTTPException(status_code=409, detail="同名客户已存在") from exc
    return _partner_row(row)


@app.delete("/api/partners/{partner_id}", status_code=204)
async def delete_partner(partner_id: str, request: Request) -> Response:
    await _require_authenticated(request)
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_partners_table(conn)
        row = conn.execute(
            "DELETE FROM cf_partner_records WHERE id = %s RETURNING id",
            [partner_id],
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="客户不存在")
        conn.commit()
    return Response(status_code=204)


@app.post("/api/partners/import")
async def import_partners(request: Request, payload: dict) -> dict:
    await _require_authenticated(request)
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        raise HTTPException(status_code=422, detail="客户数据格式无效")
    imported = 0
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_partners_table(conn)
        for raw in raw_items[:1000]:
            if not isinstance(raw, dict):
                continue
            clean = _partner_payload(raw, require_name=False)
            if not clean["name"]:
                continue
            _upsert_partner(conn, clean)
            imported += 1
        conn.commit()
    return {"imported": imported}


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
