"""Same-origin proxy for the existing Caiwu production API."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from uuid import uuid4

import httpx
import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import Response
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

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
    "short_name",
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
LEGACY_SHORT_NAME_PATTERN = re.compile(r"^简称[:：]\s*([^；;]+)[；;]?\s*")
PARTNER_ALIAS_REPAIR_MIGRATION = "20260726_split_combined_customer_aliases_v1"
PARTNER_ALIAS_REPAIRS = {
    "玩咖": "玩咖",
    "广州熊动科技有限公司": "熊动",
    "北京千幻文化传媒有限公司": "千幻",
    "广州超凡响应网络科技有限公司": "超凡响应",
    "杭州司墨网络科技有限公司": "司墨",
    "杭州速发网络科技有限公司": "速发",
    "广州沙巴克网络科技有限公司": "沙巴克",
    "广州玺越网络科技有限公司": "玺越",
    "西安游海网络科技有限公司": "游海",
    "西安麦游网络科技有限公司": "麦游",
}
RECONCILIATION_PATH_PATTERN = re.compile(r"^/api/reconciliation(?:/([^/]+))?$")
CONTRACT_FIELDS = {
    "contract_name",
    "contract_type",
    "amount",
    "counterparty",
    "contract_no",
    "signing_date",
    "signing_status",
    "effective_date",
    "end_date",
    "performance_status",
    "payment_type",
    "attachments",
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
    if not payload["short_name"] and payload["tag"]:
        legacy_short_name = LEGACY_SHORT_NAME_PATTERN.match(payload["tag"])
        if legacy_short_name:
            payload["short_name"] = legacy_short_name.group(1).strip()
            payload["tag"] = payload["tag"][legacy_short_name.end() :].strip()
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
          short_name TEXT NOT NULL DEFAULT '',
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
        ALTER TABLE cf_partner_records
        ADD COLUMN IF NOT EXISTS short_name TEXT NOT NULL DEFAULT ''
        """
    )
    conn.execute(
        """
        UPDATE cf_partner_records
        SET
          short_name = BTRIM(
            SUBSTRING(tag FROM '^简称[:：][[:space:]]*([^；;]+)')
          ),
          tag = BTRIM(
            REGEXP_REPLACE(
              tag,
              '^简称[:：][[:space:]]*[^；;]+[；;]?[[:space:]]*',
              ''
            )
          )
        WHERE short_name = '' AND tag ~ '^简称[:：]'
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_partner_data_migrations (
          migration_key TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_partner_alias_repair_backup (
          migration_key TEXT NOT NULL,
          partner_id TEXT NOT NULL,
          partner_name TEXT NOT NULL,
          old_short_name TEXT NOT NULL,
          new_short_name TEXT NOT NULL,
          backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (migration_key, partner_id)
        )
        """
    )
    alias_repair_applied = conn.execute(
        """
        SELECT 1
        FROM cf_partner_data_migrations
        WHERE migration_key = %s
        """,
        [PARTNER_ALIAS_REPAIR_MIGRATION],
    ).fetchone()
    if alias_repair_applied is None:
        repair_placeholders = ", ".join(["(%s, %s)"] * len(PARTNER_ALIAS_REPAIRS))
        repair_params = [
            item
            for partner_name, short_name in PARTNER_ALIAS_REPAIRS.items()
            for item in (_partner_name_key(partner_name), short_name)
        ]
        conn.execute(
            f"""
            WITH repairs(normalized_name, new_short_name) AS (
              VALUES {repair_placeholders}
            )
            INSERT INTO cf_partner_alias_repair_backup (
              migration_key, partner_id, partner_name, old_short_name, new_short_name
            )
            SELECT
              %s, partner.id, partner.name, partner.short_name, repairs.new_short_name
            FROM cf_partner_records AS partner
            JOIN repairs USING (normalized_name)
            WHERE partner.short_name IS DISTINCT FROM repairs.new_short_name
            ON CONFLICT (migration_key, partner_id) DO NOTHING
            """,
            [*repair_params, PARTNER_ALIAS_REPAIR_MIGRATION],
        )
        conn.execute(
            f"""
            WITH repairs(normalized_name, new_short_name) AS (
              VALUES {repair_placeholders}
            )
            UPDATE cf_partner_records AS partner
            SET
              short_name = repairs.new_short_name,
              updated_at = NOW()
            FROM repairs
            WHERE partner.normalized_name = repairs.normalized_name
              AND partner.short_name IS DISTINCT FROM repairs.new_short_name
            """,
            repair_params,
        )
        conn.execute(
            """
            INSERT INTO cf_partner_data_migrations (migration_key)
            VALUES (%s)
            ON CONFLICT (migration_key) DO NOTHING
            """,
            [PARTNER_ALIAS_REPAIR_MIGRATION],
        )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_partner_records_category
        ON cf_partner_records (category)
        """
    )


def _ensure_reconciliation_links_table(conn: psycopg.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_reconciliation_partner_links (
          reconciliation_id TEXT PRIMARY KEY,
          partner_id TEXT NOT NULL REFERENCES cf_partner_records(id) ON DELETE RESTRICT,
          partner_name_snapshot TEXT NOT NULL DEFAULT '',
          match_method TEXT NOT NULL DEFAULT 'exact_name',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_reconciliation_partner_links_partner
        ON cf_reconciliation_partner_links (partner_id)
        """
    )


