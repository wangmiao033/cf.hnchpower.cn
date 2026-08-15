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
// 自动归档执行会完整遍历账单并再次计算归档资格；React store 在一次业务操作后
// 可能连续刷新多次。5 秒仅抑制 auto 缓存过期后的紧邻重复扫描，普通归档状态仍实时读取。
const AUTO_SCAN_DEBOUNCE_MS = 5_000
const cache = new Map<string, { value: BillArchiveSnapshot; expiresAt: number }>()
const inflight = new Map<string, Promise<BillArchiveSnapshot>>()
const lastAutoScanAt = new Map<'rd' | 'channel', number>()

function cacheKey(billType: 'rd' | 'channel', auto: boolean) {
  return `${billType}:${auto ? 'auto' : 'read'}`
}

function readFreshCache(key: string, now: number) {
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) return cached.value
  if (cached) cache.delete(key)
  return null
}

export function clearBillArchiveSnapshotCache(billType?: 'rd' | 'channel') {
  if (!billType) {
    cache.clear()
    inflight.clear()
    lastAutoScanAt.clear()
    return
  }
  for (const key of cache.keys()) if (key.startsWith(`${billType}:`)) cache.delete(key)
  for (const key of inflight.keys()) if (key.startsWith(`${billType}:`)) inflight.delete(key)
  // 手工归档/取消归档后允许下一次读取立即重新执行自动规则，保持原业务语义。
  lastAutoScanAt.delete(billType)
}

export function getBillArchiveSnapshot(billType: 'rd' | 'channel', auto = true) {
  const now = Date.now()
  const autoKey = cacheKey(billType, true)

  // 原有语义优先：同一轮 auto 请求必须先复用正在进行的请求或 3 秒结果缓存。
  // 这样多个组件/刷新同时读取时仍只发一次请求。
  if (auto) {
    const cachedAuto = readFreshCache(autoKey, now)
    if (cachedAuto) return Promise.resolve(cachedAuto)
    const runningAuto = inflight.get(autoKey)
    if (runningAuto) return runningAuto
  }

  const previousAutoScan = lastAutoScanAt.get(billType) || 0
  const effectiveAuto = Boolean(auto && now - previousAutoScan >= AUTO_SCAN_DEBOUNCE_MS)
  const key = cacheKey(billType, effectiveAuto)
  const cached = readFreshCache(key, now)
  if (cached) return Promise.resolve(cached)
  const running = inflight.get(key)
  if (running) return running

  if (effectiveAuto) lastAutoScanAt.set(billType, now)
  const query = new URLSearchParams({ bill_type: billType, auto: effectiveAuto ? 'true' : 'false' })
  const request = apiGet<BillArchiveSnapshot>(`/api/bill-lifecycle/archive?${query.toString()}`)
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + TTL_MS })
      return value
    })
    .catch((error) => {
      // 自动扫描请求失败时不占用防抖窗口，下一次读取可以立即重试。
      if (effectiveAuto) lastAutoScanAt.delete(billType)
      throw error
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
