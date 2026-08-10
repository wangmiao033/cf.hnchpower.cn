/**
 * 前端统一 HTTP 客户端（研发对账等模块复用）
 */

/// <reference types="vite/client" />

const rawBase = (import.meta.env.VITE_API_BASE_URL || '').trim()

export const API_BASE_URL = rawBase.replace(/\/$/, '')
export const AUTH_UNAUTHORIZED_EVENT = 'cf:auth-unauthorized'

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const UPLOAD_REQUEST_TIMEOUT_MS = 90_000
const RECENT_API_ERROR_MAX_AGE_MS = 2_500

let lastApiError = { message: '', at: 0 }

type ApiRequestOptions = {
  timeoutMs?: number
}

export class ApiError extends Error {
  status: number
  body: unknown
  requestId: string
  errorCode: string
  userMessage: string

  constructor(
    message: string,
    status: number,
    body: unknown,
    requestId = '',
    errorCode = ''
  ) {
    const userMessage = String(message || '').trim() || '请求失败，请稍后重试。'
    const diagnostic = formatApiDiagnosticMessage(userMessage, errorCode, requestId)
    super(diagnostic)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.requestId = requestId
    this.errorCode = errorCode
    this.userMessage = userMessage
  }
}

export function formatApiDiagnosticMessage(message: string, errorCode = '', requestId = ''): string {
  const base = String(message || '').trim() || '请求失败，请稍后重试。'
  const parts = []
  if (errorCode) parts.push(`错误码 ${errorCode}`)
  if (requestId) parts.push(`请求 ${requestId}`)
  return parts.length ? `${base}（${parts.join(' · ')}）` : base
}

function makeRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `REQ-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
    }
  } catch {
    // Fall back below for restricted browsers/webviews.
  }
  return `REQ-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 20)
}

function rememberApiError(message: string) {
  const normalized = String(message || '').trim()
  if (!normalized) return
  lastApiError = { message: normalized, at: Date.now() }
}

/**
 * 供旧页面的笼统错误 Toast 使用：只返回刚刚发生的 API 错误，避免拿很久以前的错误覆盖当前提示。
 */
export function getRecentApiErrorMessage(maxAgeMs = RECENT_API_ERROR_MAX_AGE_MS): string {
  if (!lastApiError.message) return ''
  if (Date.now() - lastApiError.at > maxAgeMs) return ''
  return lastApiError.message
}

