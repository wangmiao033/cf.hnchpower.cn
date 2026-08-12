import { apiPost } from '@/lib/api/client.ts'

const DEFAULT_TTL_MS = 60_000
const valueCache = new Map<string, { value: unknown; expiresAt: number }>()
const inflightCache = new Map<string, Promise<unknown>>()

export type Bill360QuickSdkKey = {
  key: string
  settlement_month: string
  game_name: string
}

export type Bill360QuickSdkRow = {
  key: string
  settlement_month: string
  game_name: string
  row_count: number
  channel_count: number
  source_game_count: number
  total_flow: number
  top_channel: string | null
  top_channel_flow: number
}

export function peekBill360Resource<T>(key: string): T | null {
  const normalized = String(key || '').trim()
  if (!normalized) return null
  const entry = valueCache.get(normalized)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    valueCache.delete(normalized)
    return null
  }
  return entry.value as T
}

export function primeBill360Resource<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): T {
  const normalized = String(key || '').trim()
  if (!normalized) return value
  valueCache.set(normalized, {
    value,
    expiresAt: Date.now() + Math.max(1_000, Number(ttlMs) || DEFAULT_TTL_MS)
  })
  return value
}

export async function loadBill360Resource<T>(
  key: string,
  loader: () => Promise<T>,
  options: { ttlMs?: number; force?: boolean } = {}
): Promise<T> {
  const normalized = String(key || '').trim()
  if (!normalized) return loader()

  if (!options.force) {
    const cached = peekBill360Resource<T>(normalized)
    if (cached !== null) return cached
    const inflight = inflightCache.get(normalized)
    if (inflight) return inflight as Promise<T>
  }

  const request = Promise.resolve()
    .then(loader)
    .then((value) => primeBill360Resource(normalized, value, options.ttlMs))
    .finally(() => {
      if (inflightCache.get(normalized) === request) inflightCache.delete(normalized)
    })

  inflightCache.set(normalized, request)
  return request
}

export function scheduleBill360Idle(callback: () => void, timeout = 900): () => void {
  if (typeof window === 'undefined') return () => {}
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout })
    return () => window.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(callback, Math.min(timeout, 350))
  return () => window.clearTimeout(id)
}

export function getBill360QuickSdkSummary(keys: Bill360QuickSdkKey[]): Promise<Bill360QuickSdkRow[]> {
  const normalized = (keys || [])
    .map((item) => ({
      key: String(item?.key || '').trim(),
      settlement_month: String(item?.settlement_month || '').trim(),
      game_name: String(item?.game_name || '').trim()
    }))
    .filter((item) => item.key && item.settlement_month && item.game_name)
    .slice(0, 40)

  if (!normalized.length) return Promise.resolve([])
  const signature = normalized.map((item) => item.key).sort().join('|')
  return loadBill360Resource(
    `quicksdk:${signature}`,
    () => apiPost<{ items: Bill360QuickSdkRow[] }>('/api/reconciliation/bill360-quicksdk-summary', { keys: normalized })
      .then((result) => result.items || []),
    { ttlMs: 120_000 }
  )
}

export function clearBill360ResourceCache(prefix = '') {
  const normalized = String(prefix || '').trim()
  if (!normalized) {
    valueCache.clear()
    inflightCache.clear()
    return
  }
  for (const key of valueCache.keys()) {
    if (key.startsWith(normalized)) valueCache.delete(key)
  }
  for (const key of inflightCache.keys()) {
    if (key.startsWith(normalized)) inflightCache.delete(key)
  }
}
