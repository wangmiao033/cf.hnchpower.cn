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
import re
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
EXTRACTION_TOOL_NAME = "submit_contract_extraction"
_REQUIRED_RESULT_KEYS = {"contract", "confidence", "evidence", "parties", "access_items"}


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
    """Build a Gemma request that forces a schema-shaped function call.

    Cloudflare JSON Mode does not currently list Gemma 4 among its guaranteed
    models, while Gemma 4 explicitly supports both Vision and Function Calling.
    Using one required tool therefore gives us a more reliable structured
    extraction contract than asking the model to print JSON in normal text.
    """

    extension = PurePath(file_name).suffix.lower()
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
        page_count,
    )


def _looks_like_contract_result(value: Any) -> bool:
    return isinstance(value, dict) and _REQUIRED_RESULT_KEYS.issubset(value.keys())


def _parse_json_text(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None

    # Models sometimes wrap JSON in Markdown fences even when told not to.
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.IGNORECASE | re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()

    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    # Last-resort compatibility: find the first valid JSON object embedded in
    # explanatory prose without attempting regex-based brace matching.
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character != "{":
            continue
        try:
            parsed, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _tool_arguments(call: Any) -> dict[str, Any] | None:
    if not isinstance(call, dict):
        return None

    # OpenAI-compatible shape:
    # {"type":"function","function":{"name":"...","arguments":"{...}"}}
    function = call.get("function")
    if isinstance(function, dict):
        name = str(function.get("name") or "").strip()
        arguments = function.get("arguments")
        if name and name != EXTRACTION_TOOL_NAME:
            return None
        if isinstance(arguments, dict):
            return arguments
        parsed = _parse_json_text(arguments)
        if parsed is not None:
            return parsed

    # Traditional Workers AI shape:
    # {"name":"...","arguments": {...}}
    name = str(call.get("name") or "").strip()
    arguments = call.get("arguments")
    if name and name != EXTRACTION_TOOL_NAME:
        return None
    if isinstance(arguments, dict):
        return arguments
    parsed = _parse_json_text(arguments)
    if parsed is not None:
        return parsed
    return None


def _candidate_from_tool_calls(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, list):
        return None
    for call in value:
        arguments = _tool_arguments(call)
        if arguments is not None and _looks_like_contract_result(arguments):
            return arguments
    return None


def _walk_for_contract_result(value: Any, *, depth: int = 0) -> dict[str, Any] | None:
    """Compatibility parser for Cloudflare response envelope variations."""

    if depth > 8:
        return None
    if _looks_like_contract_result(value):
        return value

    if isinstance(value, dict):
        tool_result = _candidate_from_tool_calls(value.get("tool_calls"))
        if tool_result is not None:
            return tool_result

        # Prefer fields known to carry model output before generic recursion.
        for key in ("response", "parsed", "arguments", "output_text", "content"):
            child = value.get(key)
            if isinstance(child, dict) and _looks_like_contract_result(child):
                return child
            parsed = _parse_json_text(child)
            if parsed is not None and _looks_like_contract_result(parsed):
                return parsed
            nested = _walk_for_contract_result(child, depth=depth + 1)
            if nested is not None:
                return nested

        for child in value.values():
            nested = _walk_for_contract_result(child, depth=depth + 1)
            if nested is not None:
                return nested
        return None

    if isinstance(value, list):
        tool_result = _candidate_from_tool_calls(value)
        if tool_result is not None:
            return tool_result
        for child in value:
            nested = _walk_for_contract_result(child, depth=depth + 1)
            if nested is not None:
                return nested
        return None

    parsed = _parse_json_text(value)
    if parsed is not None and _looks_like_contract_result(parsed):
        return parsed
    return None


def _payload_shape(value: Any, *, depth: int = 0) -> Any:
    """Return key/type metadata only, never contract text or secret values."""

    if depth >= 3:
        return type(value).__name__
    if isinstance(value, dict):
        return {
            str(key): _payload_shape(child, depth=depth + 1)
            for key, child in list(value.items())[:20]
        }
    if isinstance(value, list):
        return [
            _payload_shape(child, depth=depth + 1)
            for child in value[:3]
        ]
    return type(value).__name__


def parse_workers_ai_result(payload: Any) -> dict[str, Any]:
    """Extract the contract object from Workers AI/tool-call response shapes."""

    if not isinstance(payload, dict):
        raise ValueError("Cloudflare Workers AI 返回格式异常")

    parsed = _walk_for_contract_result(payload)
    if parsed is not None:
        return parsed

    # Helpful for future provider changes, while deliberately avoiding logging
    # any model text, contract content, token or image data.
    try:
        print(
            "Cloudflare Workers AI unparsed response shape:",
            json.dumps(_payload_shape(payload), ensure_ascii=False)[:4000],
        )
    except Exception:
        pass
    raise ValueError("Cloudflare Workers AI 返回了内容，但未能提取结构化合同字段，请重新扫描")


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
