import { describe, expect, it } from 'vitest'

import { ApiError, getRecentApiErrorMessage, parseResponse } from './client.ts'

describe('API error messages', () => {
  it('prefers detail.message for structured 409 responses', async () => {
    const response = new Response(
      JSON.stringify({
        detail: {
          error: 'bill_locked',
          message: '账单已核对并锁定。需要修改金额或业务字段时，请先退回“待核对”。'
        }
      }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      }
    )

    let caught = null
    try {
      await parseResponse(response)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ApiError)
    expect(caught?.message).toBe('账单已核对并锁定。需要修改金额或业务字段时，请先退回“待核对”。')
    expect(getRecentApiErrorMessage()).toBe(caught?.message)
  })

  it('keeps a plain string detail readable', async () => {
    const response = new Response(JSON.stringify({ detail: '当前账号没有权限' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    })

    await expect(parseResponse(response)).rejects.toMatchObject({
      status: 403,
      message: '当前账号没有权限'
    })
  })
})
