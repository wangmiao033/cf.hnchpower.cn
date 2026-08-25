import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client.ts', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }))

import { apiGet } from '@/lib/api/client.ts'
import { clearBankDashboardCache, getBankBillMatchSuggestions } from './bankAutoReconciliation.ts'

describe('bill-scoped bank matching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearBankDashboardCache()
  })

  it('uses the targeted bill endpoint with a short timeout', async () => {
    apiGet.mockResolvedValue({ stats: {}, suggestions: [] })
    await getBankBillMatchSuggestions('channel', 'bill 1', 8)
    expect(apiGet).toHaveBeenCalledWith(
      '/api/bank-auto-reconciliation/p2/bills/channel/bill%201/suggestions?limit=8',
      { timeoutMs: 8000 }
    )
  })

  it('deduplicates immediate reads for the same bill', async () => {
    apiGet.mockResolvedValue({ stats: {}, suggestions: [] })
    await Promise.all([
      getBankBillMatchSuggestions('channel', 'bill-1', 8),
      getBankBillMatchSuggestions('channel', 'bill-1', 8)
    ])
    expect(apiGet).toHaveBeenCalledTimes(1)
  })
})
