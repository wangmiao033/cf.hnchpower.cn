/**
 * 前端统一 HTTP 客户端（研发对账等模块复用）
 */

/// <reference types="vite/client" />

const rawBase = (import.meta.env.VITE_API_BASE_URL || '').trim()

export const API_BASE_URL = rawBase.replace(/\/$/, '')
export const AUTH_UNAUTHORIZED_EVENT = 'cf:auth-unauthorized'

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const UPLOAD_REQUEST_TIMEOUT_MS = 90_000

type ApiRequestOptions = {
  timeoutMs?: number
}

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/** 将 fetch 网络层异常转为 ApiError，便于登录页等统一展示中文说明 */
function toNetworkApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (err instanceof Error && err.name === 'AbortError') {
    return new ApiError('请求超时，请稍后重试。', 0, err)
  }
  const msg =
    err instanceof TypeError ||
    (err instanceof Error &&
      /fetch|Failed to fetch|NetworkError|Load failed|网络/i.test(err.message))
      ? '无法连接服务器，请检查网络或稍后再试。'
      : err instanceof Error
        ? err.message
        : '请求失败，请稍后重试。'
  return new ApiError(msg, 0, err)
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
) {
  if (!timeoutMs || timeoutMs <= 0) {
    try {
      return await fetch(input, init)
    } catch (e) {
      throw toNetworkApiError(e)
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (e) {
    throw toNetworkApiError(e)
  } finally {
    clearTimeout(timer)
  }
}

function joinUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL}${p}`
}

function notifyUnauthorized() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT))
}

export async function apiGet<T>(path: string, options?: ApiRequestOptions): Promise<T> {
  const res = await fetchWithTimeout(
    joinUrl(path),
    { method: 'GET', credentials: 'include' },
    options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  )
  return parseResponse<T>(res)
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  options?: ApiRequestOptions
): Promise<T> {
  const res = await fetchWithTimeout(
    joinUrl(path),
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    },
    options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  )
  return parseResponse<T>(res)
}

export async function apiPut<T>(
  path: string,
  body: unknown,
  options?: ApiRequestOptions
): Promise<T> {
  const res = await fetchWithTimeout(
    joinUrl(path),
    {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    },
    options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  )
  return parseResponse<T>(res)
}

export async function apiDelete(path: string, options?: ApiRequestOptions): Promise<void> {
  const res = await fetchWithTimeout(
    joinUrl(path),
    { method: 'DELETE', credentials: 'include' },
    options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  )
  if (res.status === 204) return
  await parseResponse<unknown>(res)
}

/** multipart/form-data（不设置 Content-Type，由浏览器带 boundary） */
export async function apiPostMultipart<T>(
  path: string,
  formData: FormData,
  options?: ApiRequestOptions
): Promise<T> {
  const res = await fetchWithTimeout(
    joinUrl(path),
    {
      method: 'POST',
      credentials: 'include',
      body: formData
    },
    options?.timeoutMs ?? UPLOAD_REQUEST_TIMEOUT_MS
  )
  return parseResponse<T>(res)
}

export async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text) as unknown
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized()

    const detail =
      data && typeof data === 'object' && data !== null && 'detail' in data
        ? (() => {
            const rawDetail = (data as { detail: unknown }).detail
            if (typeof rawDetail === 'string') return rawDetail
            try {
              return JSON.stringify(rawDetail)
            } catch {
              return String(rawDetail)
            }
          })()
        : typeof data === 'string'
          ? data
          : res.statusText
    throw new ApiError(detail || res.statusText, res.status, data)
  }
  return data as T
}
