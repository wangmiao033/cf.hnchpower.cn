import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearBill360ResourceCache,
  loadBill360Resource,
  peekBill360Resource,
  primeBill360Resource
} from './bill360Performance.ts'

describe('Bill360 performance resource cache', () => {
  beforeEach(() => {
    clearBill360ResourceCache()
  })

  it('reuses a recently primed resource without another request', async () => {
    primeBill360Resource('invoice:rd:1', { allocated_amount: 123 }, 60_000)
    expect(peekBill360Resource('invoice:rd:1')).toEqual({ allocated_amount: 123 })

    const loader = vi.fn(async () => ({ allocated_amount: 456 }))
    const result = await loadBill360Resource('invoice:rd:1', loader)

    expect(result).toEqual({ allocated_amount: 123 })
    expect(loader).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent requests for the same Bill360 resource', async () => {
    let resolveLoader
    const loader = vi.fn(() => new Promise((resolve) => { resolveLoader = resolve }))

    const first = loadBill360Resource('contracts:partner-a', loader)
    const second = loadBill360Resource('contracts:partner-a', loader)

    expect(loader).toHaveBeenCalledTimes(1)
    resolveLoader([{ id: 'contract-1' }])

    await expect(first).resolves.toEqual([{ id: 'contract-1' }])
    await expect(second).resolves.toEqual([{ id: 'contract-1' }])
    expect(peekBill360Resource('contracts:partner-a')).toEqual([{ id: 'contract-1' }])
  })

  it('force refresh bypasses the cached value and replaces it', async () => {
    primeBill360Resource('contract-check:channel:1', { version: 1 }, 60_000)
    const loader = vi.fn(async () => ({ version: 2 }))

    const result = await loadBill360Resource('contract-check:channel:1', loader, { force: true })

    expect(loader).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ version: 2 })
    expect(peekBill360Resource('contract-check:channel:1')).toEqual({ version: 2 })
  })
})
