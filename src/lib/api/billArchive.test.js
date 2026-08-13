import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client.ts', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }))

import { apiGet, apiPost } from '@/lib/api/client.ts'
import {
  archiveBill,
  clearBillArchiveSnapshotCache,
  getBillArchiveSnapshot
} from './billArchive.ts'

const snapshot = {
  bill_type: 'channel',
  archived_ids: [],
  eligible_ids: ['b1'],
  items: [],
  auto_archived_count: 0,
  auto_archive_days: 7
}

describe('bill archive snapshot cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearBillArchiveSnapshotCache()
  })

  it('deduplicates repeated snapshot reads', async () => {
    apiGet.mockResolvedValue(snapshot)
    const first = getBillArchiveSnapshot('channel', true)
    const second = getBillArchiveSnapshot('channel', true)
    await Promise.all([first, second])
    await getBillArchiveSnapshot('channel', true)
    expect(apiGet).toHaveBeenCalledTimes(1)
  })

  it('invalidates the bill type after archive mutation', async () => {
    apiGet.mockResolvedValue(snapshot)
    apiPost.mockResolvedValue({ archived: true })
    await getBillArchiveSnapshot('channel', true)
    await archiveBill('channel', 'b1')
    await getBillArchiveSnapshot('channel', true)
    expect(apiGet).toHaveBeenCalledTimes(2)
  })
})
