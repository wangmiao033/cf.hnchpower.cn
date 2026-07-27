"""Vercel data service for contracts, partners, and QuickSDK records."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
from pathlib import PurePath
from datetime import date
from decimal import Decimal, InvalidOperation
from urllib.parse import quote, unquote
from uuid import uuid4

import httpx
import jwt
import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

app = FastAPI(title="caiwu-data-service", docs_url=None, redoc_url=None)

QUICKSDK_DATABASE_URL = os.environ.get("QUICKSDK_DATABASE_URL", "").strip()
AUTH_JWT_SECRET = os.environ.get("AUTH_JWT_SECRET", "").strip()
BLOB_READ_WRITE_TOKEN = os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip()
BLOB_API_ORIGIN = "https://vercel.com/api/blob"
CONTRACT_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
CONTRACT_ATTACHMENT_EXTENSIONS = {
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".wps",
    ".et",
    ".ofd",
    ".txt",
    ".jpg",
    ".jpeg",
    ".png",
    ".zip",
    ".rar",
    ".7z",
}

async def _require_authenticated(request: Request) -> str:
    """Validate the shared session directly without the legacy server."""
    cookie = request.headers.get("cookie", "")
    token = request.cookies.get("caiwu_session", "").strip()
    if not token or not AUTH_JWT_SECRET:
        raise HTTPException(status_code=401, detail="请先登录")
    try:
        payload = jwt.decode(token, AUTH_JWT_SECRET, algorithms=["HS256"])
    except Exception as exc:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录") from exc
    user_id = str(payload.get("sub") or "")
    session_id = str(payload.get("sid") or "")
    token_jti = str(payload.get("jti") or "")
    if not user_id or not session_id or not token_jti:
        raise HTTPException(status_code=401, detail="请先登录")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        session = conn.execute(
            """
            SELECT session.id
            FROM auth_sessions AS session
            JOIN auth_users AS auth_user ON auth_user.id = session.user_id
            WHERE session.id = %s
              AND session.user_id = %s
              AND session.token_jti = %s
              AND session.revoked_at IS NULL
              AND session.expires_at > NOW()
              AND auth_user.is_active = TRUE
            """,
            [session_id, user_id, token_jti],
        ).fetchone()
    if session is None:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
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
CONTRACT_FIELDS = {
    "contract_name",
    "contract_type",
    "document_type",
    "platform_record_id",
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
CONTRACT_DOCUMENT_TYPES = {"master", "supplement", "transfer", "other"}
CONTRACT_ACCESS_FIELDS = {
    "channel_name",
    "agreement_type",
    "platform_record_id",
    "product_name",
    "app_id",
    "platform",
    "language",
    "category",
    "rights_source",
    "game_status",
    "agreement_status",
    "authorization_start",
    "authorization_end",
    "share_rate",
    "channel_fee_rate",
    "software_copyright_no",
    "isbn",
    "territory",
    "status",
    "remarks",
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
    """Recover customer data directly from the shared PostgreSQL database."""
    del cookie
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        reconciliation = conn.execute(
            "SELECT partner_name FROM reconciliation_records "
            "WHERE COALESCE(partner_name, '') <> ''"
        ).fetchall()
        channels = conn.execute(
            "SELECT partner_name FROM channel_records "
            "WHERE COALESCE(partner_name, '') <> ''"
        ).fetchall()
        invoices = conn.execute(
            "SELECT title, tax_no FROM invoice_records "
            "WHERE COALESCE(title, '') <> ''"
        ).fetchall()
        payments = conn.execute(
            "SELECT customer, recipient, remark FROM payment_records "
            "WHERE COALESCE(customer, '') <> ''"
        ).fetchall()

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
        partner = recovered.get(_partner_name_key(item.get("title")))
        tax_no = _clean_partner_value(item.get("tax_no"), limit=500)
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
    document_type = _clean_partner_value(raw.get("document_type"), limit=30) or "master"
    if document_type not in CONTRACT_DOCUMENT_TYPES:
        document_type = "other"
    payload = {
        "contract_name": _clean_partner_value(raw.get("contract_name"), limit=1000),
        "contract_type": _clean_partner_value(raw.get("contract_type"), limit=200),
        "document_type": document_type,
        "platform_record_id": _clean_partner_value(raw.get("platform_record_id"), limit=200),
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


def _clean_contract_percentage(value: object) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        cleaned = Decimal(str(value).replace("%", "").replace(",", "").strip())
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(status_code=422, detail="比例必须是有效数字") from exc
    if cleaned < 0 or cleaned > 100:
        raise HTTPException(status_code=422, detail="比例必须在 0 到 100 之间")
    return cleaned.quantize(Decimal("0.01"))


def _contract_access_payload(raw: dict) -> dict:
    payload = {
        "channel_name": _clean_partner_value(raw.get("channel_name"), limit=200),
        "agreement_type": _clean_partner_value(raw.get("agreement_type"), limit=200),
        "platform_record_id": _clean_partner_value(raw.get("platform_record_id"), limit=200),
        "product_name": _clean_partner_value(raw.get("product_name"), limit=1000),
        "app_id": _clean_partner_value(raw.get("app_id"), limit=200),
        "platform": _clean_partner_value(raw.get("platform"), limit=100),
        "language": _clean_partner_value(raw.get("language"), limit=100),
        "category": _clean_partner_value(raw.get("category"), limit=100),
        "rights_source": _clean_partner_value(raw.get("rights_source"), limit=200),
        "game_status": _clean_partner_value(raw.get("game_status"), limit=100),
        "agreement_status": _clean_partner_value(raw.get("agreement_status"), limit=100),
        "authorization_start": _clean_contract_date(raw.get("authorization_start")),
        "authorization_end": _clean_contract_date(raw.get("authorization_end")),
        "share_rate": _clean_contract_percentage(raw.get("share_rate")),
        "channel_fee_rate": _clean_contract_percentage(raw.get("channel_fee_rate")),
        "software_copyright_no": _clean_partner_value(
            raw.get("software_copyright_no"), limit=300
        ),
        "isbn": _clean_partner_value(raw.get("isbn"), limit=300),
        "territory": _clean_partner_value(raw.get("territory"), limit=500),
        "status": _clean_partner_value(raw.get("status"), limit=100) or "生效",
        "remarks": _clean_partner_value(raw.get("remarks"), limit=2000),
    }
    if not payload["product_name"]:
        raise HTTPException(status_code=422, detail="请填写接入游戏名称")
    if (
        payload["authorization_start"]
        and payload["authorization_end"]
        and payload["authorization_start"] > payload["authorization_end"]
    ):
        raise HTTPException(status_code=422, detail="授权开始日期不能晚于结束日期")
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
          document_type TEXT NOT NULL DEFAULT 'master',
          platform_record_id TEXT NOT NULL DEFAULT '',
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
        ALTER TABLE cf_contract_records
          ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'master',
          ADD COLUMN IF NOT EXISTS platform_record_id TEXT NOT NULL DEFAULT ''
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_contract_attachment_files (
          id TEXT PRIMARY KEY,
          contract_id TEXT NOT NULL REFERENCES cf_contract_records(id) ON DELETE CASCADE,
          expected_name TEXT NOT NULL DEFAULT '',
          file_name TEXT NOT NULL,
          blob_url TEXT NOT NULL,
          blob_pathname TEXT NOT NULL,
          content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
          size_bytes BIGINT NOT NULL DEFAULT 0,
          checksum_sha256 TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'manual',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_contract_attachment_files_contract
        ON cf_contract_attachment_files (contract_id, created_at)
        """
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_contract_attachment_files_dedupe
        ON cf_contract_attachment_files (contract_id, checksum_sha256)
        WHERE checksum_sha256 <> ''
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_contract_access_items (
          id TEXT PRIMARY KEY,
          contract_id TEXT NOT NULL REFERENCES cf_contract_records(id) ON DELETE CASCADE,
          channel_name TEXT NOT NULL DEFAULT '',
          agreement_type TEXT NOT NULL DEFAULT '',
          platform_record_id TEXT NOT NULL DEFAULT '',
          product_name TEXT NOT NULL,
          app_id TEXT NOT NULL DEFAULT '',
          platform TEXT NOT NULL DEFAULT '',
          language TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT '',
          rights_source TEXT NOT NULL DEFAULT '',
          game_status TEXT NOT NULL DEFAULT '',
          agreement_status TEXT NOT NULL DEFAULT '',
          authorization_start DATE NULL,
          authorization_end DATE NULL,
          share_rate NUMERIC(7, 2) NULL,
          channel_fee_rate NUMERIC(7, 2) NULL,
          software_copyright_no TEXT NOT NULL DEFAULT '',
          isbn TEXT NOT NULL DEFAULT '',
          territory TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '生效',
          remarks TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    conn.execute(
        """
        ALTER TABLE cf_contract_access_items
          ADD COLUMN IF NOT EXISTS channel_name TEXT NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS agreement_type TEXT NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS game_status TEXT NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS agreement_status TEXT NOT NULL DEFAULT ''
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_contract_access_items_contract
        ON cf_contract_access_items (contract_id, authorization_end, created_at)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_contract_access_items_product
        ON cf_contract_access_items (product_name)
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


def _contract_attachment_public_row(row: dict) -> dict:
    contract_id = str(row["contract_id"])
    attachment_id = str(row["id"])
    base_url = (
        f"/api/contracts/{quote(contract_id, safe='')}/attachments/"
        f"{quote(attachment_id, safe='')}"
    )
    return {
        "id": attachment_id,
        "expected_name": row.get("expected_name") or "",
        "file_name": row.get("file_name") or "",
        "content_type": row.get("content_type") or "application/octet-stream",
        "size_bytes": int(row.get("size_bytes") or 0),
        "source": row.get("source") or "manual",
        "preview_url": base_url,
        "download_url": f"{base_url}?download=1",
        "created_at": row["created_at"].isoformat(),
    }


def _contract_access_timeline_status(row: dict) -> str:
    today = date.today()
    start_date = row.get("authorization_start")
    end_date = row.get("authorization_end")
    if row.get("status") in {"已终止", "终止"}:
        return "已终止"
    if start_date and start_date > today:
        return "待生效"
    if end_date and end_date < today:
        return "已过期"
    if end_date and 0 <= (end_date - today).days <= 30:
        return "即将到期"
    return "生效中"


def _contract_access_row(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "contract_id": str(row["contract_id"]),
        "channel_name": row.get("channel_name") or "",
        "agreement_type": row.get("agreement_type") or "",
        "platform_record_id": row.get("platform_record_id") or "",
        "product_name": row.get("product_name") or "",
        "app_id": row.get("app_id") or "",
        "platform": row.get("platform") or "",
        "language": row.get("language") or "",
        "category": row.get("category") or "",
        "rights_source": row.get("rights_source") or "",
        "game_status": row.get("game_status") or "",
        "agreement_status": row.get("agreement_status") or "",
        "authorization_start": (
            row["authorization_start"].isoformat() if row.get("authorization_start") else None
        ),
        "authorization_end": (
            row["authorization_end"].isoformat() if row.get("authorization_end") else None
        ),
        "share_rate": str(row["share_rate"]) if row.get("share_rate") is not None else None,
        "channel_fee_rate": (
            str(row["channel_fee_rate"]) if row.get("channel_fee_rate") is not None else None
        ),
        "software_copyright_no": row.get("software_copyright_no") or "",
        "isbn": row.get("isbn") or "",
        "territory": row.get("territory") or "",
        "status": row.get("status") or "",
        "remarks": row.get("remarks") or "",
        "timeline_status": _contract_access_timeline_status(row),
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }


def _attach_contract_files(conn: psycopg.Connection, rows: list[dict]) -> None:
    contract_ids = [str(row["id"]) for row in rows]
    files_by_contract: dict[str, list[dict]] = {contract_id: [] for contract_id in contract_ids}
    if contract_ids:
        attachment_rows = conn.execute(
            """
            SELECT *
            FROM cf_contract_attachment_files
            WHERE contract_id = ANY(%s)
            ORDER BY created_at, file_name
            """,
            [contract_ids],
        ).fetchall()
        for attachment in attachment_rows:
            files_by_contract.setdefault(str(attachment["contract_id"]), []).append(
                _contract_attachment_public_row(attachment)
            )
    for row in rows:
        row["attachment_files"] = files_by_contract.get(str(row["id"]), [])


def _attach_contract_access_items(conn: psycopg.Connection, rows: list[dict]) -> None:
    contract_ids = [str(row["id"]) for row in rows]
    items_by_contract: dict[str, list[dict]] = {
        contract_id: [] for contract_id in contract_ids
    }
    if contract_ids:
        access_rows = conn.execute(
            """
            SELECT *
            FROM cf_contract_access_items
            WHERE contract_id = ANY(%s)
            ORDER BY authorization_end DESC NULLS LAST, created_at
            """,
            [contract_ids],
        ).fetchall()
        for access_item in access_rows:
            items_by_contract.setdefault(str(access_item["contract_id"]), []).append(
                _contract_access_row(access_item)
            )
    for row in rows:
        row["access_items"] = items_by_contract.get(str(row["id"]), [])


def _load_contract_with_relations(conn: psycopg.Connection, contract_id: str) -> dict | None:
    row = conn.execute(
        """
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
        WHERE contract.id = %s
        """,
        [contract_id],
    ).fetchone()
    if row is not None:
        _attach_contract_files(conn, [row])
        _attach_contract_access_items(conn, [row])
    return row


def _contract_row(row: dict) -> dict:
    return {
        "id": row["id"],
        "source": row["source"],
        "contract_name": row["contract_name"],
        "contract_type": row["contract_type"],
        "document_type": row.get("document_type") or "master",
        "platform_record_id": row.get("platform_record_id") or "",
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
        "attachment_files": (
            row["attachment_files"] if isinstance(row.get("attachment_files"), list) else []
        ),
        "access_items": (
            row["access_items"] if isinstance(row.get("access_items"), list) else []
        ),
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
          id, source, source_key, contract_name, contract_type, document_type,
          platform_record_id, amount,
          counterparty, normalized_counterparty, contract_no,
          signing_date, signing_status, effective_date, end_date,
          performance_status, payment_type, attachments, partner_id
        )
        VALUES (
          %s, %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s,
          %s, %s, %s, %s,
          %s, %s, %s, %s
        )
        ON CONFLICT (source_key) DO UPDATE SET
          source = EXCLUDED.source,
          contract_name = EXCLUDED.contract_name,
          contract_type = EXCLUDED.contract_type,
          document_type = EXCLUDED.document_type,
          platform_record_id = EXCLUDED.platform_record_id,
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
            payload["document_type"],
            payload["platform_record_id"],
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
        attachment_count = conn.execute(
            "SELECT COUNT(*) AS count FROM cf_contract_attachment_files"
        ).fetchone()
        access_count = conn.execute(
            "SELECT COUNT(*) AS count FROM cf_contract_access_items"
        ).fetchone()
        conn.commit()
    return {
        "status": "ok",
        "storage": "postgres",
        "attachment_storage": "vercel-blob-private" if BLOB_READ_WRITE_TOKEN else "not-configured",
        "count": int(row["count"] or 0),
        "linked_count": int(row["linked_count"] or 0),
        "numbered_count": int(row["numbered_count"] or 0),
        "attachment_count": int(attachment_count["count"] or 0),
        "access_item_count": int(access_count["count"] or 0),
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
        _attach_contract_files(conn, rows)
        _attach_contract_access_items(conn, rows)
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
        access_summary = conn.execute(
            """
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (
                WHERE authorization_end BETWEEN CURRENT_DATE
                  AND CURRENT_DATE + INTERVAL '30 days'
              ) AS expiring_30,
              COUNT(*) FILTER (WHERE authorization_end < CURRENT_DATE) AS expired
            FROM cf_contract_access_items
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
            "access_item_total": int(access_summary["total"] or 0),
            "access_expiring_30": int(access_summary["expiring_30"] or 0),
            "access_expired": int(access_summary["expired"] or 0),
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
        row = _load_contract_with_relations(conn, str(row["id"]))
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
                  document_type = %s,
                  platform_record_id = %s,
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
                    clean["document_type"],
                    clean["platform_record_id"],
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
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_contracts_table(conn)
        row = _load_contract_with_relations(conn, contract_id)
        conn.commit()
    return _contract_row(row)


@app.post("/api/contracts/{contract_id}/access-items", status_code=201)
async def create_contract_access_item(
    contract_id: str, request: Request, payload: dict
) -> dict:
    await _require_authenticated(request)
    clean = _contract_access_payload(payload)
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_contracts_table(conn)
        contract = conn.execute(
            "SELECT id FROM cf_contract_records WHERE id = %s",
            [contract_id],
        ).fetchone()
        if contract is None:
            raise HTTPException(status_code=404, detail="主合同不存在")
        row = conn.execute(
            """
            INSERT INTO cf_contract_access_items (
              id, contract_id, channel_name, agreement_type, platform_record_id,
              product_name, app_id, platform, language, category, rights_source,
              game_status, agreement_status, authorization_start, authorization_end,
              share_rate, channel_fee_rate, software_copyright_no, isbn,
              territory, status, remarks
            )
            VALUES (
              %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s,
              %s, %s, %s, %s,
              %s, %s, %s
            )
            RETURNING *
            """,
            [
                str(uuid4()),
                contract_id,
                clean["channel_name"],
                clean["agreement_type"],
                clean["platform_record_id"],
                clean["product_name"],
                clean["app_id"],
                clean["platform"],
                clean["language"],
                clean["category"],
                clean["rights_source"],
                clean["game_status"],
                clean["agreement_status"],
                clean["authorization_start"],
                clean["authorization_end"],
                clean["share_rate"],
                clean["channel_fee_rate"],
                clean["software_copyright_no"],
                clean["isbn"],
                clean["territory"],
                clean["status"],
                clean["remarks"],
            ],
        ).fetchone()
        conn.commit()
    return _contract_access_row(row)


@app.put("/api/contracts/{contract_id}/access-items/{item_id}")
async def update_contract_access_item(
    contract_id: str, item_id: str, request: Request, payload: dict
) -> dict:
    await _require_authenticated(request)
    clean = _contract_access_payload(payload)
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_contracts_table(conn)
        row = conn.execute(
            """
            UPDATE cf_contract_access_items SET
              channel_name = %s,
              agreement_type = %s,
              platform_record_id = %s,
              product_name = %s,
              app_id = %s,
              platform = %s,
              language = %s,
              category = %s,
              rights_source = %s,
              game_status = %s,
              agreement_status = %s,
              authorization_start = %s,
              authorization_end = %s,
              share_rate = %s,
              channel_fee_rate = %s,
              software_copyright_no = %s,
              isbn = %s,
              territory = %s,
              status = %s,
              remarks = %s,
              updated_at = NOW()
            WHERE id = %s AND contract_id = %s
            RETURNING *
            """,
            [
                clean["channel_name"],
                clean["agreement_type"],
                clean["platform_record_id"],
                clean["product_name"],
                clean["app_id"],
                clean["platform"],
                clean["language"],
                clean["category"],
                clean["rights_source"],
                clean["game_status"],
                clean["agreement_status"],
                clean["authorization_start"],
                clean["authorization_end"],
                clean["share_rate"],
                clean["channel_fee_rate"],
                clean["software_copyright_no"],
                clean["isbn"],
                clean["territory"],
                clean["status"],
                clean["remarks"],
                item_id,
                contract_id,
            ],
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="游戏接入清单不存在")
        conn.commit()
    return _contract_access_row(row)


@app.delete(
    "/api/contracts/{contract_id}/access-items/{item_id}",
    status_code=204,
)
async def delete_contract_access_item(
    contract_id: str, item_id: str, request: Request
) -> Response:
    await _require_authenticated(request)
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_contracts_table(conn)
        row = conn.execute(
            """
            DELETE FROM cf_contract_access_items
            WHERE id = %s AND contract_id = %s
            RETURNING id
            """,
            [item_id, contract_id],
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="游戏接入清单不存在")
        conn.commit()
    return Response(status_code=204)


def _blob_headers(*, content_type: str | None = None) -> dict[str, str]:
    if not BLOB_READ_WRITE_TOKEN:
        raise HTTPException(status_code=503, detail="合同附件私有存储尚未配置")
    headers = {
        "authorization": f"Bearer {BLOB_READ_WRITE_TOKEN}",
        "x-api-version": "12",
        "x-api-blob-request-id": f"contract:{uuid4().hex}",
        "x-api-blob-request-attempt": "0",
    }
    if content_type:
        headers.update(
            {
                "x-vercel-blob-access": "private",
                "x-content-type": content_type,
                "x-add-random-suffix": "0",
                "x-allow-overwrite": "0",
            }
        )
    return headers


def _contract_attachment_name(request: Request, header_name: str) -> str:
    raw_value = request.headers.get(header_name, "")
    try:
        value = unquote(raw_value)
    except (TypeError, ValueError):
        value = raw_value
    return PurePath(value.replace("\\", "/")).name.strip()[:500]


@app.post("/api/contracts/{contract_id}/attachments", status_code=201)
async def upload_contract_attachment(contract_id: str, request: Request) -> dict:
    await _require_authenticated(request)
    file_name = _contract_attachment_name(request, "x-file-name")
    expected_name = _contract_attachment_name(request, "x-expected-name")
    if not file_name:
        raise HTTPException(status_code=422, detail="附件文件名不能为空")
    extension = PurePath(file_name).suffix.lower()
    if extension not in CONTRACT_ATTACHMENT_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"暂不支持 {extension or '无后缀'} 文件")
    content_length = int(request.headers.get("content-length") or 0)
    if content_length > CONTRACT_ATTACHMENT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="单个附件不能超过 50MB")
    body = await request.body()
    if not body:
        raise HTTPException(status_code=422, detail="附件内容为空")
    if len(body) > CONTRACT_ATTACHMENT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="单个附件不能超过 50MB")

    checksum = hashlib.sha256(body).hexdigest()
    content_type = (
        request.headers.get("content-type", "").split(";", 1)[0].strip()
        or mimetypes.guess_type(file_name)[0]
        or "application/octet-stream"
    )

    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_contracts_table(conn)
        contract = conn.execute(
            "SELECT id, attachments FROM cf_contract_records WHERE id = %s",
            [contract_id],
        ).fetchone()
        if contract is None:
            raise HTTPException(status_code=404, detail="合同不存在")
        existing = conn.execute(
            """
            SELECT *
            FROM cf_contract_attachment_files
            WHERE contract_id = %s AND checksum_sha256 = %s
            """,
            [contract_id, checksum],
        ).fetchone()
        if existing is not None:
            if expected_name and expected_name != existing["expected_name"]:
                existing = conn.execute(
                    """
                    UPDATE cf_contract_attachment_files
                    SET expected_name = %s
                    WHERE id = %s
                    RETURNING *
                    """,
                    [expected_name, existing["id"]],
                ).fetchone()
            full_contract = _load_contract_with_relations(conn, contract_id)
            conn.commit()
            return {
                "contract": _contract_row(full_contract),
                "attachment": _contract_attachment_public_row(existing),
                "deduplicated": True,
            }

    attachment_id = str(uuid4())
    safe_extension = extension if extension in CONTRACT_ATTACHMENT_EXTENSIONS else ""
    pathname = f"contracts/{contract_id}/{attachment_id}{safe_extension}"
    blob_headers = _blob_headers(content_type=content_type)
    async with httpx.AsyncClient(timeout=120.0) as client:
        blob_response = await client.put(
            f"{BLOB_API_ORIGIN}/",
            params={"pathname": pathname},
            headers=blob_headers,
            content=body,
        )
    if not blob_response.is_success:
        raise HTTPException(status_code=502, detail="附件上传到私有存储失败")
    blob = blob_response.json()

    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_contracts_table(conn)
        row = conn.execute(
            """
            INSERT INTO cf_contract_attachment_files (
              id, contract_id, expected_name, file_name, blob_url, blob_pathname,
              content_type, size_bytes, checksum_sha256, source
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            [
                attachment_id,
                contract_id,
                expected_name or file_name,
                file_name,
                blob["url"],
                blob["pathname"],
                blob.get("contentType") or content_type,
                len(body),
                checksum,
                "wps" if expected_name else "manual",
            ],
        ).fetchone()
        full_contract = _load_contract_with_relations(conn, contract_id)
        conn.commit()
    return {
        "contract": _contract_row(full_contract),
        "attachment": _contract_attachment_public_row(row),
        "deduplicated": False,
    }


@app.get("/api/contracts/{contract_id}/attachments/{attachment_id}")
async def download_contract_attachment(
    contract_id: str,
    attachment_id: str,
    request: Request,
    download: bool = Query(False),
) -> StreamingResponse:
    await _require_authenticated(request)
    if not BLOB_READ_WRITE_TOKEN:
        raise HTTPException(status_code=503, detail="合同附件私有存储尚未配置")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _ensure_contracts_table(conn)
        attachment = conn.execute(
            """
            SELECT *
            FROM cf_contract_attachment_files
            WHERE id = %s AND contract_id = %s
            """,
            [attachment_id, contract_id],
        ).fetchone()
        conn.commit()
    if attachment is None:
        raise HTTPException(status_code=404, detail="附件不存在")

    client = httpx.AsyncClient(timeout=None)
    blob_request = client.build_request(
        "GET",
        attachment["blob_url"],
        headers={"authorization": f"Bearer {BLOB_READ_WRITE_TOKEN}"},
    )
    blob_response = await client.send(blob_request, stream=True)
    if not blob_response.is_success:
        await blob_response.aclose()
        await client.aclose()
        raise HTTPException(status_code=502, detail="附件读取失败")

    async def stream_blob():
        try:
            async for chunk in blob_response.aiter_bytes():
                yield chunk
        finally:
            await blob_response.aclose()
            await client.aclose()

    disposition = "attachment" if download else "inline"
    encoded_name = quote(attachment["file_name"], safe="")
    return StreamingResponse(
        stream_blob(),
        media_type=attachment["content_type"] or "application/octet-stream",
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{encoded_name}",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


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
    raise HTTPException(status_code=404, detail="该接口已迁移到 Vercel 核心服务")
