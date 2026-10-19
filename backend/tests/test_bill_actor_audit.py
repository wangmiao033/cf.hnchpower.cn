from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from app.core.security import _restore_audit_actor, _set_audit_actor
from app.api.operation_log import get_bill_actor_summary
from app.services.bill_write_preflight import prepare_bill_financial_update, set_bill_audit_reason


def test_actor_context_restored_only_for_authenticated_request_session():
    db = Session()
    db.execute = Mock()
    user = SimpleNamespace(id="creator-1", email="entry@example.com")
    _set_audit_actor(db, user)
    conn = Mock()
    conn.dialect.name = "postgresql"
    for boundary in ("initial", "after_commit", "after_rollback"):
        _restore_audit_actor(db, boundary, conn)
    assert conn.execute.call_count == 3
    assert conn.execute.call_args.args[1] == {"user_id": "creator-1", "email": "entry@example.com"}
    assert "true" in str(conn.execute.call_args.args[0])  # transaction local
    fresh = Session()
    conn.reset_mock()
    _restore_audit_actor(fresh, None, conn)
    conn.execute.assert_not_called()
    db.close()
    fresh.close()


def test_bill_actor_queries_use_whole_bill_history_and_stable_order():
    db = Mock()
    db.execute.return_value.scalars.return_value.first.return_value = None
    result = get_bill_actor_summary("channel", "bill-a", db)
    assert result.entered is None and result.verified is None and result.modified is None
    queries = [str(call.args[0].compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})) for call in db.execute.call_args_list]
    assert len(queries) == 3
    assert all("entity_id = 'bill-a'" in sql and "entity_type = 'channel'" in sql for sql in queries)
    assert "created_at ASC" in queries[0] and "id ASC" in queries[0]
    assert "confirmed" in queries[1] and "created_at DESC" in queries[1]
    assert all("OFFSET" not in sql for sql in queries)


def test_optional_reason_does_not_change_financial_values():
    row = SimpleNamespace(status="pending", updated_at=datetime.now(timezone.utc))
    data = prepare_bill_financial_update("channel", row, {"audit_reason": "凭原账单复核", "remark": "说明"})
    reason = data.pop("audit_reason")
    db = Mock()
    db.get_bind.return_value.dialect.name = "postgresql"
    set_bill_audit_reason(db, reason)
    assert data == {"remark": "说明"}
    assert db.execute.call_args.args[1] == {"reason": "凭原账单复核"}


def test_migration_is_forward_only_and_covers_both_detail_tables():
    sql = (Path(__file__).parents[1] / "sql/075_bill_actor_audit.sql").read_text()
    assert 'AFTER INSERT OR UPDATE OR DELETE ON channel_record_line_items' in sql
    assert 'AFTER INSERT OR UPDATE OR DELETE ON reconciliation_line_items' in sql
    assert "BEFORE UPDATE OR DELETE ON operation_logs" in sql
    assert "app.operation_reason" in sql
    for table in ('channel_records', 'reconciliation_records', 'channel_record_line_items', 'reconciliation_line_items'):
        assert f'UPDATE {table} SET' not in sql
        assert f'DELETE FROM {table}' not in sql
    assert 'INSERT INTO operation_logs' in sql


def load_tests(loader, tests, pattern):
    """Run the same regressions under the repository's unittest CI entrypoint."""
    import unittest
    return unittest.TestSuite(
        unittest.FunctionTestCase(function)
        for name, function in globals().items()
        if name.startswith("test_") and callable(function)
    )
