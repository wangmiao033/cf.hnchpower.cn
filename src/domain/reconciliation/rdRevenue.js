/** Explicit revenue only: blank/missing/invalid input must never become zero. */
export function parseRdRevenue(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function requireRdRevenue(value) {
  const parsed = parseRdRevenue(value)
  if (parsed === null) throw new Error('后台流水须明确填写有效的非负数字（零收入请填 0）')
  return parsed
}
