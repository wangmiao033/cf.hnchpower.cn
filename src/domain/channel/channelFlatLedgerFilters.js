/**
 * Presentation-only channel bill filtering and sorting.
 * A multi-month statement always remains one bill with one settlement amount.
 */
import { getChannelTotals, getChannelReceivedAmount, getChannelLineItems } from './channelAggregates.js'
import { channelBillMonths } from '@/domain/reconciliation/sharedBillMonthOptions.js'

export function ledgerBillGames(row) {
  const items = getChannelLineItems(row)
  const raw = items.length
    ? items.map(item => item.gameName)
    : String(row?.gameName || '').split(/[、,，]/)
  return [...new Set(raw.map(value => String(value || '').trim()).filter(Boolean))]
}

export function matchesChannelLedgerFilters(row, options = {}) {
  if (!row) return false
  const { month = '', fromMonth = '', toMonth = '', channel = '', game = '', status = '', query = '' } = options
  const months = channelBillMonths(row)
  if (month && !months.includes(month)) return false
  if (fromMonth && toMonth && fromMonth > toMonth) return false
  if ((fromMonth || toMonth) && !months.some(value =>
    (!fromMonth || value >= fromMonth) && (!toMonth || value <= toMonth)
  )) return false
  if (channel && !String(row.channelName || '').toLocaleLowerCase('zh-CN').includes(String(channel).trim().toLocaleLowerCase('zh-CN'))) return false
  const games = ledgerBillGames(row)
  if (game && !games.some(name => name.toLocaleLowerCase('zh-CN').includes(String(game).trim().toLocaleLowerCase('zh-CN')))) return false
  if (status && String(row.status || 'pending') !== status) return false
  if (query) {
    const haystack = [
      row.statementNo,
      row.billNumber,
      row.channelName,
      row.partnerName,
      row.gameName,
      ...games,
      ...months,
      row.remark
    ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN')
    if (!haystack.includes(String(query).trim().toLocaleLowerCase('zh-CN'))) return false
  }
  return true
}

export function sortChannelLedgerRows(rows = [], sortMode = 'month-desc') {
  const sortValue = (row, kind) => {
    if (kind === 'settlement') return Number(getChannelTotals(row).settlementAmount || 0)
    if (kind === 'unpaid') return Math.max(0, Number(getChannelTotals(row).settlementAmount || 0) - getChannelReceivedAmount(row))
    const months = channelBillMonths(row)
    return months[months.length - 1] || String(row.settlementMonth || '')
  }
  const descending = sortMode !== 'month-asc' && sortMode !== 'channel-asc'
  return [...(rows || [])].map((row, index) => ({ row, index })).sort((a, b) => {
    let comparison = 0
    if (sortMode === 'channel-asc') {
      comparison = String(a.row.channelName || '').localeCompare(String(b.row.channelName || ''), 'zh-CN')
      if (!comparison) comparison = String(sortValue(b.row, 'month')).localeCompare(String(sortValue(a.row, 'month')))
    } else if (sortMode === 'settlement-desc' || sortMode === 'unpaid-desc') {
      const kind = sortMode === 'settlement-desc' ? 'settlement' : 'unpaid'
      comparison = Number(sortValue(b.row, kind)) - Number(sortValue(a.row, kind))
    } else {
      comparison = String(sortValue(a.row, 'month')).localeCompare(String(sortValue(b.row, 'month')))
      if (descending) comparison = -comparison
    }
    return comparison || a.index - b.index
  }).map(item => item.row)
}

export function channelLedgerSum(rows = []) {
  const cents = value => Math.round(Number(value || 0) * 100)
  return rows.reduce((result, row) => {
    const total = cents(getChannelTotals(row).settlementAmount)
    const received = cents(getChannelReceivedAmount(row))
    result.settlementCents += total
    result.receivedCents += received
    result.unpaidCents += Math.max(0, total - received)
    return result
  }, { settlementCents: 0, receivedCents: 0, unpaidCents: 0 })
}