def _resolve_reconciliation_partner(
    conn: psycopg.Connection,
    *,
    partner_id: object = None,
    partner_name: object = None,
) -> dict | None:
    requested_id = _clean_partner_value(partner_id, limit=200)
    if requested_id:
        return conn.execute(
            """
            SELECT id, name, short_name
            FROM cf_partner_records
            WHERE id = %s
            """,
            [requested_id],
        ).fetchone()

    key = _partner_name_key(partner_name)
    if not key:
        return None
    exact = conn.execute(
        """
        SELECT id, name, short_name
        FROM cf_partner_records
        WHERE normalized_name = %s
        """,
        [key],
    ).fetchone()
    if exact is not None:
        return exact

    alias_matches = [
        row
        for row in conn.execute(
            """
            SELECT id, name, short_name
            FROM cf_partner_records
            WHERE short_name <> ''
            """
        ).fetchall()
        if _partner_name_key(row["short_name"]) == key
    ]
    return alias_matches[0] if len(alias_matches) == 1 else None


def _upsert_reconciliation_partner_link(
    conn: psycopg.Connection,
    *,
    reconciliation_id: object,
    partner: dict,
    snapshot: object,
    match_method: str,
) -> None:
    record_id = _clean_partner_value(reconciliation_id, limit=200)
    if not record_id:
        return
    conn.execute(
        """
        INSERT INTO cf_reconciliation_partner_links (
          reconciliation_id, partner_id, partner_name_snapshot, match_method
        )
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (reconciliation_id) DO UPDATE SET
          partner_id = EXCLUDED.partner_id,
          partner_name_snapshot = EXCLUDED.partner_name_snapshot,
          match_method = EXCLUDED.match_method,
          updated_at = NOW()
        """,
        [
            record_id,
            partner["id"],
            _clean_partner_value(snapshot, limit=500) or partner["name"],
            match_method,
        ],
    )


def _reconciliation_rows(payload: object) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    items = payload.get("items")
    if isinstance(items, list):
        return [item for item in items if isinstance(item, dict)]
    item = payload.get("item")
    if isinstance(item, dict):
        return [item]
    return [payload] if payload.get("id") is not None else []


def _sync_reconciliation_partner_links(
    payload: object,
    *,
    selected_partner_id: object = None,
    selected_snapshot: object = None,
) -> object:
    rows = _reconciliation_rows(payload)
    if not rows:
        return payload

    record_ids = [
        _clean_partner_value(row.get("id"), limit=200)
        for row in rows
        if _clean_partner_value(row.get("id"), limit=200)
    ]
    if not record_ids:
        return payload

    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_partners_table(conn)
        _ensure_reconciliation_links_table(conn)
        existing = {
            row["reconciliation_id"]: row
            for row in conn.execute(
                """
                SELECT
                  link.reconciliation_id,
                  link.partner_id,
                  partner.name,
                  partner.short_name
                FROM cf_reconciliation_partner_links AS link
                JOIN cf_partner_records AS partner ON partner.id = link.partner_id
                WHERE link.reconciliation_id = ANY(%s)
                """,
                [record_ids],
            ).fetchall()
        }

        selected_partner = None
        if _clean_partner_value(selected_partner_id, limit=200):
            selected_partner = _resolve_reconciliation_partner(
                conn,
                partner_id=selected_partner_id,
            )
            if selected_partner is None:
                raise HTTPException(status_code=422, detail="所选客户不存在，请刷新客户库后重试")

        for row in rows:
            record_id = _clean_partner_value(row.get("id"), limit=200)
            if not record_id:
                continue
            if selected_partner is not None:
                _upsert_reconciliation_partner_link(
                    conn,
                    reconciliation_id=record_id,
                    partner=selected_partner,
                    snapshot=selected_snapshot or row.get("partner_name"),
                    match_method="selected",
                )
                continue
            if record_id in existing:
                continue
            matched = _resolve_reconciliation_partner(
                conn,
                partner_name=row.get("partner_name"),
            )
            if matched is not None:
                _upsert_reconciliation_partner_link(
                    conn,
                    reconciliation_id=record_id,
                    partner=matched,
                    snapshot=row.get("partner_name"),
                    match_method="exact_name",
                )

        linked = {
            row["reconciliation_id"]: row
            for row in conn.execute(
                """
                SELECT
                  link.reconciliation_id,
                  link.partner_id,
                  link.partner_name_snapshot,
                  link.match_method,
                  partner.name,
                  partner.short_name
                FROM cf_reconciliation_partner_links AS link
                JOIN cf_partner_records AS partner ON partner.id = link.partner_id
                WHERE link.reconciliation_id = ANY(%s)
                """,
                [record_ids],
            ).fetchall()
        }
        conn.commit()

    for row in rows:
        link = linked.get(_clean_partner_value(row.get("id"), limit=200))
        row["partner_id"] = link["partner_id"] if link else None
        row["partner_short_name"] = link["short_name"] if link else None
        row["partner_link_status"] = "linked" if link else "unlinked"
        if link:
            row["partner_name_snapshot"] = link["partner_name_snapshot"]
            row["partner_name"] = link["name"]
    return payload


