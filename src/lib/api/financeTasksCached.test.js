import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client.ts', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }))

import { apiGet, apiPost } from '@/lib/api/client.ts'
import {
  clearFinanceTaskReadCache,
  getFinanceTaskSummary,
  getInvoiceRequestStatuses,
  submitChannelInvoiceRequest
} from './financeTasksCached.ts'

describe('finance task read cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearFinanceTaskReadCache()
  })

  it('deduplicates equivalent bill status reads regardless of id order', async () => {
    apiGet.mockResolvedValue({ items: [{ bill_id: '1', status: 'pending' }] })

    const first = getInvoiceRequestStatuses(['2', '1'])
    const second = getInvoiceRequestStatuses(['1', '2'])
    await Promise.all([first, second])
    await getInvoiceRequestStatuses(['2', '1'])

    expect(apiGet).toHaveBeenCalledTimes(1)
  })

  it('invalidates cached statuses and summary after a task mutation', async () => {
    apiGet.mockResolvedValue({ items: [] })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ pending_count: 1 })
    apiPost.mockResolvedValue({ id: 'task-1' })

    await getInvoiceRequestStatuses(['1'])
    await getFinanceTaskSummary()
    await submitChannelInvoiceRequest('1')
    await getInvoiceRequestStatuses(['1'])

    expect(apiPost).toHaveBeenCalledTimes(1)
    expect(apiGet).toHaveBeenCalledTimes(3)
  })
})
