import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client.ts', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn()
}))

import { apiGet, apiPost } from '@/lib/api/client.ts'
import {
  clearBillInvoiceSummaryCache,
  createBillInvoiceAllocation,
  getBillInvoiceSummary
} from './billInvoiceAllocationsCached.ts'

const summary = {
  bill_type: 'channel',
  bill_id: 'bill-1',
  bill_amount: 100,
  allocated_amount: 20,
  remaining_amount: 80,
  coverage_percent: 20,
  coverage_status: 'partial',
  allocations: [],
  candidates: []
}

describe('bill invoice summary read cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearBillInvoiceSummaryCache()
  })

  it('deduplicates concurrent reads and reuses a recent result', async () => {
    apiGet.mockResolvedValue(summary)

    const first = getBillInvoiceSummary('channel', 'bill-1')
    const second = getBillInvoiceSummary('channel', 'bill-1')
    await expect(first).resolves.toEqual(summary)
    await expect(second).resolves.toEqual(summary)
    await expect(getBillInvoiceSummary('channel', 'bill-1')).resolves.toEqual(summary)

    expect(apiGet).toHaveBeenCalledTimes(1)
  })

  it('invalidates the affected bill after creating an allocation', async () => {
    apiGet.mockResolvedValue(summary)
    apiPost.mockResolvedValue({ id: 'allocation-1' })

    await getBillInvoiceSummary('channel', 'bill-1')
    await createBillInvoiceAllocation({
      bill_type: 'channel',
      bill_id: 'bill-1',
      invoice_id: 'invoice-1',
      allocated_gross_amount: 20
    })
    await getBillInvoiceSummary('channel', 'bill-1')

    expect(apiGet).toHaveBeenCalledTimes(2)
  })
})
