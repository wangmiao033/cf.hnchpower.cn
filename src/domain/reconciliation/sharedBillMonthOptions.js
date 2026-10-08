import { normalizeChannelSettlementCycle } from '@/domain/channel/channelBillingForm.js'
import { buildRdSettlementPeriodOptions } from '@/domain/reconciliation/rdSettlementPeriods.js'

const VALID_MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/

function channelMonthKey(value) {
  const key = normalizeChannelSettlementCycle(value)
  return VALID_MONTH.test(key) ? key : ''
}

/** Use the same effective periods as the channel ledger, including multi-month bills. */
export function channelBillMonths(record) {
  const fromItems = Array.isArray(record?.items)
    ? record.items.map((line) => channelMonthKey(line?.settlementCycle || line?.settlement_period)).filter(Boolean)
    : []
  const fallback = channelMonthKey(
    record?.settlementMonth || record?.billMonth || record?.month || record?.billingMonth || record?.period
  )
  return [...new Set(fromItems.length ? fromItems : [fallback].filter(Boolean))].sort()
}

export function channelBillMonthOptions(channelRecords = []) {
  return [...new Set((channelRecords || []).flatMap(channelBillMonths))]
    .sort((a, b) => b.localeCompare(a))
}

/**
 * The available month filter is shared across the R&D and channel modules.
 * Showing a month is not evidence that a channel bill exists for that month:
 * each ledger still filters and computes ONLY its own records.
 */
export function sharedBillMonthOptions(channelRecords = [], rdRecords = []) {
  return [...new Set([
    ...channelBillMonthOptions(channelRecords),
    ...buildRdSettlementPeriodOptions(rdRecords)
  ])]
    .filter((month) => VALID_MONTH.test(month))
    .sort((a, b) => b.localeCompare(a))
}
