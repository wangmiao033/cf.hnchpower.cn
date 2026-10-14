#!/usr/bin/env python3
"""Safely prune old deployments for cf.hnchpower.cn only.

Keeps the latest three deployments plus any aliased/current-production deployments.
Uses the existing GitHub Actions VERCEL_TOKEN repository secret.
"""
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

PROJECT_ID = "prj_eMuMpXX2hUKvy7lSQ1deDIzoQDRN"
PROJECT_NAME = "cf-hnchpower-cn"
TEAM_ID = "team_YfsD5pM9JFtkqXnJIUdbF2eI"
PRODUCTION_DOMAIN = "cf.hnchpower.cn"
KEEP_LATEST = 3
MAX_DELETE = 50
BASE_URL = "https://api.vercel.com"
IN_PROGRESS = {"QUEUED", "INITIALIZING", "BUILDING", "DEPLOYING"}
TERMINAL = {"READY", "ERROR", "CANCELED", "CANCELLED"}
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() != "false"
TOKEN = os.environ.get("VERCEL_TOKEN", "")


def api(path, method="GET"):
    """Vercel API request with bounded retries; never log the access token."""
    url = BASE_URL + path
    for attempt in range(3):
        request = Request(url, method=method, headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/json",
        })
        try:
            with urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8")
                return json.loads(body) if body else {}
        except HTTPError as exc:
            message = exc.read().decode("utf-8", errors="replace")[:300]
            if exc.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"{method} {path}: HTTP {exc.code}: {message}") from exc
        except URLError as exc:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"{method} {path}: {exc.reason}") from exc
    raise RuntimeError(f"{method} {path}: retries exhausted")


def scoped(path, **params):
    return path + "?" + urlencode({"teamId": TEAM_ID, **params})


def deployment_id(item):
    value = item.get("uid") or item.get("id")
    if not isinstance(value, str) or not re.fullmatch(r"dpl_[A-Za-z0-9]+", value):
        raise RuntimeError("Vercel returned an invalid deployment ID; refusing to clean up")
    return value


def created_at(item):
    value = item.get("created") or item.get("createdAt")
    if isinstance(value, bool) or not isinstance(value, (float, int)) or value <= 0:
        raise RuntimeError("Vercel returned an invalid deployment timestamp")
    return int(value)


def status(item):
    return str(item.get("readyState") or item.get("state") or "").upper()


def verify_project():
    project = api(scoped(f"/v9/projects/{PROJECT_ID}"))
    if project.get("id") != PROJECT_ID or project.get("name") != PROJECT_NAME:
        raise RuntimeError("Project identity mismatch; refusing to delete anything")


def live_production_id():
    deployment = api(scoped(f"/v13/deployments/{quote(PRODUCTION_DOMAIN)}"))
    if deployment.get("name") != PROJECT_NAME:
        raise RuntimeError("Live production domain resolved to a different project")
    return deployment_id(deployment)


def list_all_deployments():
    deployments = {}
    next_until = None
    seen_cursors = set()
    for _ in range(200):
        params = {"projectId": PROJECT_ID, "limit": 100}
        if next_until is not None:
            params["until"] = next_until
        page = api(scoped("/v6/deployments", **params))
        rows = page.get("deployments")
        if not isinstance(rows, list):
            raise RuntimeError("Unexpected Vercel deployments payload; refusing to clean up")
        for row in rows:
            if row.get("projectId") not in (None, PROJECT_ID):
                raise RuntimeError("Deployment belongs to a different project")
            if row.get("name") not in (None, PROJECT_NAME):
                raise RuntimeError("Unexpected deployment project name")
            key = deployment_id(row)
            created_at(row)
            deployments[key] = row
        pagination = page.get("pagination") or {}
        next_until = pagination.get("next")
        if next_until is None:
            return sorted(deployments.values(), key=created_at, reverse=True)
        if next_until in seen_cursors:
            raise RuntimeError("Repeated Vercel pagination cursor; refusing partial cleanup")
        seen_cursors.add(next_until)
    raise RuntimeError("Exceeded pagination safety limit; refusing partial cleanup")


def has_alias(deployment):
    response = api(scoped(f"/v2/deployments/{quote(deployment)}/aliases"))
    aliases = response.get("aliases")
    if not isinstance(aliases, list):
        raise RuntimeError(f"Could not verify aliases for {deployment}; refusing deletion")
    return bool(aliases)


def summary(lines):
    for line in lines:
        print(line)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as out:
            out.write("\n".join(lines) + "\n")


def main():
    if not TOKEN:
        raise RuntimeError("Missing GitHub repository secret VERCEL_TOKEN")
    verify_project()
    original_live = live_production_id()
    deployments = list_all_deployments()
    if original_live not in {deployment_id(item) for item in deployments}:
        raise RuntimeError("Live production deployment missing from full project listing")
    if any(status(item) in IN_PROGRESS for item in deployments):
        summary(["### Vercel deployment cleanup", "Build in progress: cleanup deferred until next run."])
        return

    protected = {deployment_id(item) for item in deployments[:KEEP_LATEST]}
    protected.add(original_live)
    deleted = 0
    aliased = 0
    candidates = 0
    for item in deployments:
        dep_id = deployment_id(item)
        if dep_id in protected or status(item) not in TERMINAL:
            continue
        candidates += 1
        if deleted >= MAX_DELETE:
            break
        if has_alias(dep_id):
            aliased += 1
            print(f"SKIP (active alias) {dep_id}")
            continue
        # Fail closed on a concurrent production change.
        if live_production_id() != original_live:
            raise RuntimeError("Production changed during cleanup; stopping before further deletes")
        if DRY_RUN:
            print(f"DRY RUN delete {dep_id}: {status(item)}")
        else:
            api(scoped(f"/v13/deployments/{quote(dep_id)}"), method="DELETE")
            print(f"DELETED {dep_id}: {status(item)}")
        deleted += 1
        time.sleep(0.2)

    summary([
        "### Vercel deployment cleanup",
        f"- Project: \u0060{PROJECT_NAME}\u0060 only",
        f"- Policy: newest {KEEP_LATEST} + live production + all alias targets retained",
        f"- Existing deployments examined: {len(deployments)}",
        f"- Older terminal-state candidates: {candidates}",
        f"- Skipped because aliased: {aliased}",
        f"- {'Would delete' if DRY_RUN else 'Deleted'} this run: {deleted}",
        f"- Mode: {'dry run (no deletions)' if DRY_RUN else 'scheduled cleanup'}",
    ])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
