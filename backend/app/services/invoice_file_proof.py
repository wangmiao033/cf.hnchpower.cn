"""Short-lived, tamper-proof reference to an original electronic invoice upload.

The /parse endpoint already stores verified text-bearing PDF/OFD/XML files in
private Vercel Blob. Only its signed reference may be copied into a new
channel-issued invoice. The public client never chooses an arbitrary blob URL.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from urllib.parse import urlsplit

from fastapi import HTTPException

TTL_SECONDS = 60 * 60
SUPPORTED_TYPES = {"application/pdf", "application/ofd", "application/xml"}


def _secret() -> bytes:
    secret = os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip()
    if not secret:
        raise HTTPException(503, detail={
            "error": "invoice_blob_storage_not_configured",
            "message": "电子发票私有存储没有配置，暂时不能保存原始凭证",
        })
    return hashlib.sha256(("channel-invoice-proof-v1:" + secret).encode()).digest()


def _encode(payload: dict) -> str:
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    value = base64.urlsafe_b64encode(blob).rstrip(b"=").decode("ascii")
    signature = hmac.new(_secret(), value.encode("ascii"), hashlib.sha256).hexdigest()
    return value + "." + signature


def sign_invoice_upload(source: dict, *, now: int | None = None) -> str:
    """Generate only for the bytes already validated and uploaded by /parse."""
    value = {
        "url": str(source.get("source_file_url") or ""),
        "name": str(source.get("source_file_name") or "")[:260],
        "type": str(source.get("source_file_type") or ""),
        "size": int(source.get("source_file_size") or 0),
        "at": int(time.time() if now is None else now),
    }
    _validate(value)
    return _encode(value)


def _validate(value: dict) -> None:
    url = str(value.get("url") or "")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or "/invoice-files/" not in parsed.path:
        raise ValueError("untrusted_invoice_file_url")
    if not value.get("name") or str(value.get("type")) not in SUPPORTED_TYPES:
        raise ValueError("untrusted_invoice_file_metadata")
    if not 0 < int(value.get("size") or 0) <= 4 * 1024 * 1024:
        raise ValueError("invalid_invoice_file_size")


def verify_invoice_upload(proof: str, *, now: int | None = None) -> dict:
    """Decode verified server metadata, rejecting altered or expired references."""
    try:
        if not proof or len(proof) > 8192:
            raise ValueError("missing")
        payload, signature = proof.rsplit(".", 1)
        expected = hmac.new(_secret(), payload.encode("ascii"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise ValueError("signature")
        raw = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("payload")
        _validate(data)
        age = int(time.time() if now is None else now) - int(data.get("at") or 0)
        if not 0 <= age <= TTL_SECONDS:
            raise ValueError("expired")
        return data
    except (ValueError, TypeError, KeyError, UnicodeError) as exc:
        raise HTTPException(409, detail={
            "error": "invoice_source_proof_invalid",
            "message": "上传的发票凭证已经过期或无法核验，请重新选择原始电子发票文件",
        }) from exc
