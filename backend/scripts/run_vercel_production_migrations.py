"""Resolve Production DB credentials from Vercel and run migrations exactly once.

This script is intended for GitHub Actions. It never prints environment values.
It supports both project-scoped and team Shared Environment Variables linked to the
project, because Vercel multi-service projects may receive runtime variables through
a shared team configuration even when /v10/projects/{id}/env does not expose values.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

WANTED_KEYS = ("DATABASE_URL", "QUICKSDK_DATABASE_URL")


def _required_env(name: str) -> str:
    value = str(os.environ.get(name) or "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _api_json(path: str, token: str) -> Any:
    request = urllib.request.Request(
        f"https://api.vercel.com{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Vercel API {path} failed with HTTP {exc.code}: {body}") from exc


def _is_production(target: Any) -> bool:
    if target is None:
        return True
    if target == "production":
        return True
    return isinstance(target, list) and "production" in target


def _walk_dicts(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_dicts(child)


def _project_env_values(
    payload: Any,
    token: str,
    team_id: str,
    project_id: str,
) -> dict[str, str]:
    """Resolve project envs, fetching sensitive values individually when needed."""
    found: dict[str, str] = {}
    seen_ids: set[str] = set()
    for item in _walk_dicts(payload):
        key = str(item.get("key") or "")
        if key not in WANTED_KEYS or not _is_production(item.get("target")):
            continue
        value = item.get("value")
        if isinstance(value, str) and value:
            found[key] = value
            continue
        env_id = str(item.get("id") or "")
        if not env_id or env_id in seen_ids:
            continue
        seen_ids.add(env_id)
        detail = _api_json(
            f"/v1/projects/{urllib.parse.quote(project_id, safe='')}/env/"
            f"{urllib.parse.quote(env_id, safe='')}?teamId={urllib.parse.quote(team_id, safe='')}",
            token,
        )
        for row in _walk_dicts(detail):
            if str(row.get("key") or "") != key:
                continue
            decrypted_value = row.get("value")
            if isinstance(decrypted_value, str) and decrypted_value:
                found[key] = decrypted_value
                break
    return found


def _shared_candidates(payload: Any, project_id: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in _walk_dicts(payload):
        key = str(item.get("key") or "")
        env_id = str(item.get("id") or "")
        if key not in WANTED_KEYS or not env_id or env_id in seen:
            continue
        projects = item.get("projectId") or item.get("projectIds") or []
        if isinstance(projects, str):
            projects = [projects]
        if projects and project_id not in projects:
            continue
        if not _is_production(item.get("target")):
            continue
        seen.add(env_id)
        candidates.append(item)
    return candidates


def _shared_env_values(payload: Any, token: str, team_id: str, project_id: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for item in _shared_candidates(payload, project_id):
        key = str(item.get("key") or "")
        inline_value = item.get("value")
        if isinstance(inline_value, str) and inline_value:
            found[key] = inline_value
            continue
        env_id = urllib.parse.quote(str(item["id"]), safe="")
        detail = _api_json(f"/v1/env/{env_id}?teamId={urllib.parse.quote(team_id, safe='')}", token)
        for row in _walk_dicts(detail):
            if str(row.get("key") or "") != key:
                continue
            value = row.get("value")
            if isinstance(value, str) and value:
                found[key] = value
                break
    return found


def resolve_database_env() -> tuple[dict[str, str], str]:
    token = _required_env("VERCEL_TOKEN")
    team_id = _required_env("VERCEL_ORG_ID")
    project_id = _required_env("VERCEL_PROJECT_ID")

    project_path = (
        f"/v10/projects/{urllib.parse.quote(project_id, safe='')}/env"
        f"?teamId={urllib.parse.quote(team_id, safe='')}&decrypt=true"
    )
    project_payload = _api_json(project_path, token)
    values = _project_env_values(project_payload, token, team_id, project_id)
    if values:
        return values, "project"

    shared_path = (
        f"/v1/env?teamId={urllib.parse.quote(team_id, safe='')}"
        f"&projectId={urllib.parse.quote(project_id, safe='')}"
    )
    shared_payload = _api_json(shared_path, token)
    values = _shared_env_values(shared_payload, token, team_id, project_id)
    if values:
        return values, "shared"

    project_keys = sorted({
        str(item.get("key") or "")
        for item in _walk_dicts(project_payload)
        if item.get("key") and any(token in str(item.get("key")).upper() for token in ("DATABASE", "POSTGRES", "NEON", "QUICKSDK"))
    })
    shared_keys = sorted({
        str(item.get("key") or "")
        for item in _walk_dicts(shared_payload)
        if item.get("key") and any(token in str(item.get("key")).upper() for token in ("DATABASE", "POSTGRES", "NEON", "QUICKSDK"))
    })
    raise RuntimeError(
        "No Production DATABASE_URL/QUICKSDK_DATABASE_URL found in project or linked shared env. "
        f"Project DB-like keys={project_keys or 'none'}, shared DB-like keys={shared_keys or 'none'}"
    )


def main() -> int:
    values, source = resolve_database_env()
    for key, value in values.items():
        os.environ[key] = value
    os.environ["MIGRATION_EXECUTION_CONTEXT"] = "deploy"

    # Import only after setting DATABASE_URL so SQLAlchemy never initializes against
    # an incomplete CI environment.
    from app.core.migrations import run_schema_migrations

    run_schema_migrations()
    print(f"schema migrations complete; database env source={source}; keys={','.join(sorted(values))}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"::error::{exc}", file=sys.stderr)
        raise
