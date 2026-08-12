export const CHANNEL_ALIAS_STORAGE_KEY = 'channel-inline-aliases-v1'

export function normalizeInlineKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/\s+/g, '')
}

export function emptyAliasMemory() {
  return { game: {}, channel: {} }
}

export function loadAliasMemory(storage = typeof window !== 'undefined' ? window.localStorage : null) {
  if (!storage) return emptyAliasMemory()
  try {
    const raw = JSON.parse(storage.getItem(CHANNEL_ALIAS_STORAGE_KEY) || '{}')
    return {
      game: raw?.game && typeof raw.game === 'object' ? raw.game : {},
      channel: raw?.channel && typeof raw.channel === 'object' ? raw.channel : {}
    }
  } catch {
    return emptyAliasMemory()
  }
}

export function rememberAlias(memory, type, alias, canonical) {
  const next = {
    game: { ...(memory?.game || {}) },
    channel: { ...(memory?.channel || {}) }
  }
  const aliasKey = normalizeInlineKey(alias)
  const canonicalValue = String(canonical || '').trim()
  if (!aliasKey || !canonicalValue || !['game', 'channel'].includes(type)) return next
  next[type][aliasKey] = canonicalValue
  return next
}

export function persistAliasMemory(memory, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  if (!storage) return
  try {
    storage.setItem(CHANNEL_ALIAS_STORAGE_KEY, JSON.stringify(memory || emptyAliasMemory()))
  } catch {
    // Local alias memory is an efficiency aid; storage failure must not block reconciliation.
  }
}

export function resolveAlias(memory, type, value) {
  const raw = String(value || '').trim()
  if (!raw || !['game', 'channel'].includes(type)) return raw
  return String(memory?.[type]?.[normalizeInlineKey(raw)] || raw).trim()
}

const PENDING_LINE_RE = /^【待补资料·([^】]+)】\s*(.*)$/

export function parsePendingNotes(remark) {
  const items = []
  const cleanLines = []
  String(remark || '').split(/\r?\n/).forEach((line) => {
    const match = line.trim().match(PENDING_LINE_RE)
    if (!match) {
      if (line.trim()) cleanLines.push(line)
      return
    }
    items.push({ key: match[1].trim(), note: match[2].trim() })
  })
  return { cleanRemark: cleanLines.join('\n').trim(), items }
}

export function updatePendingNote(remark, key, note) {
  const { cleanRemark, items } = parsePendingNotes(remark)
  const target = String(key || '').trim()
  const normalizedNote = String(note || '').replace(/[\r\n]+/g, ' ').trim()
  const next = items.filter((item) => normalizeInlineKey(item.key) !== normalizeInlineKey(target))
  if (target && normalizedNote) next.push({ key: target, note: normalizedNote })
  return [
    cleanRemark,
    ...next.map((item) => `【待补资料·${item.key}】${item.note}`)
  ].filter(Boolean).join('\n')
}
