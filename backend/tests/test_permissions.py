import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.services.permissions import (
    ALL_PERMISSIONS,
    normalize_role,
    permission_catalog_payload,
    resolve_permissions,
    role_permissions,
    set_user_access,
)


class FakeDb:
    def __init__(self):
        self.deleted = []
        self.added = []

    def execute(self, statement):
        self.deleted.append(statement)
        return SimpleNamespace()

    def add(self, row):
        self.added.append(row)


class PermissionRulesTest(unittest.TestCase):
    def test_legacy_user_maps_to_operator(self):
        self.assertEqual(normalize_role("user"), "operator")
        self.assertEqual(normalize_role("operator"), "operator")

    def test_admin_always_has_all_permissions(self):
        user = SimpleNamespace(id="u-admin", role="admin")
        with patch("app.services.permissions.load_permission_overrides", return_value={"funds.manage": "deny"}):
            resolved = resolve_permissions(SimpleNamespace(), user)
        self.assertEqual(resolved, set(ALL_PERMISSIONS))

    def test_viewer_has_no_manage_permissions(self):
        permissions = role_permissions("viewer")
        self.assertTrue(any(code.endswith(".view") for code in permissions))
        self.assertFalse(any(code.endswith(".manage") for code in permissions))

    def test_operator_can_view_audit_but_not_manage_funds(self):
        permissions = role_permissions("operator")
        self.assertIn("audit.view", permissions)
        self.assertIn("reconciliation.manage", permissions)
        self.assertNotIn("funds.manage", permissions)

    def test_user_override_allow_and_deny_win_over_role(self):
        user = SimpleNamespace(id="u-op", role="operator")
        with patch(
            "app.services.permissions.load_permission_overrides",
            return_value={"funds.view": "allow", "data.manage": "deny"},
        ):
            resolved = resolve_permissions(SimpleNamespace(), user)
        self.assertIn("funds.view", resolved)
        self.assertNotIn("data.manage", resolved)

    def test_invalid_override_is_rejected(self):
        db = FakeDb()
        user = SimpleNamespace(id="u1", role="operator")
        with self.assertRaises(HTTPException) as context:
            set_user_access(
                db,
                user,
                role="operator",
                overrides={"unknown.permission": "allow"},
            )
        self.assertEqual(context.exception.status_code, 422)

    def test_permission_catalog_has_all_roles(self):
        payload = permission_catalog_payload()
        roles = {row["role"] for row in payload["roles"]}
        self.assertEqual(roles, {"admin", "finance", "operator", "viewer"})


if __name__ == "__main__":
    unittest.main()
