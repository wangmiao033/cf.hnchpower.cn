"""Structured settlement terms attached to contract access items."""

from __future__ import annotations

import os
from decimal import Decimal, InvalidOperation

import jwt
import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import Response
from psycopg.rows import dict_row

app = FastAPI(title="contract-structured-terms", docs_url=None, redoc_url=None)

DATABASE_URL = os.environ.get("QUICKSDK_DATABASE_URL", "").strip() or os.environ.get("DATABASE_URL", "").strip()
AUTH_JWT_SECRET = os.environ.get("AUTH_JWT_SECRET", "").strip()
ROLE_ALIASES = {"user": "operator"}
ROLE_CONTRACT_PERMISSIONS = {
    "admin": {"contracts.view", "contracts.manage"},
    "finance": {"contracts.view", "contracts.manage"},
    "operator": {"contracts.view"},
    "viewer": {"contracts.view"},
}

TEXT_FIELDS = {
    "settlement_mode": 100,
    "settlement_basis": 200,
    "commercial_variant": 80,
    "currency": 12,
    "settlement_cycle": 100,
    "payment_terms": 100,
    "invoice_type": 120,
    "refund_rule": 2000,
    "server_cost_bearer": 200,
    "deduction_rule": 2000,
}
DECIMAL_FIELDS = {
    "unit_price": Decimal("0.0001"),
    "invoice_tax_rate": Decimal("0.01"),
    "testing_fee": Decimal("0.01"),
    "prepayment_amount": Decimal("0.01"),
    "minimum_guarantee_amount": Decimal("0.01"),
}


def _database_url() -> str:
    if not DATABASE_URL:
        raise HTTPException(status_code=503, detail="合同条款数据库尚未配置")
    return DATABASE_URL


def _require_permission(request: Request, permission: str) -> str:
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

        raw_role = str(user.get("role") or "operator").strip().lower() or "operator"
        role = ROLE_ALIASES.get(raw_role, raw_role)
        permissions = set(ROLE_CONTRACT_PERMISSIONS.get(role, ROLE_CONTRACT_PERMISSIONS["operator"]))
        if role != "admin":
            relation = conn.execute(
                "SELECT to_regclass('public.auth_user_permission_overrides') AS name"
            ).fetchone()
            if relation and relation.get("name"):
                overrides = conn.execute(
                    """
                    SELECT permission, effect
                    FROM auth_user_permission_overrides
                    WHERE user_id = %s
                      AND permission IN ('contracts.view', 'contracts.manage')
                    """,
                    [user_id],
                ).fetchall()
                for override in overrides:
                    code = str(override.get("permission") or "")
                    effect = str(override.get("effect") or "")
                    if effect == "allow":
                        permissions.add(code)
                    elif effect == "deny":
                        permissions.discard(code)
        if permission not in permissions:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "permission_denied",
                    "permission": permission,
                    "message": "当前账号没有访问或修改合同条款的权限。",
                },
            )
    return user_id


def _require_table(conn: psycopg.Connection) -> None:
    relation = conn.execute(
        "SELECT to_regclass('public.cf_contract_access_terms') AS name"
    ).fetchone()
    if not relation or not relation.get("name"):
        raise HTTPException(
            status_code=503,
            detail={
                "error": "contract_terms_schema_not_ready",
                "message": "合同结构化条款数据库尚未初始化，请先完成生产迁移。",
            },
        )


