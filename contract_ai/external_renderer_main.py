"""Contract AI entrypoint with an optional external PDF renderer.

Phase 1 is intentionally fail-safe: when the renderer is not configured or any
renderer request fails, PDF rendering falls back to the existing in-process
implementation. The public smart-scan route and response shape stay unchanged.
"""

from __future__ import annotations

import base64
import os
from pathlib import PurePath
from typing import Any

import httpx
from fastapi import HTTPException, Request

from cloudflare_main import (
    CLOUDFLARE_API_BASE,
    CLOUDFLARE_WORKERS_AI_MODEL,
    CONTRACT_SCAN_SCHEMA,
    EXTRACTION_TOOL_NAME,
    PDF_MAX_PAGES_PER_REQUEST,
    SCAN_EXTENSIONS,
    SCAN_MAX_BYTES,
    SYSTEM_PROMPT,
    _cloudflare_error_message,
    _jpeg_data_uri,
    _render_pdf_pages,
    _require_contract_manage,
    _safe_filename,
    _workers_ai_config,
    _workers_ai_payload,
    app,
    normalize_contract_scan_result,
    parse_workers_ai_result,
)

PDF_RENDERER_URL = os.environ.get("PDF_RENDERER_URL", "").strip()
PDF_RENDERER_TOKEN = os.environ.get("PDF_RENDERER_TOKEN", "").strip()
PDF_RENDERER_MAX_JPEG_BYTES = 8 * 1024 * 1024


def _renderer_enabled() -> bool:
    return bool(PDF_RENDERER_URL and PDF_RENDERER_TOKEN)


def _decode_renderer_pages(payload: Any) -> list[bytes]:
    if not isinstance(payload, dict):
        raise ValueError("PDF renderer returned an invalid response")
    raw_pages = payload.get("pages")
    if not isinstance(raw_pages, list) or not raw_pages:
        raise ValueError("PDF renderer returned no pages")
    if len(raw_pages) > PDF_MAX_PAGES_PER_REQUEST:
        raise ValueError("PDF renderer returned too many pages")

    pages: list[bytes] = []
    for expected_index, item in enumerate(raw_pages, start=1):
        if not isinstance(item, dict):
            raise ValueError("PDF renderer page entry is invalid")
        index = int(item.get("index") or expected_index)
        if index != expected_index:
            raise ValueError("PDF renderer page order is invalid")
        encoded = item.get("jpeg_base64")
        if not isinstance(encoded, str) or not encoded:
            raise ValueError("PDF renderer page data is missing")
        try:
            decoded = base64.b64decode(encoded, validate=True)
        except Exception as exc:
            raise ValueError("PDF renderer page data is invalid") from exc
        if not decoded or len(decoded) > PDF_RENDERER_MAX_JPEG_BYTES:
            raise ValueError("PDF renderer page size is invalid")
        if not decoded.startswith(b"\xff\xd8\xff"):
            raise ValueError("PDF renderer returned a non-JPEG page")
        pages.append(decoded)
    return pages


async def _render_pdf_pages_external(body: bytes) -> list[bytes]:
    if not _renderer_enabled():
        raise RuntimeError("external renderer is not configured")

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=20.0)) as client:
            response = await client.post(
                PDF_RENDERER_URL,
                headers={
                    "Content-Type": "application/pdf",
                    "X-Renderer-Token": PDF_RENDERER_TOKEN,
                },
                content=body,
            )
    except httpx.HTTPError as exc:
        raise RuntimeError("external renderer connection failed") from exc

    if response.status_code >= 400:
        raise RuntimeError(f"external renderer HTTP {response.status_code}")
    try:
        payload: Any = response.json()
    except Exception as exc:
        raise RuntimeError("external renderer returned non-JSON data") from exc
    return _decode_renderer_pages(payload)


async def _render_pdf_pages_resilient(body: bytes) -> list[bytes]:
    if not _renderer_enabled():
        return _render_pdf_pages(body)

    try:
        pages = await _render_pdf_pages_external(body)
        print(f"External PDF renderer used successfully: {len(pages)} page(s)")
        return pages
    except Exception as exc:
        # Never log contract contents, tokens, URLs, or response bodies.
        print(f"External PDF renderer unavailable; using local fallback: {type(exc).__name__}")
        return _render_pdf_pages(body)


