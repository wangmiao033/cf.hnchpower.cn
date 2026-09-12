"""Standalone PDF-to-JPEG renderer for contract AI.

This service intentionally has no database access and no knowledge of the
reconciliation system. It accepts a PDF body, renders ordered JPEG pages, and
returns base64-encoded images for the existing contract AI pipeline.
"""

from __future__ import annotations

import base64
import io
import os

import pypdfium2 as pdfium
from fastapi import FastAPI, HTTPException, Request
from PIL import Image

app = FastAPI(title="contract-pdf-renderer", docs_url=None, redoc_url=None, openapi_url=None)

MAX_BODY_BYTES = 4 * 1024 * 1024
MAX_PAGES = 32
MAX_LONG_EDGE = 1680
JPEG_QUALITY = 84
RENDERER_TOKEN = os.environ.get("PDF_RENDERER_TOKEN", "").strip()


def _require_token(request: Request) -> None:
    if not RENDERER_TOKEN:
        raise HTTPException(status_code=503, detail="PDF renderer token is not configured")
    supplied = request.headers.get("x-renderer-token", "").strip()
    if not supplied or supplied != RENDERER_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _render_pdf_pages(body: bytes) -> list[bytes]:
    try:
        document = pdfium.PdfDocument(body)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="PDF 无法读取或已加密，请先解除密码后再识别") from exc

    try:
        page_count = len(document)
        if page_count <= 0:
            raise HTTPException(status_code=422, detail="PDF 中没有可识别页面")
        if page_count > MAX_PAGES:
            raise HTTPException(
                status_code=413,
                detail=f"当前 PDF 分段包含 {page_count} 页，请重新选择文件后让系统自动分段识别",
            )

        rendered: list[bytes] = []
        for page_index in range(page_count):
            page = document[page_index]
            try:
                width, height = page.get_size()
                long_edge = max(float(width or 1), float(height or 1))
                scale = max(1.25, min(2.6, MAX_LONG_EDGE / long_edge))
                bitmap = page.render(scale=scale)
                try:
                    image = bitmap.to_pil().convert("RGB")
                finally:
                    try:
                        bitmap.close()
                    except Exception:
                        pass

                if max(image.size) > MAX_LONG_EDGE:
                    image.thumbnail((MAX_LONG_EDGE, MAX_LONG_EDGE), Image.Resampling.LANCZOS)

                output = io.BytesIO()
                image.save(output, format="JPEG", quality=JPEG_QUALITY, optimize=True)
                rendered.append(output.getvalue())
            finally:
                try:
                    page.close()
                except Exception:
                    pass
        return rendered
    finally:
        try:
            document.close()
        except Exception:
            pass


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "service": "contract-pdf-renderer", "max_pages": MAX_PAGES}


@app.post("/render")
async def render(request: Request) -> dict[str, object]:
    _require_token(request)

    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="Only application/pdf is supported")

    content_length = int(request.headers.get("content-length") or 0)
    if content_length > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds renderer size limit")

    body = await request.body()
    if not body:
        raise HTTPException(status_code=422, detail="PDF content is empty")
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds renderer size limit")

    pages = _render_pdf_pages(body)
    return {
        "pages": [
            {
                "index": index + 1,
                "jpeg_base64": base64.b64encode(page).decode("ascii"),
            }
            for index, page in enumerate(pages)
        ]
    }
