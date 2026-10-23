import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('./client.ts', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), apiPostMultipart: vi.fn() }))
import { apiGet } from './client.ts'
import { listAllChannelRecords } from './channel.ts'
beforeEach(() => vi.resetAllMocks())

it('reads every page including a server page smaller than the requested limit', async () => {
  const rows = Array.from({ length: 1007 }, (_, i) => ({ id: String(i) }))
  const offsets = []
  apiGet.mockImplementation(async path => {
    const query = new URLSearchParams(path.split('?')[1])
    expect(query.get('limit')).toBe('500')
    const offset = Number(query.get('offset')); offsets.push(offset)
    return { items: rows.slice(offset, offset + 200), total: rows.length }
  })
  expect((await listAllChannelRecords()).items).toEqual(rows)
  expect(offsets).toEqual([0, 200, 400, 600, 800, 1000])
})
it('returns a valid empty ledger', async () => {
  apiGet.mockResolvedValue({ items: [], total: 0 })
  expect(await listAllChannelRecords()).toEqual({ items: [], total: 0 })
})
it('rejects a later-page failure instead of publishing a partial total', async () => {
  apiGet.mockResolvedValueOnce({ items: [{ id: 'a' }], total: 2 }).mockRejectedValueOnce(new Error('offline'))
  await expect(listAllChannelRecords()).rejects.toThrow('offline')
})
it.each([
  { items: [], total: 2 },
  { items: [{ id: 'a' }], total: 2 },
  { items: [{ id: 'b' }], total: 3 },
  { items: [{ id: '' }], total: 2 },
  { items: [{ id: 'b' }, { id: 'c' }], total: 2 },
  { items: [{ id: 'b' }], total: undefined }
])('rejects incomplete, repeated or changing pages: %j', async page => {
  apiGet.mockResolvedValueOnce({ items: [{ id: 'a' }], total: 2 }).mockResolvedValueOnce(page)
  await expect(listAllChannelRecords()).rejects.toThrow()
  expect(apiGet).toHaveBeenCalledTimes(2)
})
