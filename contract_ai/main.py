"""扫描版合同智能识别与内部编号服务。"""

from __future__ import annotations

import base64
import os
from pathlib import PurePath

import httpx
import jwt
import psycopg
from fastapi import FastAPI, HTTPException, Request
from psycopg.rows import dict_row

try:
    from .extraction import CONTRACT_SCAN_SCHEMA, SYSTEM_PROMPT, normalize_contract_scan_result, parse_model_json
except ImportError:  # Vercel service root loads main.py as a top-level module.
    from extraction import CONTRACT_SCAN_SCHEMA, SYSTEM_PROMPT, normalize_contract_scan_result, parse_model_json

app = FastAPI(title="contract-smart-intake", docs_url=None, redoc_url=None)

DATABASE_URL = os.environ.get("QUICKSDK_DATABASE_URL", "").strip() or os.environ.get("DATABASE_URL", "").strip()
AUTH_JWT_SECRET = os.environ.get("AUTH_JWT_SECRET", "").strip()
AI_GATEWAY_API_KEY = os.environ.get("AI_GATEWAY_API_KEY", "").strip()
CONTRACT_SCAN_MODEL = os.environ.get("CONTRACT_SCAN_MODEL", "openai/gpt-5.4-mini").strip() or "openai/gpt-5.4-mini"
AI_GATEWAY_RESPONSES_URL = "https://ai-gateway.vercel.sh/v1/responses"
SCAN_MAX_BYTES = 4 * 1024 * 1024
SCAN_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}
ROLE_DEFAULT_CONTRACT_PERMISSIONS = {
    "admin": {"contracts.view": True, "contracts.manage": True},
    "finance": {"contracts.view": True, "contracts.manage": True},
    "operator": {"contracts.view": True, "contracts.manage": True},
    "user": {"contracts.view": True, "contracts.manage": True},
    "viewer": {"contracts.view": True, "contracts.manage": False},
}


def _database_url() -> str:
    if not DATABASE_URL:
        raise HTTPException(status_code=503, detail="合同智能识别数据库连接尚未配置")
    return DATABASE_URL


def _safe_filename(request: Request) -> str:
    raw = request.headers.get("x-file-name", "").strip()
    try:
        from urllib.parse import unquote

        raw = unquote(raw)
    except Exception:
        pass
    return PurePath(raw.replace("\\", "/")).name.strip()[:500]


def _gateway_token() -> str:
    """Use only trusted server-side credentials for Vercel AI Gateway.

    Vercel documents VERCEL_OIDC_TOKEN as the automatic credential for
    deployments with OIDC Federation enabled. Never accept an OIDC bearer
    token from the browser request headers: those headers are client-controlled
    and may also contain a token with a different audience.
    """
    return AI_GATEWAY_API_KEY or os.environ.get("VERCEL_OIDC_TOKEN", "").strip()


