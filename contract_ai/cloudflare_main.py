"""Cloudflare Workers AI-backed contract smart intake entrypoint.

The existing contract service remains the source of truth for authentication,
internal contract numbering and database access. This entrypoint creates an
explicit FastAPI app for Vercel's Python handler discovery, copies the stable
contract routes, and only replaces /api/contracts/smart-scan.
"""

from __future__ import annotations

import base64
import io
import json
import os
from pathlib import PurePath
from typing import Any

import httpx
import pypdfium2 as pdfium
from fastapi import FastAPI, HTTPException, Request
from PIL import Image

try:
    from .extraction import CONTRACT_SCAN_SCHEMA, SYSTEM_PROMPT, normalize_contract_scan_result
    from .main import (
        SCAN_EXTENSIONS,
        SCAN_MAX_BYTES,
        _require_contract_manage,
        _safe_filename,
        app as _base_app,
    )
except ImportError:  # Vercel service root loads this module as a top-level module.
    from extraction import CONTRACT_SCAN_SCHEMA, SYSTEM_PROMPT, normalize_contract_scan_result
    from main import (
        SCAN_EXTENSIONS,
        SCAN_MAX_BYTES,
        _require_contract_manage,
        _safe_filename,
        app as _base_app,
    )

# Vercel's Python builder discovers handlers statically. Keep an explicit
# top-level FastAPI assignment here instead of only importing ``app`` from
# another module. Stable contract routes are copied below, then smart-scan is
# replaced with the Cloudflare implementation.
app = FastAPI(
    title="contract-smart-intake-cloudflare",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.router.routes.extend(list(_base_app.router.routes))

CLOUDFLARE_WORKERS_AI_MODEL = (
    os.environ.get("CLOUDFLARE_WORKERS_AI_MODEL", "@cf/google/gemma-4-26b-a4b-it").strip()
    or "@cf/google/gemma-4-26b-a4b-it"
)
CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4/accounts"
PDF_RENDER_MAX_LONG_EDGE = 1680
PDF_RENDER_JPEG_QUALITY = 84
PDF_MAX_PAGES_PER_REQUEST = 32


def _workers_ai_config() -> tuple[str, str]:
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    api_token = os.environ.get("CLOUDFLARE_WORKERS_AI_TOKEN", "").strip()
    if not account_id or not api_token:
        raise HTTPException(
            status_code=503,
            detail="Cloudflare Workers AI 尚未配置，请先设置账号 ID 和 API Token",
        )
    return account_id, api_token


def _jpeg_data_uri(data: bytes) -> str:
    return f"data:image/jpeg;base64,{base64.b64encode(data).decode('ascii')}"


def _image_data_uri(content_type: str, data: bytes) -> str:
    mime = str(content_type or "image/jpeg").split(";", 1)[0].strip().lower()
    if mime not in {"image/jpeg", "image/png", "image/webp"}:
        mime = "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def _render_pdf_pages(body: bytes) -> list[bytes]:
    """Render a scanned/text PDF into ordered JPEG pages for vision OCR."""

    try:
        document = pdfium.PdfDocument(body)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="PDF 无法读取或已加密，请先解除密码后再识别") from exc

    try:
        page_count = len(document)
        if page_count <= 0:
            raise HTTPException(status_code=422, detail="PDF 中没有可识别页面")
        if page_count > PDF_MAX_PAGES_PER_REQUEST:
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
                scale = max(1.25, min(2.6, PDF_RENDER_MAX_LONG_EDGE / long_edge))
                bitmap = page.render(scale=scale)
                try:
                    image = bitmap.to_pil().convert("RGB")
                finally:
                    try:
                        bitmap.close()
                    except Exception:
                        pass

                if max(image.size) > PDF_RENDER_MAX_LONG_EDGE:
                    image.thumbnail(
                        (PDF_RENDER_MAX_LONG_EDGE, PDF_RENDER_MAX_LONG_EDGE),
                        Image.Resampling.LANCZOS,
                    )

                output = io.BytesIO()
                image.save(
                    output,
                    format="JPEG",
                    quality=PDF_RENDER_JPEG_QUALITY,
                    optimize=True,
                )
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


