function datePart(value) {
  if (value) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getFullYear()
      const month = String(parsed.getMonth() + 1).padStart(2, '0')
      const day = String(parsed.getDate()).padStart(2, '0')
      return `${year}${month}${day}`
    }
  }
  return ''
}

function monthPart(value) {
  const match = String(value || '').match(/^(\d{4})(?:-|年)\s*(\d{1,2})/)
  if (!match) return ''
  return `${match[1]}${String(Number(match[2])).padStart(2, '0')}01`
}

/**
 * Builds a stable, human-readable channel bill number without changing legacy data.
 * API records use their creation date and immutable UUID; local records fall back to
 * their settlement month and local id.
 */
export function getChannelBillNumber(record) {
  const existing = String(record?.billNumber || '').trim()
  if (existing) return existing

  const date = datePart(record?.createdAt) || monthPart(record?.settlementMonth) || '00000000'
  const compactId = String(record?.id || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
  const suffix = compactId.slice(-6).padStart(6, '0')
  return `QD-${date}-${suffix}`
}