def _partner_row(row: dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "short_name": row["short_name"],
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
          id, normalized_name, name, short_name, category, tag, tax_registration_no,
          bank_name, bank_account, invoice_content, recipient,
          recipient_phone, mailing_address
        )
        VALUES (
          %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s,
          %s, %s
        )
        ON CONFLICT (normalized_name) DO UPDATE SET
          name = EXCLUDED.name,
          short_name = COALESCE(
            NULLIF(EXCLUDED.short_name, ''),
            cf_partner_records.short_name
          ),
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
            payload["short_name"],
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


def _clean_contract_date(value: object) -> str | None:
    raw = _clean_partner_value(value, limit=20)
    if not raw:
        return None
    try:
        return date.fromisoformat(raw).isoformat()
    except ValueError:
        return None


def _clean_contract_amount(value: object) -> Decimal | None:
    raw = (
        _clean_partner_value(value, limit=80)
        .replace("¥", "")
        .replace("￥", "")
        .replace(",", "")
        .replace("，", "")
        .strip()
    )
    if not raw:
        return None
    try:
        return Decimal(raw).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None


def _clean_contract_attachments(value: object) -> list[str]:
    values = value if isinstance(value, list) else re.split(r"[;；\n]+", str(value or ""))
    result: list[str] = []
    seen: set[str] = set()
    for item in values[:100]:
        cleaned = _clean_partner_value(item, limit=500)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        result.append(cleaned)
    return result


def _contract_payload(raw: dict, *, require_name: bool = True) -> dict:
    payload = {
        "contract_name": _clean_partner_value(raw.get("contract_name"), limit=1000),
        "contract_type": _clean_partner_value(raw.get("contract_type"), limit=200),
        "amount": _clean_contract_amount(raw.get("amount")),
        "counterparty": _clean_partner_value(raw.get("counterparty"), limit=1000),
        "contract_no": _clean_partner_value(raw.get("contract_no"), limit=300),
        "signing_date": _clean_contract_date(raw.get("signing_date")),
        "signing_status": _clean_partner_value(raw.get("signing_status"), limit=100),
        "effective_date": _clean_contract_date(raw.get("effective_date")),
        "end_date": _clean_contract_date(raw.get("end_date")),
        "performance_status": _clean_partner_value(raw.get("performance_status"), limit=100),
        "payment_type": _clean_partner_value(raw.get("payment_type"), limit=100),
        "attachments": _clean_contract_attachments(raw.get("attachments")),
    }
    if require_name and not payload["contract_name"]:
        raise HTTPException(status_code=422, detail="请填写合同名称")
    return payload


