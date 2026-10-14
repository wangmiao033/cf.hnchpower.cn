/** Independent channel bill lifecycle and cash collection labels.
 * Source of truth for review is row.status, NOT row.validationStatus or receipts.
 * This is display-only and must not approve, settle or change an invoice.
 */
import {
  normalizeBillStatus,
  billStatusLabel,
  REVIEWED_BILL_AMENDABLE_STATUSES
} from '@/domain/reconciliation/billLifecycle.js'

export function channelBillLedgerStatuses(row, {
  archived = false,
  cancelled = false,
  settlement = 0,
  received = 0,
  settled = false,
  difference = false,
  cumulative = false,
  cumulativeState = ''
} = {}) {
  const status = normalizeBillStatus(row?.status)
  const isCancelled = cancelled || status === 'cancelled' || status === 'canceled'
  const reviewed = REVIEWED_BILL_AMENDABLE_STATUSES.has(status)

  const review = isCancelled ? { label: '已作废', tone: 'muted' }
    : archived ? { label: '已归档', tone: 'muted' }
      : reviewed ? { label: '已核对', tone: 'reviewed' }
        : status === 'draft' ? { label: '草稿', tone: 'muted' }
          : status === 'pending' ? { label: '待核对', tone: 'pending' }
            : { label: billStatusLabel(status), tone: 'pending' }

  // "一致" is a mathematical validation, not proof of manual confirmation.
  const variance = isCancelled || archived || !difference
    ? null
    : reviewed ? { label: '差异留痕', tone: 'audited' }
      : { label: '金额待核', tone: 'anomaly' }

  // 0-receivable periods require no payment and are not evidence of a deposit.
  // Otherwise distinguish receipt strictly by actual recorded cash/settlement.
  const receipt = isCancelled ? { label: '—', tone: 'muted' }
    : Number(settlement) <= 0.01
      ? { label: '无需收款', tone: 'muted' }
      : settled ? { label: '已结清', tone: 'paid' }
        : Number(received) > 0.01 ? { label: '部分收款', tone: 'partial' }
          : { label: '未收款', tone: 'unpaid' }

  const cumulativeLabel = cumulative && !isCancelled && !archived && !settled
    ? cumulativeState === 'ready' ? '累计达标' : '累计中'
    : ''
  const accumulation = cumulativeLabel ? { label: cumulativeLabel, tone: 'cumulative' } : null

  return { review, receipt, variance, accumulation }
}
