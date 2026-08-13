import { apiDelete, apiGet, apiPost } from '@/lib/api/client.ts'

export type BillArchiveItem = {
  bill_id: string
  archived_at: string | null
  archived_by_email: string | null
  archive_source: 'manual' | 'auto' | string
  closure_at: string | null
}

export type BillArchiveSnapshot = {
  bill_type: 'rd' | 'channel'
  archived_ids: string[]
  eligible_ids: string[]
  items: BillArchiveItem[]
  auto_archived_count: number
  auto_archive_days: number
}

const TTL_MS = 3_000
const cache = new Map<string, { value: BillArchiveSnapshot; expiresAt: number }>()
const inflight = new Map<string, Promise<BillArchiveSnapshot>>()

function cacheKey(billType: 'rd' | 'channel', auto: boolean) {
  return `${billType}:${auto ? 'auto' : 'read'}`
}

export function clearBillArchiveSnapshotCache(billType?: 'rd' | 'channel') {
  if (!billType) {
    cache.clear()
    inflight.clear()
    return
  }
  for (const key of cache.keys()) if (key.startsWith(`${billType}:`)) cache.delete(key)
  for (const key of inflight.keys()) if (key.startsWith(`${billType}:`)) inflight.delete(key)
}

export function getBillArchiveSnapshot(billType: 'rd' | 'channel', auto = true) {
  const key = cacheKey(billType, auto)
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
  if (cached) cache.delete(key)
  const running = inflight.get(key)
  if (running) return running

  const query = new URLSearchParams({ bill_type: billType, auto: auto ? 'true' : 'false' })
  const request = apiGet<BillArchiveSnapshot>(`/api/bill-lifecycle/archive?${query.toString()}`)
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + TTL_MS })
      return value
    })
    .finally(() => {
      if (inflight.get(key) === request) inflight.delete(key)
    })
  inflight.set(key, request)
  return request
}

export function archiveBill(billType: 'rd' | 'channel', billId: string) {
  return apiPost(`/api/bill-lifecycle/archive/${encodeURIComponent(billType)}/${encodeURIComponent(billId)}`, {})
    .then((result) => {
      clearBillArchiveSnapshotCache(billType)
      return result
    })
}

export function unarchiveBill(billType: 'rd' | 'channel', billId: string) {
  return apiDelete(`/api/bill-lifecycle/archive/${encodeURIComponent(billType)}/${encodeURIComponent(billId)}`)
    .then((result) => {
      clearBillArchiveSnapshotCache(billType)
      return result
    })
}
