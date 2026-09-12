"""Vercel entrypoint that enforces contract RBAC before smart-scan routes."""

from external_renderer_main import app
from contract_authz import contract_permission_middleware

app.middleware("http")(contract_permission_middleware)
