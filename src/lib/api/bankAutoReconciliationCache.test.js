import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client.ts', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }))

import { apiGet, apiPost } from '@/lib/api/client.ts'
import {
  allocateBankTransaction,
  clearBankDashboardCache,
  getBankMultiAllocationDashboard
} from './bankAutoReconciliation.ts'

describe('bank dashboard read cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearBankDashboardCache()
  })

  it('deduplicates concurrent dashboard reads and reuses an immediate repeat', async () => {
    apiGet.mockResolvedValue({ stats: {}, suggestions: [] })
    const first = getBankMultiAllocationDashboard(500)
    const second = getBankMultiAllocationDashboard(500)
    await Promise.all([first, second])
    await getBankMultiAllocationDashboard(500)
    expect(apiGet).toHaveBeenCalledTimes(1)
  })

  it('invalidates dashboards after an allocation write', async () => {
    apiGet.mockResolvedValue({ stats: {}, suggestions: [] })
    apiPost.mockResolvedValue({ matches: [], transaction: {}, message: 'ok' })
    await getBankMultiAllocationDashboard(500)
    await allocateBankTransaction('tx-1', [{ bill_type: 'channel', bill_id: 'b1', amount: 10 }])
    await getBankMultiAllocationDashboard(500)
    expect(apiGet).toHaveBeenCalledTimes(2)
  })
})
