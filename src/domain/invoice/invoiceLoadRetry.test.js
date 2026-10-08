import { describe, expect, it, vi } from 'vitest'
import { isRetryableInvoiceReadError, readInvoiceWithRetry } from './invoiceLoadRetry.js'

describe('发票列表初次加载保护', () => {
  it('retries network or transient server errors, never authorization failures', () => {
    for (const status of [0, 408, 429, 502, 503]) {
      expect(isRetryableInvoiceReadError({ status })).toBe(true)
    }
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryableInvoiceReadError({ status })).toBe(false)
    }
  })
  it('returns recovered invoice data rather than treating the list as empty', async () => {
    const read = vi.fn().mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce({ items: [{ id: 'invoice-1' }] })
    const wait = vi.fn(async () => {})
    const result = await readInvoiceWithRetry(read, { delays: [10, 20], wait })
    expect(result.items).toHaveLength(1)
    expect(read).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledWith(10)
  })
  it('does not repeat forbidden requests', async () => {
    const read = vi.fn().mockRejectedValue({ status: 403 })
    await expect(readInvoiceWithRetry(read)).rejects.toEqual({ status: 403 })
    expect(read).toHaveBeenCalledTimes(1)
  })
  it('stops after a bounded number of retry attempts', async () => {
    const read = vi.fn().mockRejectedValue({ status: 502 })
    await expect(readInvoiceWithRetry(read, { delays: [1, 1], wait: async () => {} })).rejects.toEqual({ status: 502 })
    expect(read).toHaveBeenCalledTimes(3)
  })
})
