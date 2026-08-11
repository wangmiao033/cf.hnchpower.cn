"""Temporary one-time ICBC rebuild service entrypoint."""

from fastapi import FastAPI

from app.api.maintenance_bank_rebuild import router as maintenance_bank_rebuild_router

app = FastAPI(title="ICBC Rebuild Maintenance", docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(maintenance_bank_rebuild_router, prefix="/api/maintenance-bank-rebuild")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "icbc-rebuild-maintenance"}
