"""Secured Vercel entrypoint for the DDL-free partner/contract data service."""

from stable_main import app
from contract_authz import contract_permission_middleware

app.middleware("http")(contract_permission_middleware)
