/**
 * Display-only V4 business dashboard aggregations.
 * All values come from existing read-only profit/business/todo endpoints.
 * Never use the rounded display values for settlement or bank matching.
 */
const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0
const roundCents = amount => Math.round((amount + Number.EPSILON) * 100) / 100
const metricValue = (data, key) => data?.[key]?.value == null ? null : numeric(data[key].value)

export function displayMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
  const amount = Number(value)
  const sign = amount < 0 ? '−' : ''
  const magnitude = Math.abs(amount)
  if (magnitude >= 10000) return sign + (magnitude / 10000).toFixed(2) + ' 万元'
  return sign + '¥' + magnitude.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function exactMoney(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : '¥' + Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const monthText = month => /^\d{4}-\d{2}$/.test(month || '')
  ? String(month).slice(0, 4) + '年' + Number(String(month).slice(5)) + '月'
  : '未选择账期'

export function latestPeriod(profit, business) {
  const recorded = [...(profit?.available_months || []), ...(business?.available_months || [])]
    .filter(month => /^\d{4}-\d{2}$/.test(month || ''))
  const fallback = [profit?.month, business?.month].filter(month => /^\d{4}-\d{2}$/.test(month || ''))
  return (recorded.length ? recorded : fallback).sort().at(-1) || ''
}

const hasActualMonth = (response, month) => Boolean(response && (response.available_months || []).includes(month))
const yearSum = (rows, key, year) => roundCents((rows || [])
  .filter(row => String(row.month || '').startsWith(year + '-'))
  .reduce((sum, row) => sum + numeric(row[key]), 0))

/** Financial scopes deliberately remain separate: profit accounting vs cash-date ledger. */
export function summarizeFinancePeriod(profit, business, period) {
  const annual = /^\d{4}-year$/.test(period || '')
  const year = annual ? period.slice(0, 4) : ''
  const selected = annual ? '' : (period || profit?.month || business?.month || '')
  const profitReady = annual
    ? (profit?.available_months || []).some(month => month.startsWith(year + '-'))
    : hasActualMonth(profit, selected)
  const businessReady = annual
    ? (business?.available_months || []).some(month => month.startsWith(year + '-'))
    : hasActualMonth(business, selected)

  const pVal = key => {
    if (!profitReady) return null
    return annual ? yearSum(profit?.trend, key, year) : metricValue(profit, key)
  }
  const bVal = key => {
    if (!businessReady) return null
    return annual ? yearSum(business?.trend, key, year) : metricValue(business, key)
  }

  const operating = pVal('operating_profit')
  const shared = annual
    ? null
    : profitReady
      ? roundCents(numeric(profit?.shared_server_cost?.value) + numeric(profit?.shared_expense?.value))
      : null
  const gross = profitReady
    ? annual
      ? yearSum(profit?.trend, 'project_gross_profit', year)
      : metricValue(profit, 'project_gross_profit') ?? roundCents(numeric(operating) + numeric(shared))
    : null
  const sharedTotal = profitReady
    ? annual ? roundCents(numeric(gross) - numeric(operating)) : shared
    : null
  const profitIncome = pVal('channel_settlement')
  const grossRate = profitIncome != null && Math.abs(profitIncome) > .005
    ? gross / profitIncome * 100 : null
  const operatingRate = profitIncome != null && Math.abs(profitIncome) > .005
    ? operating / profitIncome * 100 : null
  const cashIn = bVal('channel_receipts')
  const cashOut = bVal('rd_payments')
  const cashNet = cashIn == null || cashOut == null ? null : roundCents(cashIn - cashOut)

  return {
    annual, year, selected, profitReady, businessReady,
    gross, operating, sharedTotal, grossRate, operatingRate,
    profitIncome,
    rdCost: pVal('rd_cost'), serverCost: pVal('server_cost'),
    operatingExpense: pVal('operating_expense'),
    attributedExpense: annual ? null : pVal('attributed_expense'),
    // Settlement accounting in the management cockpit may allocate cross-month
    // line items differently from the profit service: show this separately.
    channelSettlement: bVal('channel_settlement'),
    rdSettlement: bVal('rd_settlement'),
    contribution: bVal('contribution'),
    cashIn, cashOut, cashNet
  }
}

export function combineMonthlyTrends(profit, business, selectedMonth, { annual = false, year = '', months = 6 } = {}) {
  // Trend endpoints contain zero-filled placeholders for months without
  // accounting records. Exclude placeholders instead of drawing fictitious
  // zero-profit or zero-cash datapoints.
  const pReported = new Set(profit?.available_months || [])
  const bReported = new Set(business?.available_months || [])
  const p = new Map((profit?.trend || [])
    .filter(row => pReported.has(row.month)).map(row => [row.month, row]))
  const b = new Map((business?.trend || [])
    .filter(row => bReported.has(row.month)).map(row => [row.month, row]))
  const all = [...new Set([...p.keys(), ...b.keys()])]
    .filter(key => /^\d{4}-\d{2}$/.test(key))
    .filter(key => annual ? key.startsWith(year + '-') : (!selectedMonth || key <= selectedMonth))
    .sort()
  if (annual) {
    const actuallyReported = [...(profit?.available_months || []), ...(business?.available_months || [])]
      .filter(key => key.startsWith(year + '-'))
      .sort().at(-1)
    return all.filter(key => !actuallyReported || key <= actuallyReported).slice(-months)
      .map(key => trendRow(key, p.get(key), b.get(key)))
  }
  return all.slice(-months).map(key => trendRow(key, p.get(key), b.get(key)))
}

function trendRow(month, p, b) {
  return {
    month,
    gross: p?.project_gross_profit == null ? null : numeric(p.project_gross_profit),
    operating: p?.operating_profit == null ? null : numeric(p.operating_profit),
    channel: b?.channel_settlement == null ? null : numeric(b.channel_settlement),
    rd: b?.rd_settlement == null ? null : numeric(b.rd_settlement),
    contribution: b?.contribution == null ? null : numeric(b.contribution),
    cashIn: b?.channel_receipts == null ? null : numeric(b.channel_receipts),
    cashOut: b?.rd_payments == null ? null : numeric(b.rd_payments),
    cashNet: b?.cash_net == null ? null : numeric(b.cash_net)
  }
}
