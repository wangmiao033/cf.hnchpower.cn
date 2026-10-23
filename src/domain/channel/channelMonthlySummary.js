import { normalizeChannelSettlementCycle } from './channelBillingForm.js'
import { getChannelTotals } from './channelAggregates.js'

const validMonth = value => {
  const month = normalizeChannelSettlementCycle(value)
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(month) ? month : ''
}
const cents = value => {
  if (value == null || String(value).trim() === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) : null
}

/** Read saved amounts only. Follow the existing month model: line period,
 * then the bill period for legacy undated lines. Never allocate receipts,
 * adjustments or a multi-month header total proportionally across months. */
export function channelMonthBreakdown(record) {
  const fallback = validMonth(record?.settlementMonth)
  const lines = Array.isArray(record?.items) ? record.items : []
  const byMonth = new Map()
  let unknown = false
  for (const line of lines) {
    const month = validMonth(line?.settlementCycle || line?.settlement_period || fallback)
    const amount = cents(line?.settlementAmount)
    if (!month) { unknown = true; continue }
    const entry = byMonth.get(month) || { cents: 0, complete: true }
    entry.cents += amount ?? 0
    entry.complete = entry.complete && amount !== null
    byMonth.set(month, entry)
  }
  // A single known accounting month owns the authoritative saved bill total,
  // including rounding/adjustments. Multiple months use their actual lines.
  if (!lines.length && fallback) {
    const stored = cents(record?.settlementAmount)
    byMonth.set(fallback, { cents: stored ?? 0, complete: stored !== null })
  } else if (byMonth.size === 1 && !unknown) {
    const month = byMonth.keys().next().value
    const stored = cents(record?.settlementAmount)
    if (stored !== null) byMonth.set(month, { cents: stored, complete: true })
  }
  const stored = cents(record?.settlementAmount)
  const entries = [...byMonth.values()]
  const unallocated = byMonth.size > 1 && stored !== null && !unknown && entries.every(entry => entry.complete)
    ? stored - entries.reduce((sum, entry) => sum + entry.cents, 0) : 0
  return { byMonth, unknown: unknown || byMonth.size === 0, unallocated }
}

/** Input is the full business-filtered ledger, before archive/payment tabs
 * and display pagination. Archive snapshots contain IDs, not extra bills. */
export function summarizeChannelReceivable(records, { month = '', fromMonth = '', toMonth = '' } = {}) {
  const result = { cents: 0, billCount: 0, unknownMonthCount: 0, incompleteCount: 0, unallocatedCount: 0 }
  const seen = new Set()
  if (fromMonth && toMonth && fromMonth > toMonth) return result
  for (const row of records || []) {
    if (!row || ['cancelled', 'canceled'].includes(String(row.status || '').trim().toLowerCase())) continue
    const id = String(row.id ?? '').trim()
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    if (!month && !fromMonth && !toMonth) {
      result.cents += cents(getChannelTotals(row).settlementAmount) ?? 0
      result.billCount++
      continue
    }
    const breakdown = channelMonthBreakdown(row)
    if (breakdown.unknown) result.unknownMonthCount++
    let included = false
    let incomplete = false
    for (const [period, entry] of breakdown.byMonth) {
      if (month ? period !== month : (fromMonth && period < fromMonth) || (toMonth && period > toMonth)) continue
      included = true
      result.cents += entry.cents
      if (!entry.complete) incomplete = true
    }
    if (included) result.billCount++
    if (incomplete) result.incompleteCount++
    if (included && breakdown.unallocated) result.unallocatedCount++
  }
  return result
}
