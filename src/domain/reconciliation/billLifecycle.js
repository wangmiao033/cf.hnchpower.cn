export const BILL_STATUS_LABELS = {
  draft: '草稿',
  pending: '待核对',
  confirmed: '已核对',
  invoiced: '发票已齐',
  completed: '已完成',
  settled: '已结算',
  reconciled: '已核销',
  verified: '已核销',
  cancelled: '已取消',
  canceled: '已取消'
}

export const EDITABLE_BILL_STATUSES = new Set(['draft', 'pending'])
export const REVIEWED_BILL_AMENDABLE_STATUSES = new Set([
  'confirmed', 'invoiced', 'completed', 'settled', 'reconciled', 'verified'
])

export function normalizeBillStatus(value) {
  return String(value || 'pending').trim().toLowerCase() || 'pending'
}

export function billStatusLabel(value) {
  const status = normalizeBillStatus(value)
  return BILL_STATUS_LABELS[status] || status
}

/** Reading remains allowed for all states, but changing reviewed financial data
 * must start with an audited amendment note (the server enforces the transition).
 */
export function canRequestReviewedBillAmendment(status) {
  return REVIEWED_BILL_AMENDABLE_STATUSES.has(normalizeBillStatus(status))
}

export function isValidReviewedBillAmendmentNote(value) {
  return String(value || '').trim().length >= 2
}


export function isBillLockedStatus(value) {
  return !EDITABLE_BILL_STATUSES.has(normalizeBillStatus(value))
}

export function billLockLabel(value) {
  return isBillLockedStatus(value) ? '已锁单' : '可编辑'
}

export function lifecycleStepIndex(value) {
  const status = normalizeBillStatus(value)
  const steps = ['draft', 'pending', 'confirmed', 'invoiced', 'completed', 'reconciled']
  if (status === 'settled') return 4
  if (status === 'verified') return 5
  if (status === 'cancelled' || status === 'canceled') return -1
  return steps.indexOf(status)
}
