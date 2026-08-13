import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client.ts', () => ({ apiGet: vi.fn() }))

import { apiGet } from '@/lib/api/client.ts'
import { clearInternalContractNumbersCache, listInternalContractNumbers } from './contractNumbers.ts'

describe('internal contract number cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearInternalContractNumbersCache()
  })

  it('deduplicates concurrent reads and reuses an immediate repeat', async () => {
    apiGet.mockResolvedValue({ items: [{ contract_id: 'c1', internal_contract_no: 'HT-1' }], total: 1 })

    const first = listInternalContractNumbers()
    const second = listInternalContractNumbers()
    await Promise.all([first, second])
    await listInternalContractNumbers()

    expect(apiGet).toHaveBeenCalledTimes(1)
  })
})
