from app.services.permissions import role_permissions


def test_finance_role_is_separated_from_business_editing():
    permissions = role_permissions("finance")
    assert "finance_tasks.view" in permissions
    assert "finance_tasks.manage" in permissions
    assert "invoices.manage" in permissions
    assert "funds.manage" in permissions
    assert "reconciliation.view" in permissions
    assert "reconciliation.manage" not in permissions
    assert "contracts.manage" not in permissions
    assert "partners.manage" not in permissions


def test_operator_can_submit_invoice_request_but_not_process_finance_queue():
    permissions = role_permissions("operator")
    assert "invoice_requests.submit" in permissions
    assert "reconciliation.manage" in permissions
    assert "finance_tasks.view" not in permissions
    assert "finance_tasks.manage" not in permissions
