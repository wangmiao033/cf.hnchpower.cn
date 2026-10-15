/**
 * Read-only channel ledger coverage audit.
 * It checks observed bill months, NOT QuickSDK revenue or contract obligations.
 * Internal holes and months after the last recorded bill are intentionally distinct.
 */
import { channelBillMonths } from '@/domain/reconciliation/sharedBillMonthOptions.js'
import { getChannelLineItems } from '@/domain/channel/channelAggregates.js'
import { getChannelBillNumber } from '@/utils/channelBillNumber.js'
import { unifyLegacyChannelNamesForSamePartner, channelLedgerMatchesSearch, channelIdentityMatchesSearch } from './channelAliasIdentity.js'
import {
  buildChannelAuditGroupIndex,
  auditIdentityForBill,
  groupContainsKeyword
} from './channelAuditGroups.js'

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

function searchText(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN')
}

/** Resolve channel identities before assessing months: do not exclude a
 * channel's earlier bills just because the keyword matched one game/month. */
export function filterScopedChannelAuditRows(records = [], options = {}) {
  const name = searchText(options.channelFilter)
  const keyword = searchText(options.keyword)
  const local = searchText(options.localChannelSearch)
  if (!name && !keyword && !local) return records || []
  const index = buildChannelAuditGroupIndex(options.partners || [])
  const identities = new Set()
  for (const row of records || []) {
    if (!row || cancelled(row)) continue
    const identity = auditIdentityForBill(row, index)
    const key = identity.key
    if (!identity.name) continue
    // An explicitly linked group may contain members whose individual channel
    // label differs from the selected filter. Matching ONE member must include
    // the entire group's history when assessing months.
    if (name && !channelKey(row).includes(name) && !groupContainsKeyword(identity, name)) continue
    if (local && !channelIdentityMatchesSearch(row, local) && !groupContainsKeyword(identity, local)) continue
    if (keyword && !channelLedgerMatchesSearch(row, keyword, [
      row.remark,
      getChannelBillNumber(row),
      ...getChannelLineItems(row).map(item => item.gameName),
      ...channelBillMonths(row)
    ]) && !groupContainsKeyword(identity, keyword)) continue
    identities.add(key)
  }
  return (records || []).filter(row =>
    row && identities.has(auditIdentityForBill(row, index).key)
  )
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
  const index = buildChannelAuditGroupIndex(options.partners || [])
  const sourceRows = filterScopedChannelAuditRows(unifyLegacyChannelNamesForSamePartner(records), options)
  const matchingChannelCount = new Set(
    sourceRows.filter(row => row && !cancelled(row))
      .map(row => auditIdentityForBill(row, index).key).filter(Boolean)
  ).size

  for (const record of sourceRows) {
    if (!record || cancelled(record)) continue
    const identity = auditIdentityForBill(record, index)
    const key = identity.key
    if (!identity.name) continue
    const billMonths = channelBillMonths(record).filter((month) => month <= endMonth)
    if (!billMonths.length) continue
    if (!map.has(key)) {
      map.set(key, {
        key, name: identity.name, isGroup: identity.isGroup,
        memberCompanies: identity.memberCompanies,
        recorded: new Map(), sources: new Map()
      })
    }
    const group = map.get(key)
    const sourceName = String(record.partnerName || record.partner_name ||
      record.channelName || record.channel_name || '').trim()
    for (const month of billMonths) {
      group.recorded.set(month, (group.recorded.get(month) || 0) + 1)
      if (!group.sources.has(month)) group.sources.set(month, new Set())
      if (sourceName) group.sources.get(month).add(sourceName)
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
      return {
        month, count, kind,
        sources: [...(group.sources.get(month) || [])].sort((a,b)=>a.localeCompare(b,'zh-CN'))
      }
    })
    channels.push({
      key: group.key,
      name: group.name,
      isGroup: group.isGroup,
      memberCompanies: group.memberCompanies,
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
    recordedBillCount: channels.reduce((sum, group) => sum + group.recordedBills, 0),
    matchingChannelCount
  }
}
