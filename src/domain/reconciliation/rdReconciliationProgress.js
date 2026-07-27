const RECONCILED_STATUSES = new Set([
  'confirmed',
  'completed',
  'settled',
  'invoiced',
  'reconciled',
  'verified'
])

const SETTLED_STATUSES = new Set([
  'settled',
  'invoiced',
  'reconciled',
  'verified'
])

function numberValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
function cleanText(value) {
  return value == null ? '' : String(value).trim()
}

function sumItems(record, field) {
  if (!Array.isArray(record?.items)) return 0
  return record.items.reduce((sum, item) => sum + numberValue(item?.[field]), 0)
}

function percent(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0
}

function recordFlow(record) {
  const stored = numberValue(record?.gameFlow)
  return stored || sumItems(record, 'revenue')
}

function recordSettlement(record, resolver) {
  return numberValue(
    typeof resolver === 'function' ? resolver(record) : record?.settlementAmount
  )
}

function recordProduct(record) {
  const items = Array.isArray(record?.items)
    ? record.items.map((item) => cleanText(item?.gameName)).filter(Boolean)
    : []
  return items.join('、') || cleanText(record?.game) || '未填写产品'
}

function recordPartner(record) {
  return (
    cleanText(record?.partnerShortName) ||
    cleanText(record?.partner) ||
    cleanText(record?.partyBName) ||
    '未关联客户'
  )
}

function paymentComplete(record, settlementAmount) {
  const paidAmount = Math.abs(numberValue(record?.paidAmount))
  const requiredAmount = Math.abs(settlementAmount)
  const paymentStatus = cleanText(record?.paymentStatus)
  return (
    (requiredAmount > 0 && paidAmount + 0.01 >= requiredAmount) ||
    paymentStatus === '已付款'
  )
}

function unresolvedReason(record, flow, partner, reconciled) {
  const reasons = []
  if (flow <= 0) reasons.push('缺少流水')
  if (partner === '未关联客户') reasons.push('未关联客户')
  if (!reconciled) reasons.push('待核对')
  return reasons.join('、') || '待完善'
}

export function summarizeRdReconciliationProgress(records, options = {}) {
  const resolver = options.settlementResolver
  const activeRecords = (Array.isArray(records) ? records : []).filter(
    (record) => cleanText(record?.status) !== 'cancelled'
  )

  const normalized = activeRecords.map((record, index) => {
    const status = cleanText(record?.status) || 'pending'
    const settlementAmount = recordSettlement(record, resolver)
    const settlementWeight = Math.abs(settlementAmount)
    const flow = recordFlow(record)
    const partner = recordPartner(record)
    const reconciled = RECONCILED_STATUSES.has(status)
    const settled = SETTLED_STATUSES.has(status)
    const paid = paymentComplete(record, settlementAmount)
    const paidAmount = Math.abs(numberValue(record?.paidAmount))

    return {
      id: cleanText(record?.id) || `rd-progress-${index}`,
      month: cleanText(record?.settlementMonth) || '-',
      billNumber: cleanText(record?.settlementNumber) || '-',
      partner,
      product: recordProduct(record),
      flow,
      settlementAmount,
      settlementWeight,
      paidAmount,
      status,
      reconciled,
      settled,
      paid,
      hasFlow: flow > 0,
      reason: unresolvedReason(record, flow, partner, reconciled)
    }
  })

  const sum = (items, field) =>
    items.reduce((total, row) => total + numberValue(row[field]), 0)
  const flowReady = normalized.filter((row) => row.hasFlow)
  const reconciled = normalized.filter((row) => row.reconciled)
  const settled = normalized.filter((row) => row.settled)
  const paid = normalized.filter((row) => row.paid)
  const unresolved = normalized
    .filter((row) => !row.reconciled || !row.hasFlow || row.partner === '未关联客户')
    .sort((a, b) => b.settlementWeight - a.settlementWeight)

  const settlementWeight = sum(normalized, 'settlementWeight')
  const reconciledWeight = sum(reconciled, 'settlementWeight')
  const settledWeight = sum(settled, 'settlementWeight')
  const coveredPayment = normalized.reduce(
    (total, row) => total + Math.min(row.paidAmount, row.settlementWeight),
    0
  )

  return {
    month: options.month || '',
    totals: {
      rows: normalized.length,
      flowRows: flowReady.length,
      flowAmount: sum(normalized, 'flow'),
      settlementAmount: sum(normalized, 'settlementAmount'),
      settlementWeight,
      reconciledRows: reconciled.length,
      reconciledAmount: sum(reconciled, 'settlementAmount'),
      reconciliationAmountPercent: percent(reconciledWeight, settlementWeight),
      reconciliationRowPercent: percent(reconciled.length, normalized.length),
      settledRows: settled.length,
      settledAmount: sum(settled, 'settlementAmount'),
      settlementAmountPercent: percent(settledWeight, settlementWeight),
      paidRows: paid.length,
      paidAmount: sum(normalized, 'paidAmount'),
      paymentAmountPercent: percent(coveredPayment, settlementWeight),
      unresolvedRows: unresolved.length,
      unresolvedAmount: sum(unresolved, 'settlementAmount'),
      cancelledRows: (Array.isArray(records) ? records : []).length - normalized.length
    },
    unresolved
  }
}
