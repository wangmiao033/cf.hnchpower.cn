"""Server-side RBAC guard for the standalone contract data service."""

from __future__ import annotations

import os

import jwt
import psycopg
from fastapi import Request
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row

from neon_database_url import ProductionDatabaseGuardError, resolve_runtime_database_url

AUTH_JWT_SECRET = os.environ.get("AUTH_JWT_SECRET", "").strip()
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
ROLE_ALIASES = {"user": "operator"}
ROLE_CONTRACT_PERMISSIONS = {
    "admin": {"contracts.view", "contracts.manage"},
    "finance": {"contracts.view", "contracts.manage"},
    "operator": {"contracts.view"},
    "viewer": {"contracts.view"},
}


def _error(status_code: int, detail: str, *, permission: str | None = None) -> JSONResponse:
    payload: dict[str, object] = {"detail": detail}
    if permission:
        payload["error"] = "permission_denied"
        payload["permission"] = permission
    return JSONResponse(status_code=status_code, content=payload)


def _runtime_database_url() -> tuple[str | None, JSONResponse | None]:
    try:
        return resolve_runtime_database_url(), None
    except ProductionDatabaseGuardError as exc:
        return None, _error(503, str(exc))
    except RuntimeError:
        return None, _error(503, "合同权限服务数据库尚未配置")


def _resolve_permissions(request: Request) -> tuple[set[str] | None, JSONResponse | None]:
    database_url, database_error = _runtime_database_url()
    if database_error is not None or not database_url:
        return None, database_error or _error(503, "合同权限服务数据库尚未配置")
    token = request.cookies.get("caiwu_session", "").strip()
    if not token or not AUTH_JWT_SECRET:
        return None, _error(401, "请先登录")
    try:
        payload = jwt.decode(token, AUTH_JWT_SECRET, algorithms=["HS256"])
    except Exception:
        return None, _error(401, "登录已失效，请重新登录")

    user_id = str(payload.get("sub") or "")
    session_id = str(payload.get("sid") or "")
    token_jti = str(payload.get("jti") or "")
    if not user_id or not session_id or not token_jti:
        return None, _error(401, "请先登录")

    try:
        with psycopg.connect(database_url, connect_timeout=15, row_factory=dict_row) as conn:
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
                return None, _error(401, "登录已失效，请重新登录")

            raw_role = str(user.get("role") or "operator").strip().lower() or "operator"
            role = ROLE_ALIASES.get(raw_role, raw_role)
            permissions = set(ROLE_CONTRACT_PERMISSIONS.get(role, ROLE_CONTRACT_PERMISSIONS["operator"]))
            if role == "admin":
                return permissions, None

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
                    permission = str(override.get("permission") or "")
                    effect = str(override.get("effect") or "")
                    if effect == "allow":
                        permissions.add(permission)
                    elif effect == "deny":
                        permissions.discard(permission)
            return permissions, None
    except Exception:
        return None, _error(503, "合同权限校验暂时不可用")


async def contract_permission_middleware(request: Request, call_next):
    path = request.url.path.rstrip("/") or "/"
    if request.method.upper() == "OPTIONS":
        return await call_next(request)
    if not (path == "/api/contracts" or path.startswith("/api/contracts/")):
        return await call_next(request)
    if path == "/api/contracts/health":
        return await call_next(request)

    permission = "contracts.manage" if request.method.upper() in UNSAFE_METHODS else "contracts.view"
    permissions, error = _resolve_permissions(request)
    if error is not None:
        return error
    if permission not in (permissions or set()):
        return _error(
            403,
            "当前账号没有访问或修改合同模块的权限。",
            permission=permission,
        )
    return await call_next(request)
