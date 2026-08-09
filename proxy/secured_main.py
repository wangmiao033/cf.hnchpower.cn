"""Vercel entrypoint that adds RBAC in front of the legacy contract proxy app."""

from main import app
from contract_authz import contract_permission_middleware

app.middleware("http")(contract_permission_middleware)