def _text(value: object, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _decimal(value: object, quantize: Decimal, *, percent: bool = False) -> Decimal | None:
    if value in (None, ""):
        return None
    raw = str(value).replace(",", "").replace("，", "").replace("%", "").strip()
    if not raw:
        return None
    try:
        parsed = Decimal(raw)
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(status_code=422, detail="合同条款金额/比例必须是有效数字") from exc
    if parsed < 0:
        raise HTTPException(status_code=422, detail="合同条款金额/比例不能为负数")
    if percent and parsed > 100:
        raise HTTPException(status_code=422, detail="税率必须在 0 到 100 之间")
    return parsed.quantize(quantize)


def _payload(raw: dict) -> dict:
    clean = {key: _text(raw.get(key), limit) for key, limit in TEXT_FIELDS.items()}
    clean["currency"] = (clean.get("currency") or "CNY").upper()
    for key, quantize in DECIMAL_FIELDS.items():
        clean[key] = _decimal(raw.get(key), quantize, percent=key == "invoice_tax_rate")
    return clean


def _row(row: dict) -> dict:
    return {
        "access_item_id": str(row["access_item_id"]),
        "contract_id": str(row["contract_id"]),
        "settlement_mode": row.get("settlement_mode") or "",
        "settlement_basis": row.get("settlement_basis") or "",
        "commercial_variant": row.get("commercial_variant") or "",
        "unit_price": str(row["unit_price"]) if row.get("unit_price") is not None else None,
        "currency": row.get("currency") or "CNY",
        "settlement_cycle": row.get("settlement_cycle") or "",
        "payment_terms": row.get("payment_terms") or "",
        "invoice_tax_rate": str(row["invoice_tax_rate"]) if row.get("invoice_tax_rate") is not None else None,
        "invoice_type": row.get("invoice_type") or "",
        "refund_rule": row.get("refund_rule") or "",
        "testing_fee": str(row["testing_fee"]) if row.get("testing_fee") is not None else None,
        "server_cost_bearer": row.get("server_cost_bearer") or "",
        "prepayment_amount": str(row["prepayment_amount"]) if row.get("prepayment_amount") is not None else None,
        "minimum_guarantee_amount": str(row["minimum_guarantee_amount"]) if row.get("minimum_guarantee_amount") is not None else None,
        "deduction_rule": row.get("deduction_rule") or "",
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }


@app.get("/api/contract-terms/health")
def health() -> dict:
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _require_table(conn)
        count = int(conn.execute("SELECT COUNT(*) AS count FROM cf_contract_access_terms").fetchone()["count"] or 0)
    return {"status": "ok", "schema_ready": True, "count": count}


@app.get("/api/contract-terms")
def list_terms(
    request: Request,
    contract_id: str | None = Query(None),
    access_item_id: str | None = Query(None),
) -> dict:
    _require_permission(request, "contracts.view")
    filters: list[str] = []
    params: list[object] = []
    if contract_id:
        filters.append("contract_id = %s")
        params.append(contract_id)
    if access_item_id:
        filters.append("access_item_id = %s")
        params.append(access_item_id)
    where = f"WHERE {' AND '.join(filters)}" if filters else ""
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _require_table(conn)
        rows = conn.execute(
            f"SELECT * FROM cf_contract_access_terms {where} ORDER BY updated_at DESC",
            params,
        ).fetchall()
    return {"items": [_row(item) for item in rows], "total": len(rows)}


@app.put("/api/contract-terms/{access_item_id}")
def upsert_terms(access_item_id: str, request: Request, payload: dict) -> dict:
    _require_permission(request, "contracts.manage")
    clean = _payload(payload)
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _require_table(conn)
        access_item = conn.execute(
            "SELECT id, contract_id FROM cf_contract_access_items WHERE id = %s",
            [access_item_id],
        ).fetchone()
        if access_item is None:
            raise HTTPException(status_code=404, detail="合同合作清单不存在")
        requested_contract_id = str(payload.get("contract_id") or "").strip()
        actual_contract_id = str(access_item["contract_id"])
        if requested_contract_id and requested_contract_id != actual_contract_id:
            raise HTTPException(status_code=409, detail="合作清单与合同归属不一致")

        row = conn.execute(
            """
            INSERT INTO cf_contract_access_terms (
              access_item_id, contract_id, settlement_mode, settlement_basis, commercial_variant,
              unit_price, currency, settlement_cycle, payment_terms,
              invoice_tax_rate, invoice_type, refund_rule, testing_fee,
              server_cost_bearer, prepayment_amount, minimum_guarantee_amount,
              deduction_rule
            )
            VALUES (
              %s, %s, %s, %s, %s,
              %s, %s, %s, %s,
              %s, %s, %s, %s,
              %s, %s, %s,
              %s
            )
            ON CONFLICT (access_item_id) DO UPDATE SET
              contract_id = EXCLUDED.contract_id,
              settlement_mode = EXCLUDED.settlement_mode,
              settlement_basis = EXCLUDED.settlement_basis,
              commercial_variant = EXCLUDED.commercial_variant,
              unit_price = EXCLUDED.unit_price,
              currency = EXCLUDED.currency,
              settlement_cycle = EXCLUDED.settlement_cycle,
              payment_terms = EXCLUDED.payment_terms,
              invoice_tax_rate = EXCLUDED.invoice_tax_rate,
              invoice_type = EXCLUDED.invoice_type,
              refund_rule = EXCLUDED.refund_rule,
              testing_fee = EXCLUDED.testing_fee,
              server_cost_bearer = EXCLUDED.server_cost_bearer,
              prepayment_amount = EXCLUDED.prepayment_amount,
              minimum_guarantee_amount = EXCLUDED.minimum_guarantee_amount,
              deduction_rule = EXCLUDED.deduction_rule,
              updated_at = NOW()
            RETURNING *
            """,
            [
                access_item_id,
                actual_contract_id,
                clean["settlement_mode"],
                clean["settlement_basis"],
                clean["commercial_variant"],
                clean["unit_price"],
                clean["currency"],
                clean["settlement_cycle"],
                clean["payment_terms"],
                clean["invoice_tax_rate"],
                clean["invoice_type"],
                clean["refund_rule"],
                clean["testing_fee"],
                clean["server_cost_bearer"],
                clean["prepayment_amount"],
                clean["minimum_guarantee_amount"],
                clean["deduction_rule"],
            ],
        ).fetchone()
        conn.commit()
    return _row(row)


@app.delete("/api/contract-terms/{access_item_id}", status_code=204)
def delete_terms(access_item_id: str, request: Request) -> Response:
    _require_permission(request, "contracts.manage")
    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        _require_table(conn)
        conn.execute("DELETE FROM cf_contract_access_terms WHERE access_item_id = %s", [access_item_id])
        conn.commit()
    return Response(status_code=204)
