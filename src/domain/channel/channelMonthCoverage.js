/**
 * Read-only channel ledger coverage audit.
 * It checks observed bill months, NOT QuickSDK revenue or contract obligations.
 * Internal holes and months after the last recorded bill are intentionally distinct.
 */
import { channelBillMonths } from '@/domain/reconciliation/sharedBillMonthOptions.js'

const MONTH_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])$/

function monthIndex(value) {
  if (!MONTH_PATTERN.test(String(value || ''))) return null
  const [year, month] = value.split('-').map(Number)
  return year * 12 + (month - 1)
}

function monthFromIndex(index) {
  const year = Math.floor(index / 12)
  const month = index - year * 12 + 1
  return String(year) + '-' + String(month).padStart(2, '0')
}

export function lastCompletedChannelMonth(now = new Date()) {
  return monthFromIndex(now.getFullYear() * 12 + now.getMonth() - 1)
}

export function channelAuditMonths({
  endingMonth = '',
  windowSize = 6,
  now = new Date()
} = {}) {
  const lastMonth = monthIndex(lastCompletedChannelMonth(now))
  const requested = monthIndex(endingMonth)
  const end = requested == null ? lastMonth : Math.min(requested, lastMonth)
  const size = [3, 6, 12].includes(Number(windowSize)) ? Number(windowSize) : 6
  return Array.from({ length: size }, (_, offset) => monthFromIndex(end - size + 1 + offset))
}

function cancelled(record) {
  return ['cancelled', 'canceled'].includes(String(record?.status || '').toLowerCase())
}

function channelKey(record) {
  return String(record?.channelName || record?.channel_name || '').trim().toLocaleLowerCase('zh-CN')
}

/**
 * Only channels with at least one recorded bill in the selected window are shown.
 * A gap is a month between two recorded months; a trailing month is after the
 * newest recorded bill. Neither proves that money or a bill is owed.
 *
 * Archived bills ARE recorded. Cancelled bills are not.
 */
export function auditChannelBillMonths(records = [], options = {}) {
  const months = channelAuditMonths(options)
  const endMonth = months[months.length - 1]
  const map = new Map()

  for (const record of records || []) {
    if (!record || cancelled(record)) continue
    const key = channelKey(record)
    if (!key) continue
    const normalizedName = String(record.channelName || record.channel_name).trim()
    const billMonths = channelBillMonths(record).filter((month) => month <= endMonth)
    if (!billMonths.length) continue
    if (!map.has(key)) {
      map.set(key, { key, name: normalizedName, recorded: new Map() })
    }
    const group = map.get(key)
    for (const month of billMonths) {
      group.recorded.set(month, (group.recorded.get(month) || 0) + 1)
    }
  }

  const channels = []
  for (const group of map.values()) {
    const allRecordedMonths = [...group.recorded.keys()].sort()
    const firstRecorded = allRecordedMonths[0]
    const lastRecorded = allRecordedMonths[allRecordedMonths.length - 1]
    const coveredMonths = months.filter((month) => group.recorded.has(month))
    if (!coveredMonths.length) continue

    const cells = months.map((month) => {
      const count = group.recorded.get(month) || 0
      const kind = count > 0 ? 'recorded'
        : month < firstRecorded ? 'before'
        : month > lastRecorded ? 'trailing'
        : 'gap'
      return { month, count, kind }
    })
    channels.push({
      key: group.key,
      name: group.name,
      firstRecorded,
      lastRecorded,
      covered: coveredMonths.length,
      recordedBills: coveredMonths.reduce((sum, month) => sum + group.recorded.get(month), 0),
      gaps: cells.filter((cell) => cell.kind === 'gap').map((cell) => cell.month),
      trailing: cells.filter((cell) => cell.kind === 'trailing').map((cell) => cell.month),
      cells
    })
  }

  channels.sort((left, right) => {
    if (right.gaps.length !== left.gaps.length) return right.gaps.length - left.gaps.length
    if (right.trailing.length !== left.trailing.length) return right.trailing.length - left.trailing.length
    return left.name.localeCompare(right.name, 'zh-CN')
  })

  return {
    months,
    channels,
    coveredChannelCount: channels.length,
    gapChannelCount: channels.filter((group) => group.gaps.length).length,
    gapMonthCount: channels.reduce((sum, group) => sum + group.gaps.length, 0),
    trailingChannelCount: channels.filter((group) => group.trailing.length).length,
    recordedBillCount: channels.reduce((sum, group) => sum + group.recordedBills, 0)
  }
}
