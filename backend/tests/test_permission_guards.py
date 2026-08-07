import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.services.permissions import require_module_access


class FakeRequest:
    def __init__(self, method, path):
        self.method = method
        self.url = SimpleNamespace(path=path)


class PermissionGuardTest(unittest.TestCase):
    def _dependency(self, view, manage=None, path_overrides=None):
        return require_module_access(view, manage, path_overrides=path_overrides)

    def test_get_uses_view_permission(self):
        dep = self._dependency("reconciliation.view", "reconciliation.manage")
        with patch("app.services.permissions.has_permission", side_effect=lambda _db, _user, permission: permission == "reconciliation.view"):
            user = dep(FakeRequest("GET", "/api/reconciliation"), SimpleNamespace(), SimpleNamespace())
        self.assertIsNotNone(user)

    def test_write_uses_manage_permission(self):
        dep = self._dependency("reconciliation.view", "reconciliation.manage")
        with patch("app.services.permissions.has_permission", side_effect=lambda _db, _user, permission: permission == "reconciliation.view"):
            with self.assertRaises(HTTPException) as context:
                dep(FakeRequest("POST", "/api/reconciliation"), SimpleNamespace(), SimpleNamespace())
        self.assertEqual(context.exception.status_code, 403)
        self.assertEqual(context.exception.detail["permission"], "reconciliation.manage")

    def test_partner_path_override_uses_partner_permissions(self):
        dep = self._dependency(
            "contracts.view",
            "contracts.manage",
            path_overrides={"/api/contracts/partners": ("partners.view", "partners.manage")},
        )
        seen = []

        def allowed(_db, _user, permission):
            seen.append(permission)
            return permission == "partners.manage"

        with patch("app.services.permissions.has_permission", side_effect=allowed):
            dep(FakeRequest("POST", "/api/contracts/partners"), SimpleNamespace(), SimpleNamespace())
        self.assertEqual(seen[-1], "partners.manage")

    def test_contract_write_does_not_use_partner_override(self):
        dep = self._dependency(
            "contracts.view",
            "contracts.manage",
            path_overrides={"/api/contracts/partners": ("partners.view", "partners.manage")},
        )
        seen = []

        def allowed(_db, _user, permission):
            seen.append(permission)
            return permission == "contracts.manage"

        with patch("app.services.permissions.has_permission", side_effect=allowed):
            dep(FakeRequest("POST", "/api/contracts"), SimpleNamespace(), SimpleNamespace())
        self.assertEqual(seen[-1], "contracts.manage")


if __name__ == "__main__":
    unittest.main()
