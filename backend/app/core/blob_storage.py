"""Private Vercel Blob helpers for durable serverless attachments."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from urllib.parse import quote

from fastapi import HTTPException
from fastapi.responses import Response, StreamingResponse
from vercel.blob import AsyncBlobClient

MAX_SERVER_UPLOAD_BYTES = 4 * 1024 * 1024


def _token() -> str:
    token = os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip()
    if not token:
        raise HTTPException(status_code=503, detail="附件私有存储尚未配置")
    return token


async def upload_private_blob(pathname: str, body: bytes, content_type: str) -> str:
    if len(body) > MAX_SERVER_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail={
                "error": "file_too_large",
                "max_bytes": MAX_SERVER_UPLOAD_BYTES,
                "message": "单个附件暂不能超过 4MB",
            },
        )
    client = AsyncBlobClient(token=_token())
    try:
        blob = await client.put(
            pathname,
            body,
            access="private",
            content_type=content_type or "application/octet-stream",
            add_random_suffix=False,
            overwrite=False,
        )
        return blob.url
    finally:
        await client.aclose()


async def delete_private_blob(url_or_path: str) -> None:
    if not url_or_path:
        return
    client = AsyncBlobClient(token=_token())
    try:
        await client.delete(url_or_path)
    finally:
        await client.aclose()


async def private_blob_response(
    url_or_path: str,
    *,
    file_name: str,
    content_type: str | None = None,
    inline: bool = True,
) -> Response:
    client = AsyncBlobClient(token=_token())
    try:
        result = await client.get(url_or_path, access="private")
    except Exception:
        await client.aclose()
        raise

    if result is None or result.status_code != 200:
        await client.aclose()
        raise HTTPException(status_code=404, detail={"error": "file_missing"})

    blob = getattr(result, "blob", None)
    result_content_type = getattr(result, "content_type", None) or getattr(
        blob, "content_type", None
    )
    response_content_type = content_type or result_content_type or "application/octet-stream"
    disposition = "inline" if inline else "attachment"
    encoded_name = quote(file_name, safe="")
    headers = {
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{encoded_name}",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    }

    result_stream = getattr(result, "stream", None)
    if result_stream is not None:

        async def stream() -> AsyncIterator[bytes]:
            try:
                async for chunk in result_stream:
                    yield chunk
            finally:
                await client.aclose()

        return StreamingResponse(stream(), media_type=response_content_type, headers=headers)

    result_content = getattr(result, "content", None)
    await client.aclose()
    if result_content is None:
        raise HTTPException(status_code=404, detail={"error": "file_missing"})

    return Response(content=result_content, media_type=response_content_type, headers=headers)
