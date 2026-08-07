from datetime import datetime, timezone
from types import SimpleNamespace

from app.schemas.operation_log import OperationLogRead


def test_operation_log_read_maps_metadata_attribute():
    row = SimpleNamespace(
        id="log-1",
        entity_type="rd",
        entity_id="bill-1",
        entity_number="RD-001",
        action="update",
        summary="修改研发账单",
        actor_user_id="user-1",
        actor_email="finance@example.com",
        changes={"status": {"before": "pending", "after": "confirmed"}},
        metadata_json={"table": "reconciliation_records"},
        created_at=datetime(2026, 8, 7, tzinfo=timezone.utc),
    )

    result = OperationLogRead.model_validate(row)
    assert result.metadata == {"table": "reconciliation_records"}
    assert result.actor_email == "finance@example.com"
    assert result.changes["status"]["after"] == "confirmed"
