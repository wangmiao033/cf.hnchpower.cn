"""Resolve Neon connection strings for runtime traffic versus migrations.

Runtime prefers a pooled host (the endpoint label ends with ``-pooler``).
Schema migrations keep a direct/unpooled host. The shared production compute
endpoint is allowed only when ``VERCEL_ENV`` or ``APP_ENV`` is exactly
``production``, or when ``ALLOW_SHARED_PRODUCTION_DATABASE=1``. Unset markers
are not production. Connection strings are never logged.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from urllib.parse import urlsplit, urlunsplit

# Public compute id of the shared production project. Not a credential.
PRODUCTION_ENDPOINT_MARKERS = ("withered-mouse-06737032",)
_MIGRATION_CONTEXTS = {"deploy", "manual", "cli"}
_TRUTHY = {"1", "true", "yes", "on"}


class ProductionDatabaseGuardError(RuntimeError):
    """Non-production runtime was pointed at the production Neon endpoint."""


def _env_value(env: Mapping[str, str], name: str) -> str:
    return str(env.get(name) or "").strip()


def _first_present(env: Mapping[str, str], names: tuple[str, ...]) -> str:
    for name in names:
        value = _env_value(env, name)
        if value:
            return value
    return ""


def runtime_name(env: Mapping[str, str] | None = None) -> str:
    """Return the explicit runtime name, or ``unmarked`` when neither marker is set.

    ``VERCEL_ENV`` wins when it is present. An empty ``APP_ENV`` is not treated
    as production.
    """
    source = env if env is not None else os.environ
    vercel_env = _env_value(source, "VERCEL_ENV").lower()
    if vercel_env:
        return vercel_env
    app_env = _env_value(source, "APP_ENV").lower()
    if app_env:
        return app_env
    return "unmarked"


def migration_context_active(env: Mapping[str, str] | None = None) -> bool:
    source = env if env is not None else os.environ
    return _env_value(source, "MIGRATION_EXECUTION_CONTEXT").lower() in _MIGRATION_CONTEXTS


def rewrite_neon_endpoint(url: str, *, pooled: bool) -> str:
    """Insert or remove Neon ``-pooler`` on the endpoint label. Other hosts stay unchanged."""
    raw = str(url or "").strip()
    if not raw:
        return raw
    parts = urlsplit(raw)
    host = parts.hostname or ""
    if "neon.tech" not in host.lower():
        return raw
    labels = host.split(".")
    endpoint = labels[0]
    if pooled:
        if endpoint.lower().endswith("-pooler"):
            return raw
        new_endpoint = f"{endpoint}-pooler"
    else:
        if not endpoint.lower().endswith("-pooler"):
            return raw
        new_endpoint = endpoint[: -len("-pooler")]
    new_host = ".".join([new_endpoint, *labels[1:]])
    auth, separator, hostport = parts.netloc.rpartition("@")
    hostport = hostport.replace(host, new_host, 1)
    netloc = f"{auth}{separator}{hostport}" if separator else hostport
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def _uses_production_endpoint(url: str) -> bool:
    host = (urlsplit(str(url or "").strip()).hostname or "").lower()
    return any(marker in host for marker in PRODUCTION_ENDPOINT_MARKERS)


def assert_runtime_database_scope(url: str, env: Mapping[str, str] | None = None) -> None:
    """Allow the production compute only for an explicit production marker or the override."""
    source = env if env is not None else os.environ
    if _env_value(source, "ALLOW_SHARED_PRODUCTION_DATABASE").lower() in _TRUTHY:
        return
    if not _uses_production_endpoint(url):
        return
    if runtime_name(source) == "production":
        return
    raise ProductionDatabaseGuardError(
        "只有 VERCEL_ENV=production 或 APP_ENV=production 可以连接生产 Neon 计算节点。"
        "未设置环境、本地、预览和开发默认拒绝。请改用 Neon 分支；"
        "确需临时共用时设置 ALLOW_SHARED_PRODUCTION_DATABASE=1。"
        "不要把生产连接串写入仓库。"
    )


def _missing_database_url() -> RuntimeError:
    return RuntimeError(
        "DATABASE_URL and QUICKSDK_DATABASE_URL are both missing or empty."
    )


def resolve_runtime_database_url(env: Mapping[str, str] | None = None) -> str:
    """Pooled URL for application traffic. Direct hosts on Neon are rewritten."""
    source = env if env is not None else os.environ
    database_url = _env_value(source, "DATABASE_URL")
    quicksdk_url = _env_value(source, "QUICKSDK_DATABASE_URL")
    if database_url:
        raw = _env_value(source, "DATABASE_URL_POOLED") or database_url
    elif quicksdk_url:
        raw = _env_value(source, "QUICKSDK_DATABASE_URL_POOLED") or quicksdk_url
    else:
        raise _missing_database_url()
    pooled = rewrite_neon_endpoint(raw, pooled=True)
    assert_runtime_database_scope(pooled, source)
    return pooled


def resolve_migration_database_url(env: Mapping[str, str] | None = None) -> str:
    """Direct URL for schema migrations. Pooled hosts on Neon are rewritten back."""
    source = env if env is not None else os.environ
    database_url = _env_value(source, "DATABASE_URL")
    quicksdk_url = _env_value(source, "QUICKSDK_DATABASE_URL")
    database_direct = _env_value(source, "DATABASE_URL_DIRECT")
    quicksdk_direct = _env_value(source, "QUICKSDK_DATABASE_URL_DIRECT")
    if database_url or database_direct:
        raw = database_direct or database_url
    elif quicksdk_url or quicksdk_direct:
        raw = quicksdk_direct or quicksdk_url
    else:
        raise _missing_database_url()
    direct = rewrite_neon_endpoint(raw, pooled=False)
    assert_runtime_database_scope(direct, source)
    return direct