def _require_contract_permission(request: Request, permission: str) -> str:
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
        user = conn.execute(
            """
            SELECT auth_user.id, auth_user.role
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
        if user is None:
            raise HTTPException(status_code=401, detail="登录已失效，请重新登录")

        role = str(user.get("role") or "operator").strip().lower() or "operator"
        defaults = ROLE_DEFAULT_CONTRACT_PERMISSIONS.get(
            role,
            ROLE_DEFAULT_CONTRACT_PERMISSIONS["operator"],
        )
        allowed = bool(defaults.get(permission, False))
        try:
            override = conn.execute(
                """
                SELECT effect
                FROM auth_user_permission_overrides
                WHERE user_id = %s AND permission = %s
                """,
                [user_id, permission],
            ).fetchone()
        except psycopg.Error:
            override = None
        if role == "admin":
            allowed = True
        elif override is not None:
            allowed = str(override.get("effect") or "") == "allow"
        if not allowed:
            message = (
                "当前账号没有智能录入合同的权限"
                if permission == "contracts.manage"
                else "当前账号没有查看合同的权限"
            )
            raise HTTPException(status_code=403, detail=message)
    return user_id


def _require_contract_manage(request: Request) -> str:
    return _require_contract_permission(request, "contracts.manage")


def _request_payload(file_name: str, body: bytes) -> dict:
    encoded = base64.b64encode(body).decode("ascii")
    return {
        "model": CONTRACT_SCAN_MODEL,
        "store": False,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": SYSTEM_PROMPT},
                    {
                        "type": "input_file",
                        "filename": file_name,
                        "file_data": encoded,
                    },
                ],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "contract_smart_intake",
                "strict": True,
                "schema": CONTRACT_SCAN_SCHEMA,
            }
        },
    }


def format_internal_contract_no(number_month: str, sequence_no: int) -> str:
    month = str(number_month or "").strip()
    if len(month) != 6 or not month.isdigit():
        raise ValueError("内部合同编号月份必须是 YYYYMM")
    sequence = int(sequence_no)
    if sequence <= 0:
        raise ValueError("内部合同编号序号必须大于 0")
    return f"HT-{month}-{sequence:04d}"


def _ensure_internal_number_tables(conn: psycopg.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_contract_internal_numbers (
          contract_id TEXT PRIMARY KEY,
          internal_contract_no TEXT NOT NULL UNIQUE,
          number_month TEXT NOT NULL,
          sequence_no INTEGER NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (number_month, sequence_no)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_contract_number_sequences (
          number_month TEXT PRIMARY KEY,
          last_sequence INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


def _allocate_sequence(conn: psycopg.Connection, number_month: str) -> int:
    row = conn.execute(
        """
        INSERT INTO cf_contract_number_sequences (number_month, last_sequence)
        VALUES (%s, 1)
        ON CONFLICT (number_month) DO UPDATE SET
          last_sequence = cf_contract_number_sequences.last_sequence + 1,
          updated_at = NOW()
        RETURNING last_sequence
        """,
        [number_month],
    ).fetchone()
    return int(row["last_sequence"])


def _backfill_internal_contract_numbers(conn: psycopg.Connection) -> None:
    relation = conn.execute(
        "SELECT to_regclass('public.cf_contract_records') AS relation"
    ).fetchone()
    if relation is None or relation.get("relation") is None:
        return

    _ensure_internal_number_tables(conn)
    conn.execute(
        """
        DELETE FROM cf_contract_internal_numbers AS number
        WHERE NOT EXISTS (
          SELECT 1 FROM cf_contract_records AS contract WHERE contract.id = number.contract_id
        )
        """
    )
    missing = conn.execute(
        """
        SELECT
          contract.id,
          TO_CHAR(
            COALESCE(
              contract.signing_date,
              contract.effective_date,
              contract.created_at::date,
              CURRENT_DATE
            ),
            'YYYYMM'
          ) AS number_month
        FROM cf_contract_records AS contract
        LEFT JOIN cf_contract_internal_numbers AS number
          ON number.contract_id = contract.id
        WHERE number.contract_id IS NULL
        ORDER BY
          COALESCE(
            contract.signing_date,
            contract.effective_date,
            contract.created_at::date,
            CURRENT_DATE
          ),
          contract.created_at,
          contract.id
        """
    ).fetchall()
    for row in missing:
        month = str(row["number_month"])
        sequence = _allocate_sequence(conn, month)
        conn.execute(
            """
            INSERT INTO cf_contract_internal_numbers (
              contract_id, internal_contract_no, number_month, sequence_no
            )
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (contract_id) DO NOTHING
            """,
            [
                str(row["id"]),
                format_internal_contract_no(month, sequence),
                month,
                sequence,
            ],
        )


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "contract-smart-intake"}


@app.get("/api/contracts/internal-numbers")
async def list_internal_contract_numbers(request: Request) -> dict:
    _require_contract_permission(request, "contracts.view")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _backfill_internal_contract_numbers(conn)
        relation = conn.execute(
            "SELECT to_regclass('public.cf_contract_records') AS relation"
        ).fetchone()
        if relation is None or relation.get("relation") is None:
            conn.commit()
            return {"items": [], "total": 0}
        rows = conn.execute(
            """
            SELECT
              number.contract_id,
              number.internal_contract_no,
              number.number_month,
              number.sequence_no
            FROM cf_contract_internal_numbers AS number
            JOIN cf_contract_records AS contract ON contract.id = number.contract_id
            ORDER BY number.number_month DESC, number.sequence_no DESC
            """
        ).fetchall()
        conn.commit()
    return {
        "items": [
            {
                "contract_id": str(row["contract_id"]),
                "internal_contract_no": str(row["internal_contract_no"]),
                "number_month": str(row["number_month"]),
                "sequence_no": int(row["sequence_no"]),
            }
            for row in rows
        ],
        "total": len(rows),
    }


@app.post("/api/contracts/smart-scan")
async def smart_scan_contract(request: Request) -> dict:
    _require_contract_manage(request)

    file_name = _safe_filename(request)
    if not file_name:
        raise HTTPException(status_code=422, detail="请选择需要识别的合同文件")
    extension = PurePath(file_name).suffix.lower()
    if extension not in SCAN_EXTENSIONS:
        raise HTTPException(status_code=422, detail="智能识别目前支持 PDF、JPG、PNG、WEBP")

    content_length = int(request.headers.get("content-length") or 0)
    if content_length > SCAN_MAX_BYTES:
        raise HTTPException(status_code=413, detail="智能识别单个文件不能超过 4MB")
    body = await request.body()
    if not body:
        raise HTTPException(status_code=422, detail="合同文件内容为空")
    if len(body) > SCAN_MAX_BYTES:
        raise HTTPException(status_code=413, detail="智能识别单个文件不能超过 4MB")

    gateway_token = _gateway_token()
    if not gateway_token:
        raise HTTPException(status_code=503, detail="AI Gateway OIDC 凭证不可用，请重新部署后重试")

    headers = {
        "Authorization": f"Bearer {gateway_token}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=20.0)) as client:
            response = await client.post(
                AI_GATEWAY_RESPONSES_URL,
                headers=headers,
                json=_request_payload(file_name, body),
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="合同扫描超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="智能识别服务连接失败，请稍后重试") from exc

    if response.status_code >= 400:
        try:
            error_payload = response.json()
        except Exception:
            error_payload = {}
        gateway_message = ""
        if isinstance(error_payload, dict):
            error = error_payload.get("error")
            if isinstance(error, dict):
                gateway_message = str(error.get("message") or "").strip()
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="智能识别当前繁忙，请稍后再试")
        if response.status_code in {401, 403}:
            raise HTTPException(status_code=503, detail="AI Gateway OIDC 鉴权失败，请检查 Vercel OIDC 配置")
        if response.status_code in {402, 409}:
            raise HTTPException(status_code=503, detail="AI Gateway 可用额度不足，请稍后再试")
        raise HTTPException(
            status_code=502,
            detail=gateway_message or f"智能识别失败（AI Gateway {response.status_code}）",
        )

    try:
        gateway_payload = response.json()
        model_result = parse_model_json(gateway_payload)
        normalized = normalize_contract_scan_result(model_result)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        **normalized,
        "file": {
            "name": file_name,
            "size_bytes": len(body),
            "content_type": request.headers.get("content-type", "application/octet-stream").split(";", 1)[0],
        },
        "model": CONTRACT_SCAN_MODEL,
    }
