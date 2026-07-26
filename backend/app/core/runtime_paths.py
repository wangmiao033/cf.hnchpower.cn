"""Runtime filesystem paths that work locally and on serverless platforms."""

from __future__ import annotations

import os
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent


def upload_root() -> Path:
    """Return the writable root for files uploaded through the API."""
    configured = os.environ.get("UPLOAD_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    if os.environ.get("VERCEL"):
        return Path("/tmp/uploads")
    return (_BACKEND_ROOT / "uploads").resolve()


def ensure_upload_root() -> Path:
    root = upload_root()
    root.mkdir(parents=True, exist_ok=True)
    return root
