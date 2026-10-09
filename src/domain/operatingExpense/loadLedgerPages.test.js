import { describe, expect, it, vi } from 'vitest'
import { fetchEveryLedgerPage } from './loadLedgerPages.js'

describe('financial ledger pagination safety', () => {
  const records = Array.from({ length: 8 }, (_, idx) => ({ id: String(idx + 1), amount: idx + 1 }))
  const mockPage = vi.fn(async ({ offset, limit }) => ({
    total: records.length,
    items: records.slice(offset, offset + limit),
    amount_total: 36
  }))

  it('accumulates every page rather than hiding amounts after page 1', async () => {
    const result = await fetchEveryLedgerPage(mockPage, { pageSize: 3 })
    expect(result.items).toEqual(records)
    expect(result.total).toBe(8)
    expect(result.amount_total).toBe(36)
    expect(mockPage).toHaveBeenCalledWith({ offset: 6, limit: 3 })
  })

  it('returns empty ledgers safely', async () => {
    const value = await fetchEveryLedgerPage(async () => ({ total: 0, items: [] }))
    expect(value.items).toEqual([])
  })

  it('does not show partial totals when pagination fails or changes mid-read', async () => {
    await expect(fetchEveryLedgerPage(async ({ offset }) => ({
      total: 5,
      items: offset ? [] : records.slice(0, 2)
    }), { pageSize: 2 })).rejects.toThrow('数据发生变化')
    await expect(fetchEveryLedgerPage(async ({ offset }) => ({
      total: offset ? 6 : 5,
      items: records.slice(offset, offset + 2)
    }), { pageSize: 2 })).rejects.toThrow('数据发生变化')
  })

  it('rejects repeated row IDs and malformed reported totals', async () => {
    await expect(fetchEveryLedgerPage(async ({ offset }) => ({
      total: 4, items: offset ? records.slice(0, 2) : records.slice(0, 2)
    }), { pageSize: 2 })).rejects.toThrow('重复财务记录')
    await expect(fetchEveryLedgerPage(async () => ({ total: 1, items: records.slice(0, 2) }))).rejects.toThrow('分页数据异常')
  })
})
