"""SQLAlchemy-level guard preventing direct edits of locked bills."""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import event, inspect, select
from sqlalchemy.orm import Session

from app.models.channel import ChannelRecord, ChannelRecordLineItem
from app.models.reconciliation import ReconciliationLineItem, ReconciliationRecord

EDITABLE = {"draft", "pending"}

RD_PROTECTED = {
    "statement_no",
    "settlement_month",
    "partner_name",
    "game_name",
    "game_flow",
    "test_cost",
    "voucher_cost",
    "channel_fee_rate",
    "tax_rate",
    "revenue_share_rate",
    "discount_value",
    "refund_amount",
    "settlement_amount",
}

CHANNEL_PROTECTED = {
    "statement_no",
    "channel_name",
    "partner_name",
    "game_name",
    "settlement_month",
    "start_date",
    "end_date",
    "billing_flow",
    "voucher_cost",
    "no_worry_cost",
    "refund_cost",
    "test_cost",
    "welfare_cost",
    "share_rate",
    "billing_amount",
    "share_amount",
    "tax_rate",
    "gateway_cost",
    "settlement_amount",
    "server_cost",
    "discount_type",
    "channel_fee_rate",
    "dev_share_rate",
    "profit_rate",
}


def _normal(value) -> str:
    return str(value or "pending").strip().lower() or "pending"


def _old_status(obj) -> str:
    attr = inspect(obj).attrs.status
    history = attr.history
    if history.has_changes() and history.deleted:
        return _normal(history.deleted[0])
    return _normal(obj.status)


def _changed_protected(obj, fields: set[str]) -> list[str]:
    state = inspect(obj)
    return sorted(
        field
        for field in fields
        if field in state.attrs and state.attrs[field].history.has_changes()
    )


def _locked_error(status_value: str, fields: list[str] | None = None) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": "bill_locked",
            "message": "账单已核对并锁定。需要修改业务数据时，请先通过状态流转退回“待核对”。",
            "status": status_value,
            "locked_fields": fields or [],
        },
    )


def _status_error(current: str, requested: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": "use_status_transition",
            "message": "账单状态必须通过状态流转操作修改。",
            "current_status": current,
            "requested_status": requested,
        },
    )


def _identity_parent(session: Session, parent_type, parent_id: str | None):
    if not parent_id:
        return None
    for candidate in session.identity_map.values():
        if isinstance(candidate, parent_type) and str(candidate.id) == str(parent_id):
            return candidate
    return None


def _bulk_delete_parent_id(statement, expected_prefix: str) -> str | None:
    try:
        params = statement.compile().params
    except Exception:
        return None
    for key, value in params.items():
        if key.startswith(expected_prefix) and value not in (None, ""):
            return str(value)
    return None


@event.listens_for(Session, "before_flush")
def enforce_bill_lock(session: Session, _flush_context, _instances) -> None:
    transition_mode = bool(session.info.get("allow_lifecycle_transition"))

    for obj in list(session.new):
        if isinstance(obj, ReconciliationRecord):
            requested = _normal(obj.status)
            if requested not in EDITABLE and not transition_mode:
                raise _status_error("pending", requested)
        elif isinstance(obj, ChannelRecord):
            requested = _normal(obj.status)
            if requested not in EDITABLE and not transition_mode:
                raise _status_error("pending", requested)
        elif isinstance(obj, ReconciliationLineItem) and not transition_mode:
            parent = obj.reconciliation or _identity_parent(
                session, ReconciliationRecord, getattr(obj, "reconciliation_id", None)
            )
            if parent is not None and _normal(parent.status) not in EDITABLE:
                raise _locked_error(_normal(parent.status), ["items"])
        elif isinstance(obj, ChannelRecordLineItem) and not transition_mode:
            parent = obj.parent or _identity_parent(
                session, ChannelRecord, getattr(obj, "channel_record_id", None)
            )
            if parent is not None and _normal(parent.status) not in EDITABLE:
                raise _locked_error(_normal(parent.status), ["items"])

    for obj in list(session.dirty):
        if isinstance(obj, ReconciliationRecord):
            old = _old_status(obj)
            status_history = inspect(obj).attrs.status.history
            if status_history.has_changes() and not transition_mode:
                raise _status_error(old, _normal(obj.status))
            if old not in EDITABLE and not transition_mode:
                changed = _changed_protected(obj, RD_PROTECTED)
                if changed:
                    raise _locked_error(old, changed)
        elif isinstance(obj, ChannelRecord):
            old = _old_status(obj)
            status_history = inspect(obj).attrs.status.history
            if status_history.has_changes() and not transition_mode:
                raise _status_error(old, _normal(obj.status))
            if old not in EDITABLE and not transition_mode:
                changed = _changed_protected(obj, CHANNEL_PROTECTED)
                if changed:
                    raise _locked_error(old, changed)
        elif isinstance(obj, ReconciliationLineItem):
            parent = obj.reconciliation
            if parent is not None and _normal(parent.status) not in EDITABLE and not transition_mode:
                raise _locked_error(_normal(parent.status), ["items"])
        elif isinstance(obj, ChannelRecordLineItem):
            parent = obj.parent
            if parent is not None and _normal(parent.status) not in EDITABLE and not transition_mode:
                raise _locked_error(_normal(parent.status), ["items"])

    for obj in list(session.deleted):
        if isinstance(obj, ReconciliationRecord):
            current = _normal(obj.status)
            if current not in EDITABLE and not transition_mode:
                raise _locked_error(current)
        elif isinstance(obj, ChannelRecord):
            current = _normal(obj.status)
            if current not in EDITABLE and not transition_mode:
                raise _locked_error(current)
        elif isinstance(obj, ReconciliationLineItem):
            parent = obj.reconciliation
            if parent is not None and _normal(parent.status) not in EDITABLE and not transition_mode:
                raise _locked_error(_normal(parent.status), ["items"])
        elif isinstance(obj, ChannelRecordLineItem):
            parent = obj.parent
            if parent is not None and _normal(parent.status) not in EDITABLE and not transition_mode:
                raise _locked_error(_normal(parent.status), ["items"])


@event.listens_for(Session, "do_orm_execute")
def enforce_bulk_line_delete(orm_execute_state) -> None:
    """Guard Core DELETE used by bill update endpoints when replacing all line items."""
    if not orm_execute_state.is_delete:
        return
    session = orm_execute_state.session
    if session.info.get("allow_lifecycle_transition"):
        return

    statement = orm_execute_state.statement
    table = getattr(statement, "table", None)
    table_name = getattr(table, "name", "")
    if table_name == ReconciliationLineItem.__tablename__:
        parent_id = _bulk_delete_parent_id(statement, "reconciliation_id")
        if not parent_id:
            return
        current = session.connection().execute(
            select(ReconciliationRecord.__table__.c.status).where(
                ReconciliationRecord.__table__.c.id == parent_id
            )
        ).scalar_one_or_none()
        if current is not None and _normal(current) not in EDITABLE:
            raise _locked_error(_normal(current), ["items"])
    elif table_name == ChannelRecordLineItem.__tablename__:
        parent_id = _bulk_delete_parent_id(statement, "channel_record_id")
        if not parent_id:
            return
        current = session.connection().execute(
            select(ChannelRecord.__table__.c.status).where(
                ChannelRecord.__table__.c.id == parent_id
            )
        ).scalar_one_or_none()
        if current is not None and _normal(current) not in EDITABLE:
            raise _locked_error(_normal(current), ["items"])