def _workers_ai_payload_from_pdf_pages(
    file_name: str,
    images: list[bytes],
) -> tuple[dict[str, Any], int]:
    user_content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                f"请识别合同文件“{file_name}”。图片按合同原始页码顺序排列。"
                "必须阅读可见文字、印章附近文字、表格和条款；不要补全文件里没有的信息。"
                f"完成识别后必须调用 {EXTRACTION_TOOL_NAME} 工具提交结果，不要用普通文本代替。"
            ),
        }
    ]
    for index, image_bytes in enumerate(images):
        user_content.append({"type": "text", "text": f"第 {index + 1} 页"})
        user_content.append(
            {
                "type": "image_url",
                "image_url": {"url": _jpeg_data_uri(image_bytes)},
            }
        )

    return (
        {
            "messages": [
                {
                    "role": "system",
                    "content": (
                        SYSTEM_PROMPT
                        + "\n\n你必须通过 submit_contract_extraction 工具返回最终结果；"
                        "工具参数就是最终合同候选字段，不要额外输出 Markdown。"
                    ),
                },
                {"role": "user", "content": user_content},
            ],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": EXTRACTION_TOOL_NAME,
                        "description": "提交从合同原件中提取并核验后的结构化候选字段。",
                        "parameters": CONTRACT_SCAN_SCHEMA,
                    },
                }
            ],
            "tool_choice": "required",
            "parallel_tool_calls": False,
            "temperature": 0.1,
            "max_completion_tokens": 6000,
            "stream": False,
        },
        len(images),
    )


# cloudflare_main already replaces the legacy smart-scan route. Replace only
# that route again here, leaving every other contract route untouched.
app.router.routes[:] = [
    route
    for route in app.router.routes
    if getattr(route, "path", None) != "/api/contracts/smart-scan"
]


@app.post("/api/contracts/smart-scan")
async def smart_scan_contract_cloudflare_external_renderer(request: Request) -> dict[str, Any]:
    _require_contract_manage(request)

    file_name = _safe_filename(request)
    if not file_name:
        raise HTTPException(status_code=422, detail="请选择需要识别的合同文件")
    extension = PurePath(file_name).suffix.lower()
    if extension not in SCAN_EXTENSIONS:
        raise HTTPException(status_code=422, detail="智能识别目前支持 PDF、JPG、PNG、WEBP")

    content_length = int(request.headers.get("content-length") or 0)
    if content_length > SCAN_MAX_BYTES:
        raise HTTPException(status_code=413, detail="当前识别分段超过服务上限，请重新选择文件后重试")
    body = await request.body()
    if not body:
        raise HTTPException(status_code=422, detail="合同文件内容为空")
    if len(body) > SCAN_MAX_BYTES:
        raise HTTPException(status_code=413, detail="当前识别分段超过服务上限，请重新选择文件后重试")

    account_id, api_token = _workers_ai_config()
    content_type = request.headers.get("content-type", "application/octet-stream").split(";", 1)[0].lower()

    if extension == ".pdf" or content_type == "application/pdf":
        images = await _render_pdf_pages_resilient(body)
        payload, page_count = _workers_ai_payload_from_pdf_pages(file_name, images)
    else:
        payload, page_count = _workers_ai_payload(file_name, content_type, body)

    endpoint = f"{CLOUDFLARE_API_BASE}/{account_id}/ai/run/{CLOUDFLARE_WORKERS_AI_MODEL}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=20.0)) as client:
            response = await client.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {api_token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="合同扫描超时，请稍后重试") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Cloudflare Workers AI 连接失败，请稍后重试") from exc

    try:
        cloudflare_payload: Any = response.json()
    except Exception:
        cloudflare_payload = {}

    if response.status_code >= 400 or (
        isinstance(cloudflare_payload, dict) and cloudflare_payload.get("success") is False
    ):
        provider_message = _cloudflare_error_message(cloudflare_payload)
        if response.status_code in {401, 403}:
            raise HTTPException(
                status_code=503,
                detail="Cloudflare Workers AI 凭证无效或权限不足，请检查 Workers AI API Token",
            )
        if response.status_code == 429:
            raise HTTPException(
                status_code=429,
                detail="Cloudflare Workers AI 免费额度已用完或请求过于频繁，请稍后再试",
            )
        if response.status_code >= 500:
            raise HTTPException(status_code=502, detail="Cloudflare Workers AI 暂时不可用，请稍后重试")
        raise HTTPException(
            status_code=502,
            detail=provider_message or f"Cloudflare Workers AI 识别失败（HTTP {response.status_code}）",
        )

    try:
        model_result = parse_workers_ai_result(cloudflare_payload)
        normalized = normalize_contract_scan_result(model_result)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        **normalized,
        "file": {
            "name": file_name,
            "size_bytes": len(body),
            "content_type": content_type,
            "pages": page_count,
        },
        "provider": "cloudflare-workers-ai",
        "model": CLOUDFLARE_WORKERS_AI_MODEL,
    }
