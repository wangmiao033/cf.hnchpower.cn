/**
 * Read-only channel ledger summary; the backend remains the source of truth
 * for invoice eligibility, cumulative pool membership and payment allocations.
 */
import { getChannelReceivedAmount, getChannelTotals } from '@/domain/channel/channelAggregates.js'
import { channelBillMonths } from '@/domain/reconciliation/sharedBillMonthOptions.js'

const EPS_CENTS = 1

function cents(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? Math.round(number * 100) : 0
}

export function channelPartnerNames(records = [], channelName = '') {
  const unique = new Map()
  for (const row of records || []) {
    if (!row || ['cancelled', 'canceled'].includes(String(row.status || '').toLowerCase())) continue
    if (channelName && String(row.channelName || '').trim() !== String(channelName).trim()) continue
    const name = String(row.partnerName || row.channelName || '').trim()
    if (name && !unique.has(name)) unique.set(name, true)
  }
  return [...unique.keys()].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

export function summarizeChannelUnpaid(records = [], {
  partnerName = '',
  archivedIds = []
} = {}) {
  const archiveSet = new Set([...archivedIds].map(String))
  let receivableCents = 0
  let receivedCents = 0
  let unpaidCents = 0
  let confirmedUnpaidCents = 0
  let notReviewedCents = 0
  let unpaidCount = 0
  let notReviewedCount = 0
  let confirmedUnpaidCount = 0
  const unpaidMonths = new Set()
  const unpaidIds = []
  for (const record of records || []) {
    if (!record) continue
    if (['cancelled', 'canceled'].includes(String(record.status || '').toLowerCase())) continue
    if (archiveSet.has(String(record.id))) continue
    if (partnerName && String(record.partnerName || record.channelName || '').trim() !== partnerName) continue
    const totals = getChannelTotals(record)
    const total = Math.max(0, cents(totals.settlementAmount))
    const received = Math.max(0, cents(getChannelReceivedAmount(record)))
    const outstanding = Math.max(0, total - received)
    receivableCents += total
    receivedCents += received
    unpaidCents += outstanding
    if (outstanding < EPS_CENTS) continue
    unpaidCount += 1
    unpaidIds.push(String(record.id))
    channelBillMonths(record).forEach(month => unpaidMonths.add(month))
    if (String(record.status || '').toLowerCase() === 'confirmed' && received < EPS_CENTS) {
      confirmedUnpaidCents += outstanding
      confirmedUnpaidCount += 1
    } else {
      notReviewedCents += outstanding
      notReviewedCount += 1
    }
  }
  const months = [...unpaidMonths].sort()
  return {
    receivable: receivableCents / 100,
    received: receivedCents / 100,
    unpaid: unpaidCents / 100,
    unpaidCount,
    unpaidIds,
    confirmedUnpaid: confirmedUnpaidCents / 100,
    confirmedUnpaidCount,
    notReviewed: notReviewedCents / 100,
    notReviewedCount,
    firstUnpaidMonth: months[0] || '',
    lastUnpaidMonth: months[months.length - 1] || '',
    unpaidMonths: months
  }
}

export function cumulativeRowCondition(snapshot, billId) {
  if (!snapshot?.policy?.enabled || snapshot?.policy?.settlement_mode !== 'threshold' || !billId) return null
  const id = String(billId)
  for (const batch of snapshot.batches?.items || []) {
    if (batch.status === 'cancelled') continue
    if ((batch.items || []).some(item => String(item.bill_id) === id)) {
      return { kind: 'batched', label: '已入累计批次', batchNo: batch.batch_no }
    }
  }
  const inPool = (snapshot.pool?.bills || []).some(item => String(item.bill_id) === id)
  return inPool ? { kind: snapshot.pool.ready ? 'ready' : 'accumulating', label: snapshot.pool.ready ? '累计达标' : '累计中' } : null
}
