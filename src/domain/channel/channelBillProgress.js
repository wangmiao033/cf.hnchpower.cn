function numberValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeChannelBillMonth(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4})\D+(\d{1,2})/)
  if (!match) return raw
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
}

function lineFlow(line) {
  const explicitTotal = Number(line?.totalFlow)
  if (Number.isFinite(explicitTotal)) return explicitTotal

  const rawFlow = numberValue(line?.flow ?? line?.backendFlow ?? line?.rechargeFlow ?? line?.originalFlow)
  const factorValue = Number(line?.discountFactor ?? line?.discount ?? 1)
  const factor = Number.isFinite(factorValue) && factorValue > 0 ? factorValue : 1
  return rawFlow * factor
}

function recordTotals(record) {
  const items = Array.isArray(record?.items) && record.items.length ? record.items : [record || {}]
  const flow = items.reduce((sum, item) => sum + lineFlow(item), 0)
  const itemSettlement = items.reduce((sum, item) => sum + numberValue(item?.settlementAmount), 0)
  const recordSettlement = numberValue(record?.settlementAmount)
  const settlementAmount = itemSettlement !== 0 ? itemSettlement : recordSettlement
  return { flow, settlementAmount }
}

function productLabel(record) {
  const items = Array.isArray(record?.items) ? record.items : []
  const names = [...new Set(items.map((item) => item?.gameName || item?.productName || item?.product).filter(Boolean))]
  if (!names.length) return record?.gameName || record?.productName || record?.product || '-'
  if (names.length <= 2) return names.join('\u3001')
  return `${names[0]} \u7b49 ${names.length} \u4e2a\u6e38\u620f`
}

function billNumber(record) {
  if (record?.billNumber || record?.code || record?.statementNo) {
    return record.billNumber || record.code || record.statementNo
  }
  const suffix = String(record?.id || '').slice(-8) || '-'
  return `QD-${suffix}`
}

const RECONCILED_STATUSES = new Set([
  'confirmed',
  'settled',
  'completed',
  'verified',
  'reconciled',
  '\u5df2\u786e\u8ba4',
  '\u5df2\u7ed3\u7b97',
  '\u5df2\u6838\u5bf9',
  '\u5df2\u5b8c\u6210',
])

const RECEIVABLE_STATUSES = new Set([
  'settled',
  'completed',
  '\u5df2\u7ed3\u7b97',
  '\u5df2\u5b8c\u6210',
])

function normalizedStatus(record) {
  return String(record?.status || '').trim().toLowerCase()
}

function getChannelBillMonth(record) {
  return record?.settlementMonth
    || record?.billMonth
    || record?.month
    || record?.billingMonth
    || record?.period
    || ''
}

export function summarizeChannelBillProgress(records = [], options = '') {
  const month = typeof options === 'object' ? options?.month : options
  const normalizedMonth = normalizeChannelBillMonth(month)
  const filteredRecords = records.filter((record) => {
    if (!normalizedMonth) return true
    return normalizeChannelBillMonth(getChannelBillMonth(record)) === normalizedMonth
  })

  const rows = filteredRecords.map((record) => {
    const totals = recordTotals(record)
    const status = normalizedStatus(record)
    const reconciled = RECONCILED_STATUSES.has(status)
    const receivedAmount = numberValue(record?.receivedAmount ?? record?.receiptAmount ?? record?.paidAmount)
    const receivablePosted = reconciled && (receivedAmount > 0 || RECEIVABLE_STATUSES.has(status))

    return {
      id: record?.id,
      month: normalizeChannelBillMonth(record?.month || record?.billingMonth || record?.period),
      billNumber: billNumber(record),
      channel: record?.channelShortName || record?.channelName || record?.channel || '-',
      partner: record?.partnerName || record?.partner || '-',
      product: productLabel(record),
      flow: totals.flow,
      settlementAmount: totals.settlementAmount,
      receivedAmount,
      reconciled,
      receivablePosted,
      status: record?.status || '',
    }
  })

  const totalRows = rows.length
  const reconciledRows = rows.filter((row) => row.reconciled)
  const postedRows = rows.filter((row) => row.receivablePosted)
  const unresolved = rows.filter((row) => !row.reconciled)
  const sourceFlow = rows.reduce((sum, row) => sum + row.flow, 0)
  const settlementAmount = rows.reduce((sum, row) => sum + row.settlementAmount, 0)
  const reconciledFlow = reconciledRows.reduce((sum, row) => sum + row.flow, 0)
  const reconciledAmount = reconciledRows.reduce((sum, row) => sum + row.settlementAmount, 0)
  const unresolvedAmount = unresolved.reduce((sum, row) => sum + row.settlementAmount, 0)
  const receivedAmount = rows.reduce((sum, row) => sum + row.receivedAmount, 0)
  const rowPercent = totalRows ? (reconciledRows.length / totalRows) * 100 : 0
  const amountPercent = settlementAmount > 0 ? (reconciledAmount / settlementAmount) * 100 : rowPercent
  const receiptPercent = settlementAmount > 0 ? Math.min(100, (receivedAmount / settlementAmount) * 100) : 0

  return {
    source: 'channel-bills',
    month: normalizedMonth,
    fileName: '\u6e20\u9053\u8d26\u5355',
    totals: {
      rows: totalRows,
      sourceFlow,
      settlementAmount,
      reconciledRows: reconciledRows.length,
      reconciledFlow,
      reconciledAmount,
      receivableRows: postedRows.length,
      unresolvedRows: unresolved.length,
      unresolvedAmount,
      receivedAmount,
      amountPercent,
      rowPercent,
      receiptPercent,
    },
    rows,
    unresolved,
  }
}
