import pytest
from fastapi import HTTPException

from app.services.bill_lifecycle import (
    _transition_requires_reason,
    assert_update_allowed,
    is_financially_locked,
    status_label,
    transition_label,
)


def test_status_labels_and_lock_boundary():
    assert status_label("pending") == "待核对"
    assert status_label("confirmed") == "已核对"
    assert is_financially_locked("pending") is False
    assert is_financially_locked("confirmed") is True
    assert is_financially_locked("cancelled") is True


def test_locked_bill_rejects_financial_update_but_allows_remark():
    cleaned = assert_update_allowed("rd", "confirmed", {"status": "confirmed", "remark": "补充说明"})
    assert cleaned == {"remark": "补充说明"}

    with pytest.raises(HTTPException) as exc:
        assert_update_allowed("rd", "confirmed", {"settlement_amount": 100})
    assert exc.value.status_code == 409
    assert exc.value.detail["error"] == "bill_locked"


def test_direct_status_change_must_use_transition_endpoint():
    with pytest.raises(HTTPException) as exc:
        assert_update_allowed("channel", "pending", {"status": "confirmed"})
    assert exc.value.status_code == 409
    assert exc.value.detail["error"] == "use_status_transition"


def test_return_and_cancel_require_reason():
    assert _transition_requires_reason("confirmed", "pending") is True
    assert _transition_requires_reason("pending", "cancelled") is True
    assert _transition_requires_reason("pending", "confirmed") is False
    assert transition_label("rd", "confirmed", "invoiced") == "发票已收齐"
    assert transition_label("channel", "confirmed", "invoiced") == "发票已开齐"
