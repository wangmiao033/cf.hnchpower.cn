"""One authoritative preflight for channel and R&D bill financial writes.

Financial locks are never bypassed. A write must be based on the same server
revision the editor opened; otherwise we return a structured 409 *before*
mutating a single line. Non-editing integrations may omit the optional revision,
but the immutable lifecycle lock still applies to every request.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from app.services.bill_lifecycle import assert_update_allowed, normalize_status, status_label


def _as_utc(value: datetime) -> datetime:
    # PostgreSQL may return a naive UTC datetime via some drivers.
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def prepare_bill_financial_update(bill_type: str, bill: Any, incoming: dict) -> dict:
    """Validate the current stored status/revision, then return permitted fields.

    The returned dict contains neither `status` nor `expected_updated_at`,
    and can be safely applied to the ORM instance after validation.
    """
    current_status = normalize_status(getattr(bill, "status", None))
    payload = dict(incoming)
    expected = payload.pop("expected_updated_at", None)
    try:
        approved = assert_update_allowed(bill_type, current_status, payload)
    except HTTPException as exc:
        if exc.status_code != 409 or not isinstance(exc.detail, dict):
            raise
        details = dict(exc.detail)
        details["current_status"] = current_status
        details["current_status_label"] = status_label(current_status)
        updated = getattr(bill, "updated_at", None)
        details["current_updated_at"] = updated.isoformat() if isinstance(updated, datetime) else None
        # One actionable message across both RD and channel editing screens.
        if details.get("error") in ("bill_locked", "use_status_transition"):
            details["message"] = (
                f"服务器账单当前为「{status_label(current_status)}」，不能直接保存业务金额。"
                "若需修改，请返回账单详情，按已有「修改账单」流程记录原因并退回待核对。"
            )
        raise HTTPException(status_code=409, detail=details) from exc

    if expected is not None:
        current = getattr(bill, "updated_at", None)
        if not isinstance(expected, datetime) or not isinstance(current, datetime) or _as_utc(expected) != _as_utc(current):
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "bill_version_conflict",
                    "message": (
                        f"服务器账单已更新（当前「{status_label(current_status)}」）。"
                        "本次修改未覆盖服务器数据；请核对服务器最新版本后重新保存。"
                    ),
                    "current_status": current_status,
                    "current_status_label": status_label(current_status),
                    "current_updated_at": current.isoformat() if isinstance(current, datetime) else None,
                    "expected_updated_at": expected.isoformat() if isinstance(expected, datetime) else None,
                },
            )
    return approved
