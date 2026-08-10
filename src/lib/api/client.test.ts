import { describe, expect, it } from 'vitest'
import { ApiError, apiErrorDiagnosticMessage, formatApiDiagnosticMessage } from './client.ts'

describe('API diagnostics', () => {
  it('adds error code and request id to user-visible diagnostics', () => {
    expect(formatApiDiagnosticMessage('核销失败', 'HTTP-409', 'REQ-abc123')).toBe(
      '核销失败（错误码 HTTP-409 · 请求 REQ-abc123）'
    )
  })

  it('keeps legacy message readable and exposes structured diagnostics', () => {
    const error = new ApiError('数据库查询失败', 500, { error: 'database_error' }, 'REQ-1', 'DB-500')
    expect(error.status).toBe(500)
    expect(error.requestId).toBe('REQ-1')
    expect(error.errorCode).toBe('DB-500')
    expect(error.message).toBe('数据库查询失败')
    expect(error.diagnosticMessage).toContain('请求 REQ-1')
    expect(apiErrorDiagnosticMessage(error)).toBe(error.diagnosticMessage)
  })
})