def _contract_source_key(payload: dict) -> str:
    parts = [
        payload.get("contract_no") or "",
        payload.get("contract_name") or "",
        payload.get("counterparty") or "",
        payload.get("signing_date") or "",
        payload.get("end_date") or "",
    ]
    normalized = [_partner_name_key(part) for part in parts]
    return hashlib.sha256(
        json.dumps(normalized, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _ensure_contracts_table(conn: psycopg.Connection) -> None:
    _ensure_partners_table(conn)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_contract_records (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL DEFAULT 'manual',
          source_key TEXT NOT NULL UNIQUE,
          contract_name TEXT NOT NULL,
          contract_type TEXT NOT NULL DEFAULT '',
          amount NUMERIC(18, 2) NULL,
          counterparty TEXT NOT NULL DEFAULT '',
          normalized_counterparty TEXT NOT NULL DEFAULT '',
          contract_no TEXT NOT NULL DEFAULT '',
          signing_date DATE NULL,
          signing_status TEXT NOT NULL DEFAULT '',
          effective_date DATE NULL,
          end_date DATE NULL,
          performance_status TEXT NOT NULL DEFAULT '',
          payment_type TEXT NOT NULL DEFAULT '',
          attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
          partner_id TEXT NULL REFERENCES cf_partner_records(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_contract_records_end_date
        ON cf_contract_records (end_date)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_contract_records_counterparty
        ON cf_contract_records (normalized_counterparty)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_contract_records_partner_id
        ON cf_contract_records (partner_id)
        """
    )


def _resolve_contract_partner(conn: psycopg.Connection, counterparty: object) -> dict | None:
    key = _partner_name_key(counterparty)
    if not key:
        return None
    return conn.execute(
        """
        SELECT id, name, short_name
        FROM cf_partner_records
        WHERE normalized_name = %s
        """,
        [key],
    ).fetchone()


def _relink_contract_partners(conn: psycopg.Connection) -> int:
    result = conn.execute(
        """
        UPDATE cf_contract_records AS contract
        SET partner_id = partner.id, updated_at = NOW()
        FROM cf_partner_records AS partner
        WHERE contract.normalized_counterparty = partner.normalized_name
          AND contract.normalized_counterparty <> ''
          AND contract.partner_id IS DISTINCT FROM partner.id
        """
    )
    return int(result.rowcount or 0)


def _contract_timeline_status(row: dict) -> str:
    today = date.today()
    effective_date = row.get("effective_date")
    end_date = row.get("end_date")
    if effective_date and effective_date > today:
        return "待生效"
    if end_date and end_date < today:
        return "已过期"
    if end_date and 0 <= (end_date - today).days <= 30:
        return "即将到期"
    return "生效中"


def _contract_row(row: dict) -> dict:
    return {
        "id": row["id"],
        "source": row["source"],
        "contract_name": row["contract_name"],
        "contract_type": row["contract_type"],
        "amount": str(row["amount"]) if row["amount"] is not None else None,
        "counterparty": row["counterparty"],
        "contract_no": row["contract_no"],
        "signing_date": row["signing_date"].isoformat() if row["signing_date"] else None,
        "signing_status": row["signing_status"],
        "effective_date": row["effective_date"].isoformat() if row["effective_date"] else None,
        "end_date": row["end_date"].isoformat() if row["end_date"] else None,
        "performance_status": row["performance_status"],
        "payment_type": row["payment_type"],
        "attachments": row["attachments"] if isinstance(row["attachments"], list) else [],
        "partner_id": row.get("partner_id"),
        "partner_name": row.get("partner_name"),
        "partner_short_name": row.get("partner_short_name"),
        "partner_link_status": "linked" if row.get("partner_id") else "unlinked",
        "timeline_status": _contract_timeline_status(row),
        "contract_no_duplicate": int(row.get("contract_no_count") or 0) > 1,
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }


def _upsert_contract(
    conn: psycopg.Connection,
    payload: dict,
    *,
    source: str,
) -> tuple[dict, bool]:
    source_key = _contract_source_key(payload)
    existing = conn.execute(
        "SELECT id FROM cf_contract_records WHERE source_key = %s",
        [source_key],
    ).fetchone()
    partner = _resolve_contract_partner(conn, payload["counterparty"])
    row = conn.execute(
        """
        INSERT INTO cf_contract_records (
          id, source, source_key, contract_name, contract_type, amount,
          counterparty, normalized_counterparty, contract_no,
          signing_date, signing_status, effective_date, end_date,
          performance_status, payment_type, attachments, partner_id
        )
        VALUES (
          %s, %s, %s, %s, %s, %s,
          %s, %s, %s,
          %s, %s, %s, %s,
          %s, %s, %s, %s
        )
        ON CONFLICT (source_key) DO UPDATE SET
          source = EXCLUDED.source,
          contract_name = EXCLUDED.contract_name,
          contract_type = EXCLUDED.contract_type,
          amount = EXCLUDED.amount,
          counterparty = EXCLUDED.counterparty,
          normalized_counterparty = EXCLUDED.normalized_counterparty,
          contract_no = EXCLUDED.contract_no,
          signing_date = EXCLUDED.signing_date,
          signing_status = EXCLUDED.signing_status,
          effective_date = EXCLUDED.effective_date,
          end_date = EXCLUDED.end_date,
          performance_status = EXCLUDED.performance_status,
          payment_type = EXCLUDED.payment_type,
          attachments = EXCLUDED.attachments,
          partner_id = EXCLUDED.partner_id,
          updated_at = NOW()
        RETURNING *
        """,
        [
            existing["id"] if existing else str(uuid4()),
            source,
            source_key,
            payload["contract_name"],
            payload["contract_type"],
            payload["amount"],
            payload["counterparty"],
            _partner_name_key(payload["counterparty"]),
            payload["contract_no"],
            payload["signing_date"],
            payload["signing_status"],
            payload["effective_date"],
            payload["end_date"],
            payload["performance_status"],
            payload["payment_type"],
            Jsonb(payload["attachments"]),
            partner["id"] if partner else None,
        ],
    ).fetchone()
    row["partner_name"] = partner["name"] if partner else None
    row["partner_short_name"] = partner["short_name"] if partner else None
    row["contract_no_count"] = 1
    return row, existing is None


@app.get("/api/partners/health")
def partner_health() -> dict:
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_partners_table(conn)
        row = conn.execute(
            """
            SELECT
              COUNT(*) AS count,
              COUNT(*) FILTER (WHERE short_name <> '') AS short_name_count,
              COUNT(DISTINCT NULLIF(short_name, '')) AS unique_short_name_count,
              COUNT(*) FILTER (WHERE short_name <> '')
                - COUNT(DISTINCT NULLIF(short_name, '')) AS duplicate_short_name_count
            FROM cf_partner_records
            """
        ).fetchone()
        conn.commit()
    return {
        "status": "ok",
        "storage": "postgres",
        "count": int(row["count"]),
        "short_name_count": int(row["short_name_count"]),
        "unique_short_name_count": int(row["unique_short_name_count"]),
        "duplicate_short_name_count": int(row["duplicate_short_name_count"]),
    }


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
            (name ILIKE %s OR short_name ILIKE %s OR tag ILIKE %s
             OR tax_registration_no ILIKE %s OR bank_name ILIKE %s
             OR recipient ILIKE %s)
            """
        )
        term = f"%{q.strip()}%"
        params.extend([term, term, term, term, term, term])
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
                  id, normalized_name, name, short_name, category, tag,
                  tax_registration_no,
                  bank_name, bank_account, invoice_content, recipient,
                  recipient_phone, mailing_address
                )
                VALUES (
                  %s, %s, %s, %s, %s, %s, %s,
                  %s, %s, %s, %s,
                  %s, %s
                )
                RETURNING *
                """,
                [
                    str(uuid4()),
                    key,
                    clean["name"],
                    clean["short_name"],
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
                  short_name = %s,
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
                    clean["short_name"],
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
        _ensure_reconciliation_links_table(conn)
        linked_count = int(
            conn.execute(
                """
                SELECT COUNT(*)
                FROM cf_reconciliation_partner_links
                WHERE partner_id = %s
                """,
                [partner_id],
            ).fetchone()["count"]
            or 0
        )
        if linked_count:
            raise HTTPException(
                status_code=409,
                detail=f"该客户已关联 {linked_count} 张研发账单，请先调整账单合作方",
            )
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


@app.get("/api/contracts/health")
def contract_health() -> dict:
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_contracts_table(conn)
        row = conn.execute(
            """
            SELECT
              COUNT(*) AS count,
              COUNT(*) FILTER (WHERE partner_id IS NOT NULL) AS linked_count,
              COUNT(DISTINCT NULLIF(contract_no, '')) AS numbered_count
            FROM cf_contract_records
            """
        ).fetchone()
        conn.commit()
    return {
        "status": "ok",
        "storage": "postgres",
        "count": int(row["count"] or 0),
        "linked_count": int(row["linked_count"] or 0),
        "numbered_count": int(row["numbered_count"] or 0),
    }


@app.get("/api/contracts")
async def list_contracts(
    request: Request,
    q: str | None = Query(None),
    contract_type: str | None = Query(None),
    payment_type: str | None = Query(None),
    timeline_status: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict:
    await _require_authenticated(request)
    filters: list[str] = []
    params: list[object] = []
    if q and q.strip():
        term = f"%{q.strip()}%"
        filters.append(
            """
            (
              contract.contract_name ILIKE %s
              OR contract.counterparty ILIKE %s
              OR contract.contract_no ILIKE %s
              OR partner.short_name ILIKE %s
              OR contract.attachments::text ILIKE %s
            )
            """
        )
        params.extend([term, term, term, term, term])
    if contract_type and contract_type.strip():
        filters.append("contract.contract_type = %s")
        params.append(contract_type.strip())
    if payment_type and payment_type.strip():
        filters.append("contract.payment_type = %s")
        params.append(payment_type.strip())
    if timeline_status == "已过期":
        filters.append("contract.end_date < CURRENT_DATE")
    elif timeline_status == "即将到期":
        filters.append(
            "contract.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'"
        )
    elif timeline_status == "待生效":
        filters.append("contract.effective_date > CURRENT_DATE")
    elif timeline_status == "生效中":
        filters.append(
            """
            (contract.effective_date IS NULL OR contract.effective_date <= CURRENT_DATE)
            AND (contract.end_date IS NULL OR contract.end_date > CURRENT_DATE + INTERVAL '30 days')
            """
        )
    elif timeline_status == "未关联客户":
        filters.append("contract.partner_id IS NULL")
    elif timeline_status == "编号重复":
        filters.append(
            """
            contract.contract_no <> ''
            AND EXISTS (
              SELECT 1
              FROM cf_contract_records AS duplicate
              WHERE duplicate.contract_no = contract.contract_no
                AND duplicate.id <> contract.id
            )
            """
        )
    where = f"WHERE {' AND '.join(filters)}" if filters else ""

    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_contracts_table(conn)
        _relink_contract_partners(conn)
        total = int(
            conn.execute(
                f"""
                SELECT COUNT(*) AS count
                FROM cf_contract_records AS contract
                LEFT JOIN cf_partner_records AS partner ON partner.id = contract.partner_id
                {where}
                """,
                params,
            ).fetchone()["count"]
            or 0
        )
        rows = conn.execute(
            f"""
            SELECT
              contract.*,
              partner.name AS partner_name,
              partner.short_name AS partner_short_name,
              CASE
                WHEN contract.contract_no <> '' THEN (
                  SELECT COUNT(*)
                  FROM cf_contract_records AS duplicate
                  WHERE duplicate.contract_no = contract.contract_no
                )
                ELSE 0
              END AS contract_no_count
            FROM cf_contract_records AS contract
            LEFT JOIN cf_partner_records AS partner ON partner.id = contract.partner_id
            {where}
            ORDER BY contract.end_date DESC NULLS LAST, contract.created_at DESC
            LIMIT %s OFFSET %s
            """,
            [*params, limit, offset],
        ).fetchall()
        summary = conn.execute(
            """
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE partner_id IS NOT NULL) AS linked,
              COUNT(*) FILTER (
                WHERE end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
              ) AS expiring_30,
              COUNT(*) FILTER (WHERE end_date < CURRENT_DATE) AS expired,
              COALESCE(SUM(amount), 0) AS amount_total
            FROM cf_contract_records
            """
        ).fetchone()
        conn.commit()
    return {
        "items": [_contract_row(row) for row in rows],
        "total": total,
        "summary": {
            "total": int(summary["total"] or 0),
            "linked": int(summary["linked"] or 0),
            "expiring_30": int(summary["expiring_30"] or 0),
            "expired": int(summary["expired"] or 0),
            "amount_total": str(summary["amount_total"] or Decimal("0")),
        },
    }


def _import_contract_items(payload: dict) -> dict:
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        raise HTTPException(status_code=422, detail="合同数据格式无效")

    created = 0
    updated = 0
    skipped = 0
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_contracts_table(conn)
        for raw in raw_items[:1000]:
            if not isinstance(raw, dict):
                skipped += 1
                continue
            clean = _contract_payload(raw, require_name=False)
            if not clean["contract_name"]:
                skipped += 1
                continue
            _, was_created = _upsert_contract(conn, clean, source="wps")
            if was_created:
                created += 1
            else:
                updated += 1
        _relink_contract_partners(conn)
        totals = conn.execute(
            """
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE partner_id IS NOT NULL) AS linked,
              COUNT(*) FILTER (WHERE partner_id IS NULL) AS unlinked
            FROM cf_contract_records
            """
        ).fetchone()
        duplicate_numbers = conn.execute(
            """
            SELECT contract_no, COUNT(*) AS count
            FROM cf_contract_records
            WHERE contract_no <> ''
            GROUP BY contract_no
            HAVING COUNT(*) > 1
            ORDER BY count DESC, contract_no
            """
        ).fetchall()
        conn.commit()
    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "total": int(totals["total"] or 0),
        "linked": int(totals["linked"] or 0),
        "unlinked": int(totals["unlinked"] or 0),
        "duplicate_contract_numbers": [
            {"contract_no": row["contract_no"], "count": int(row["count"])}
            for row in duplicate_numbers
        ],
    }


@app.post("/api/contracts/import")
async def import_contracts(request: Request, payload: dict) -> dict:
    await _require_authenticated(request)
    return _import_contract_items(payload)


@app.post("/api/contracts/relink")
async def relink_contracts(request: Request) -> dict:
    await _require_authenticated(request)
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_contracts_table(conn)
        updated = _relink_contract_partners(conn)
        linked = int(
            conn.execute(
                "SELECT COUNT(*) AS count FROM cf_contract_records WHERE partner_id IS NOT NULL"
            ).fetchone()["count"]
            or 0
        )
        conn.commit()
    return {"updated": updated, "linked": linked}


@app.post("/api/contracts", status_code=201)
async def create_contract(request: Request, payload: dict) -> dict:
    await _require_authenticated(request)
    clean = _contract_payload(payload)
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_contracts_table(conn)
        row, _ = _upsert_contract(conn, clean, source="manual")
        conn.commit()
    return _contract_row(row)


@app.put("/api/contracts/{contract_id}")
async def update_contract(contract_id: str, request: Request, payload: dict) -> dict:
    await _require_authenticated(request)
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_contracts_table(conn)
        current = conn.execute(
            "SELECT * FROM cf_contract_records WHERE id = %s",
            [contract_id],
        ).fetchone()
        if current is None:
            raise HTTPException(status_code=404, detail="合同不存在")
        merged = {
            field: payload[field] if field in payload else current.get(field)
            for field in CONTRACT_FIELDS
        }
        clean = _contract_payload(merged)
        partner = _resolve_contract_partner(conn, clean["counterparty"])
        source_key = _contract_source_key(clean)
        try:
            row = conn.execute(
                """
                UPDATE cf_contract_records SET
                  source_key = %s,
                  contract_name = %s,
                  contract_type = %s,
                  amount = %s,
                  counterparty = %s,
                  normalized_counterparty = %s,
                  contract_no = %s,
                  signing_date = %s,
                  signing_status = %s,
                  effective_date = %s,
                  end_date = %s,
                  performance_status = %s,
                  payment_type = %s,
                  attachments = %s,
                  partner_id = %s,
                  updated_at = NOW()
                WHERE id = %s
                RETURNING *
                """,
                [
                    source_key,
                    clean["contract_name"],
                    clean["contract_type"],
                    clean["amount"],
                    clean["counterparty"],
                    _partner_name_key(clean["counterparty"]),
                    clean["contract_no"],
                    clean["signing_date"],
                    clean["signing_status"],
                    clean["effective_date"],
                    clean["end_date"],
                    clean["performance_status"],
                    clean["payment_type"],
                    Jsonb(clean["attachments"]),
                    partner["id"] if partner else None,
                    contract_id,
                ],
            ).fetchone()
            duplicate_count = conn.execute(
                """
                SELECT COUNT(*) AS count
                FROM cf_contract_records
                WHERE contract_no = %s AND contract_no <> ''
                """,
                [row["contract_no"]],
            ).fetchone()
            conn.commit()
        except psycopg.errors.UniqueViolation as exc:
            raise HTTPException(status_code=409, detail="相同合同已存在") from exc
    row["partner_name"] = partner["name"] if partner else None
    row["partner_short_name"] = partner["short_name"] if partner else None
    row["contract_no_count"] = int(duplicate_count["count"] or 0)
    return _contract_row(row)


@app.delete("/api/contracts/{contract_id}", status_code=204)
async def delete_contract(contract_id: str, request: Request) -> Response:
    await _require_authenticated(request)
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_contracts_table(conn)
        row = conn.execute(
            "DELETE FROM cf_contract_records WHERE id = %s RETURNING id",
            [contract_id],
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="合同不存在")
        conn.commit()
    return Response(status_code=204)


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


@app.get("/api/reconciliation-links/health")
async def reconciliation_links_health() -> dict:
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_partners_table(conn)
        _ensure_reconciliation_links_table(conn)
        row = conn.execute(
            """
            SELECT
              COUNT(*) AS linked_count,
              COUNT(DISTINCT partner_id) AS distinct_partner_count,
              COUNT(*) FILTER (WHERE match_method = 'selected') AS selected_count,
              COUNT(*) FILTER (WHERE match_method = 'exact_name') AS exact_name_count
            FROM cf_reconciliation_partner_links
            """
        ).fetchone()
        conn.commit()
    return {
        "status": "ok",
        "storage": "postgres",
        "linked_count": int(row["linked_count"] or 0),
        "distinct_partner_count": int(row["distinct_partner_count"] or 0),
        "selected_count": int(row["selected_count"] or 0),
        "exact_name_count": int(row["exact_name_count"] or 0),
    }


@app.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy(request: Request, path: str) -> Response:
    url = f"{UPSTREAM_ORIGIN}{request.url.path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    body = await request.body()
    outgoing_body = body
    reconciliation_match = RECONCILIATION_PATH_PATTERN.fullmatch(request.url.path)
    selected_partner_id = None
    selected_partner_name = None
    if (
        reconciliation_match
        and request.method in {"POST", "PUT", "PATCH"}
        and "application/json" in request.headers.get("content-type", "")
    ):
        try:
            outgoing_payload = json.loads(body or b"{}")
        except (TypeError, ValueError):
            outgoing_payload = None
        if isinstance(outgoing_payload, dict):
            selected_partner_id = outgoing_payload.pop("partner_id", None)
            selected_partner_name = outgoing_payload.get("partner_name")
            if _clean_partner_value(selected_partner_id, limit=200):
                with psycopg.connect(
                    _database_url(),
                    connect_timeout=15,
                    row_factory=dict_row,
                ) as conn:
                    _ensure_partners_table(conn)
                    selected_partner = _resolve_reconciliation_partner(
                        conn,
                        partner_id=selected_partner_id,
                    )
                    if selected_partner is None:
                        raise HTTPException(
                            status_code=422,
                            detail="所选客户不存在，请刷新客户库后重试",
                        )
                    outgoing_payload["partner_name"] = selected_partner["name"]
                    selected_partner_name = selected_partner["name"]
            outgoing_body = json.dumps(
                outgoing_payload,
                ensure_ascii=False,
            ).encode("utf-8")

    async with httpx.AsyncClient(follow_redirects=False, timeout=60.0) as client:
        upstream = await client.request(
            request.method,
            url,
            headers=_request_headers(request),
            content=outgoing_body,
        )

    response_content = upstream.content
    if reconciliation_match and 200 <= upstream.status_code < 300 and request.method != "DELETE":
        try:
            payload = upstream.json()
            if (
                request.method in {"PUT", "PATCH"}
                and reconciliation_match.group(1)
                and not _reconciliation_rows(payload)
            ):
                _sync_reconciliation_partner_links(
                    {
                        "id": reconciliation_match.group(1),
                        "partner_name": selected_partner_name,
                    },
                    selected_partner_id=selected_partner_id,
                    selected_snapshot=selected_partner_name,
                )
            else:
                payload = _sync_reconciliation_partner_links(
                    payload,
                    selected_partner_id=selected_partner_id,
                    selected_snapshot=selected_partner_name,
                )
            response_content = json.dumps(
                payload,
                ensure_ascii=False,
                default=str,
            ).encode("utf-8")
            items = payload.get("items") if isinstance(payload, dict) else None
            print(
                "[reconciliation-proxy] response summary",
                {
                    "status": upstream.status_code,
                    "total": payload.get("total") if isinstance(payload, dict) else None,
                    "item_count": len(items) if isinstance(items, list) else None,
                    "linked_count": sum(
                        1 for item in (items or []) if item.get("partner_id")
                    ),
                },
            )
        except ValueError:
            print(
                "[reconciliation-proxy] non-json response",
                {"status": upstream.status_code, "bytes": len(upstream.content)},
            )
    elif (
        reconciliation_match
        and request.method == "DELETE"
        and 200 <= upstream.status_code < 300
        and reconciliation_match.group(1)
    ):
        with psycopg.connect(_database_url(), connect_timeout=15) as conn:
            _ensure_partners_table(conn)
            _ensure_reconciliation_links_table(conn)
            conn.execute(
                """
                DELETE FROM cf_reconciliation_partner_links
                WHERE reconciliation_id = %s
                """,
                [reconciliation_match.group(1)],
            )
            conn.commit()

    result = Response(
        content=response_content,
        status_code=upstream.status_code,
        headers=_response_headers(upstream),
        media_type=None,
    )
    for cookie in upstream.headers.get_list("set-cookie"):
        result.headers.append("set-cookie", _host_cookie(cookie))
    return result