/** 将 fetch 网络层异常转为 ApiError，便于登录页等统一展示中文说明 */
function toNetworkApiError(err: unknown, requestId = ''): ApiError {
  if (err instanceof ApiError) return err
  if (err instanceof Error && err.name === 'AbortError') {
    const apiError = new ApiError('请求超时，请稍后重试。', 0, err, requestId, 'NET-TIMEOUT')
    rememberApiError(apiError.message)
    return apiError
  }
  const msg =
    err instanceof TypeError ||
    (err instanceof Error &&
      /fetch|Failed to fetch|NetworkError|Load failed|网络/i.test(err.message))
      ? '无法连接服务器，请检查网络或稍后再试。'
      : err instanceof Error
        ? err.message
        : '请求失败，请稍后重试。'
  const apiError = new ApiError(msg, 0, err, requestId, 'NET-REQUEST')
  rememberApiError(apiError.message)
  return apiError
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  requestId = ''
) {
  if (!timeoutMs || timeoutMs <= 0) {
    try {
      return await fetch(input, init)
    } catch (e) {
      throw toNetworkApiError(e, requestId)
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (e) {
    throw toNetworkApiError(e, requestId)
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

function requestHeaders(requestId: string, extra?: HeadersInit): HeadersInit {
  return { 'X-Request-ID': requestId, ...(extra || {}) }
}

export async function apiGet<T>(path: string, options?: ApiRequestOptions): Promise<T> {
  const requestId = makeRequestId()
  const res = await fetchWithTimeout(
    joinUrl(path),
    { method: 'GET', credentials: 'include', headers: requestHeaders(requestId) },
    options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    requestId
  )
  return parseResponse<T>(res, requestId)
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  options?: ApiRequestOptions
): Promise<T> {
  const requestId = makeRequestId()
  const res = await fetchWithTimeout(
    joinUrl(path),
    {
      method: 'POST',
      credentials: 'include',
      headers: requestHeaders(requestId, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    },
    options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    requestId
  )
  return parseResponse<T>(res, requestId)
}

export async function apiPut<T>(
  path: string,
  body: unknown,
  options?: ApiRequestOptions
): Promise<T> {
  const requestId = makeRequestId()
  const res = await fetchWithTimeout(
    joinUrl(path),
    {
      method: 'PUT',
      credentials: 'include',
      headers: requestHeaders(requestId, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    },
    options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    requestId
  )
  return parseResponse<T>(res, requestId)
}

export async function apiDelete(path: string, options?: ApiRequestOptions): Promise<void> {
  const requestId = makeRequestId()
  const res = await fetchWithTimeout(
    joinUrl(path),
    { method: 'DELETE', credentials: 'include', headers: requestHeaders(requestId) },
    options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    requestId
  )
  if (res.status === 204) return
  await parseResponse<unknown>(res, requestId)
}

/** multipart/form-data（不设置 Content-Type，由浏览器带 boundary） */
export async function apiPostMultipart<T>(
  path: string,
  formData: FormData,
  options?: ApiRequestOptions
): Promise<T> {
  const requestId = makeRequestId()
  const res = await fetchWithTimeout(
    joinUrl(path),
    {
      method: 'POST',
      credentials: 'include',
      headers: requestHeaders(requestId),
      body: formData
    },
    options?.timeoutMs ?? UPLOAD_REQUEST_TIMEOUT_MS,
    requestId
  )
  return parseResponse<T>(res, requestId)
}

function responseErrorMessage(data: unknown, statusText: string): string {
  if (data && typeof data === 'object' && data !== null) {
    if ('message' in data && typeof (data as { message?: unknown }).message === 'string') {
      const message = String((data as { message: string }).message).trim()
      if (message) return message
    }
    if ('detail' in data) {
      const rawDetail = (data as { detail: unknown }).detail
      if (typeof rawDetail === 'string') return rawDetail
      if (
        rawDetail &&
        typeof rawDetail === 'object' &&
        'message' in rawDetail &&
        typeof (rawDetail as { message?: unknown }).message === 'string'
      ) {
        return String((rawDetail as { message: string }).message).trim()
      }
      try {
        return JSON.stringify(rawDetail)
      } catch {
        return String(rawDetail)
      }
    }
  }
  if (typeof data === 'string') return data
  return statusText
}

function responseErrorCode(data: unknown, res: Response): string {
  const headerCode = String(res.headers.get('X-Error-Code') || '').trim()
  if (headerCode) return headerCode
  if (data && typeof data === 'object' && data !== null) {
    const direct = (data as { error_code?: unknown; error?: unknown }).error_code ||
      (data as { error?: unknown }).error
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
    const detail = (data as { detail?: unknown }).detail
    if (detail && typeof detail === 'object') {
      const nested = (detail as { error_code?: unknown; error?: unknown }).error_code ||
        (detail as { error?: unknown }).error
      if (typeof nested === 'string' && nested.trim()) return nested.trim()
    }
  }
  return res.status ? `HTTP-${res.status}` : 'REQUEST-ERROR'
}

function responseRequestId(data: unknown, res: Response, fallback: string): string {
  const headerId = String(res.headers.get('X-Request-ID') || '').trim()
  if (headerId) return headerId
  if (data && typeof data === 'object' && data !== null && 'request_id' in data) {
    const value = String((data as { request_id?: unknown }).request_id || '').trim()
    if (value) return value
  }
  return fallback
}

export async function parseResponse<T>(res: Response, localRequestId = ''): Promise<T> {
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

    const detail = responseErrorMessage(data, res.statusText)
    const message = detail || res.statusText || '请求失败，请稍后重试。'
    const errorCode = responseErrorCode(data, res)
    const requestId = responseRequestId(data, res, localRequestId)
    const error = new ApiError(message, res.status, data, requestId, errorCode)
    rememberApiError(error.message)
    throw error
  }
  return data as T
}
