const DEFAULT_TTL_MS = 45_000

const valueCache = new Map()
const inflightCache = new Map()

function cacheKey(kind, id) {
  return `${String(kind || '').trim()}:${String(id || '').trim()}`
}

export function getCachedEditRecord(kind, id) {
  const key = cacheKey(kind, id)
  if (!key || key.endsWith(':')) return null

  const entry = valueCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    valueCache.delete(key)
    return null
  }
  return entry.value
}

export async function loadEditRecord(
  kind,
  id,
  loader,
  { force = false, ttlMs = DEFAULT_TTL_MS } = {}
) {
  const key = cacheKey(kind, id)
  if (!key || key.endsWith(':')) throw new Error('缺少账单编号')
  if (typeof loader !== 'function') throw new Error('缺少账单加载器')

  if (!force) {
    const cached = getCachedEditRecord(kind, id)
    if (cached) return cached
    const inflight = inflightCache.get(key)
    if (inflight) return inflight
  }

  const request = Promise.resolve()
    .then(loader)
    .then((value) => {
      valueCache.set(key, {
        value,
        expiresAt: Date.now() + Math.max(1_000, Number(ttlMs) || DEFAULT_TTL_MS)
      })
      return value
    })
    .finally(() => {
      if (inflightCache.get(key) === request) inflightCache.delete(key)
    })

  inflightCache.set(key, request)
  return request
}

export function prefetchEditRecord(kind, id, loader, options) {
  return loadEditRecord(kind, id, loader, options).catch(() => null)
}

export function invalidateEditRecord(kind, id) {
  const key = cacheKey(kind, id)
  valueCache.delete(key)
  inflightCache.delete(key)
}

export function clearEditRecordCache() {
  valueCache.clear()
  inflightCache.clear()
}