def _workers_ai_payload(
    file_name: str,
    content_type: str,
    body: bytes,
) -> tuple[dict[str, Any], int]:
    extension = PurePath(file_name).suffix.lower()
    user_content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                f"请识别合同文件“{file_name}”。图片按合同原始页码顺序排列。"
                "必须阅读可见文字、印章附近文字、表格和条款；不要补全文件里没有的信息。"
                "请严格按 response_format 的 JSON Schema 返回候选字段。"
            ),
        }
    ]

    if extension == ".pdf" or content_type == "application/pdf":
        images = _render_pdf_pages(body)
        for index, image_bytes in enumerate(images):
            user_content.append({"type": "text", "text": f"第 {index + 1} 页"})
            user_content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": _jpeg_data_uri(image_bytes)},
                }
            )
        page_count = len(images)
    else:
        user_content.append(
            {
                "type": "image_url",
                "image_url": {"url": _image_data_uri(content_type, body)},
            }
        )
        page_count = 1

    return (
        {
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": CONTRACT_SCAN_SCHEMA,
            },
            "temperature": 0.1,
            "max_completion_tokens": 6000,
            "stream": False,
        },
        page_count,
    )


def parse_workers_ai_result(payload: Any) -> dict[str, Any]:
    """Extract structured JSON from Cloudflare REST or OpenAI-compatible shapes."""

    if not isinstance(payload, dict):
        raise ValueError("Cloudflare Workers AI 返回格式异常")

    result: Any = payload.get("result", payload)
    if isinstance(result, dict):
        response = result.get("response")
        if isinstance(response, dict):
            return response
        if isinstance(response, str) and response.strip():
            try:
                parsed = json.loads(response)
            except json.JSONDecodeError as exc:
                raise ValueError("Cloudflare Workers AI 返回的 JSON 无法解析") from exc
            if isinstance(parsed, dict):
                return parsed

        choices = result.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0] if isinstance(choices[0], dict) else {}
            message = first.get("message") if isinstance(first, dict) else None
            if isinstance(message, dict):
                parsed = message.get("parsed")
                if isinstance(parsed, dict):
                    return parsed
                content = message.get("content")
                if isinstance(content, str) and content.strip():
                    try:
                        parsed_content = json.loads(content)
                    except json.JSONDecodeError as exc:
                        raise ValueError("Cloudflare Workers AI 返回的 JSON 无法解析") from exc
                    if isinstance(parsed_content, dict):
                        return parsed_content

    if isinstance(result, str) and result.strip():
        try:
            parsed = json.loads(result)
        except json.JSONDecodeError as exc:
            raise ValueError("Cloudflare Workers AI 返回的 JSON 无法解析") from exc
        if isinstance(parsed, dict):
            return parsed

    raise ValueError("Cloudflare Workers AI 没有返回结构化合同字段")


def _cloudflare_error_message(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    errors = payload.get("errors")
    if isinstance(errors, list):
        messages = [
            str(item.get("message") or "").strip()
            for item in errors
            if isinstance(item, dict) and str(item.get("message") or "").strip()
        ]
        if messages:
            return "；".join(messages[:3])
    error = payload.get("error")
    if isinstance(error, dict):
        return str(error.get("message") or "").strip()
    if isinstance(error, str):
        return error.strip()
    return ""


def _replace_legacy_smart_scan_route() -> None:
    app.router.routes[:] = [
        route
        for route in app.router.routes
        if getattr(route, "path", None) != "/api/contracts/smart-scan"
    ]


_replace_legacy_smart_scan_route()


@app.post("/api/contracts/smart-scan")
async def smart_scan_contract_cloudflare(request: Request) -> dict[str, Any]:
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
