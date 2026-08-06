import {
  formatRdSettlementPeriodLabel,
  normalizeRdSettlementPeriod,
  uniqueRdSettlementPeriods
} from '@/domain/reconciliation/rdSettlementPeriods.js'

function pad2(value) {
  return String(value).padStart(2, '0')
}

export function dateToInputValue(raw, fallback = new Date()) {
  const value = raw ? new Date(raw) : fallback
  const date = Number.isNaN(value.getTime()) ? fallback : value
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function settlementCycleToMonthInputValue(raw) {
  const normalized = normalizeRdSettlementPeriod(raw)
  const match = normalized.match(/^(\d{4})年(\d{1,2})月$/)
  return match ? `${match[1]}-${pad2(Number(match[2]))}` : ''
}

export function monthInputValueToSettlementCycle(raw) {
  const match = String(raw || '').trim().match(/^(\d{4})-(\d{2})$/)
  if (!match) return ''
  return `${match[1]}年${Number(match[2])}月`
}

export function inheritRdSettlementCycle(lines, fallback = '') {
  const rows = Array.isArray(lines) ? lines : []
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const cycle = normalizeRdSettlementPeriod(rows[index]?.settlementCycle)
    if (cycle) return cycle
  }
  return normalizeRdSettlementPeriod(fallback)
}

export function summarizeRdFormPeriods(lines, fallback = '') {
  const rows = Array.isArray(lines) ? lines : []
  const periods = uniqueRdSettlementPeriods(
    rows.map((line) => line?.settlementCycle || fallback)
  )
  return {
    periods,
    count: periods.length,
    label: formatRdSettlementPeriodLabel(periods) || '待选择'
  }
}
