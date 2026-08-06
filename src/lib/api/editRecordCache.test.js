import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearEditRecordCache,
  getCachedEditRecord,
  invalidateEditRecord,
  loadEditRecord
} from './editRecordCache.js'

describe('edit record cache', () => {
  beforeEach(() => {
    clearEditRecordCache()
    vi.restoreAllMocks()
  })

  it('deduplicates simultaneous detail requests', async () => {
    let resolveRequest
    const loader = vi.fn(
      () => new Promise((resolve) => {
        resolveRequest = resolve
      })
    )

    const first = loadEditRecord('rd', 'record-1', loader)
    const second = loadEditRecord('rd', 'record-1', loader)
    await Promise.resolve()

    expect(loader).toHaveBeenCalledTimes(1)
    resolveRequest({ id: 'record-1', amount: 100 })

    await expect(first).resolves.toEqual({ id: 'record-1', amount: 100 })
    await expect(second).resolves.toEqual({ id: 'record-1', amount: 100 })
  })

  it('returns a cached value until it is invalidated', async () => {
    const loader = vi.fn().mockResolvedValue({ id: 'record-2' })

    await loadEditRecord('channel', 'record-2', loader)
    expect(getCachedEditRecord('channel', 'record-2')).toEqual({ id: 'record-2' })

    await loadEditRecord('channel', 'record-2', loader)
    expect(loader).toHaveBeenCalledTimes(1)

    invalidateEditRecord('channel', 'record-2')
    expect(getCachedEditRecord('channel', 'record-2')).toBeNull()

    await loadEditRecord('channel', 'record-2', loader)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('does not retain failed requests', async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ id: 'record-3' })

    await expect(loadEditRecord('rd', 'record-3', loader)).rejects.toThrow('network')
    await expect(loadEditRecord('rd', 'record-3', loader)).resolves.toEqual({ id: 'record-3' })
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
