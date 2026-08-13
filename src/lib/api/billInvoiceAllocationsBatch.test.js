import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client.ts', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn()
}))

import { apiGet, apiPost } from '@/lib/api/client.ts'
import { clearBillInvoiceSummaryCache, getBillInvoiceSummary } from './billInvoiceAllocationsCoalesced.ts'

describe('bill invoice list read coalescing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearBillInvoiceSummaryCache()
  })

  it('collapses different bills requested together into one overview request', async () => {
    apiPost.mockResolvedValue({
      items: [
        { key: 'channel:1', bill_type: 'channel', bill_id: '1', bill_amount: 100, allocated_amount: 25, remaining_amount: 75, coverage_percent: 25, coverage_status: 'partial' },
        { key: 'channel:2', bill_type: 'channel', bill_id: '2', bill_amount: 200, allocated_amount: 200, remaining_amount: 0, coverage_percent: 100, coverage_status: 'complete' }
      ]
    })

    const [first, second] = await Promise.all([
      getBillInvoiceSummary('channel', '1'),
      getBillInvoiceSummary('channel', '2')
    ])

    expect(apiPost).toHaveBeenCalledTimes(1)
    expect(apiGet).not.toHaveBeenCalled()
    expect(first.coverage_percent).toBe(25)
    expect(second.coverage_percent).toBe(100)
    expect(first.candidates).toEqual([])
  })
})
