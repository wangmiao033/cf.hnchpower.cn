import { calculateRdSettlementRow } from '@/domain/settlement/calculateSettlementAmount.js'

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeRdSettlementPeriod(value) {
  const raw = clean(value)
  if (!raw) return ''
  const match = raw.match(/^(\d{4})(?:-|年)\s*(\d{1,2})(?:月)?$/)
  if (!match) return raw
  const month = Math.min(Math.max(Number(match[2]), 1), 12)
  return `${match[1]}年${month}月`
}

export function rdSettlementPeriodKey(value) {
  const normalized = normalizeRdSettlementPeriod(value)
  const match = normalized.match(/^(\d{4})年(\d{1,2})月$/)
  return match ? `${match[1]}-${String(Number(match[2])).padStart(2, '0')}` : normalized
}

function periodSortValue(value) {
  const key = rdSettlementPeriodKey(value)
  const match = key.match(/^(\d{4})-(\d{2})$/)
  return match ? Number(match[1]) * 12 + Number(match[2]) : Number.MAX_SAFE_INTEGER
}

export function uniqueRdSettlementPeriods(values) {
  const unique = new Map()
  for (const value of values || []) {
    const normalized = normalizeRdSettlementPeriod(value)
    if (!normalized) continue
    unique.set(rdSettlementPeriodKey(normalized), normalized)
  }
  return [...unique.values()].sort((left, right) => {
    const numeric = periodSortValue(left) - periodSortValue(right)
    return numeric || left.localeCompare(right, 'zh-CN')
  })
}

export function getRdRecordSettlementPeriods(record) {
  const direct = Array.isArray(record?.settlementPeriods) ? record.settlementPeriods : []
  const itemPeriods = Array.isArray(record?.items)
    ? record.items.map((item) => item?.settlementCycle || item?.settlement_period)
    : []
  const periods = uniqueRdSettlementPeriods([...direct, ...itemPeriods])
  if (periods.length > 0) return periods
  return uniqueRdSettlementPeriods([record?.settlementMonth, record?.month])
}

export function formatRdSettlementPeriodLabel(values) {
  const periods = uniqueRdSettlementPeriods(values)
  if (periods.length === 0) return ''
  if (periods.length === 1) return periods[0]

  const indexes = periods.map(periodSortValue)
  const continuous = indexes.every(
    (value, index) => index === 0 || value - indexes[index - 1] === 1
  )
  return continuous ? `${periods[0]}—${periods[periods.length - 1]}` : periods.join('、')
}

export function rdRecordSettlementPeriodLabel(record) {
  return (
    clean(record?.settlementPeriodLabel) ||
    formatRdSettlementPeriodLabel(getRdRecordSettlementPeriods(record)) ||
    clean(record?.settlementMonth) ||
    '-'
  )
}

export function rdRecordMatchesSettlementPeriod(record, period) {
  const target = rdSettlementPeriodKey(period)
  if (!target) return true
  return getRdRecordSettlementPeriods(record).some(
    (value) => rdSettlementPeriodKey(value) === target
  )
}

export function buildRdSettlementPeriodOptions(records) {
  return uniqueRdSettlementPeriods(
    (records || []).flatMap((record) => getRdRecordSettlementPeriods(record))
  )
    .map(rdSettlementPeriodKey)
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left, 'zh-CN'))
}

function lineSettlement(record, line) {
  const stored = Number(line?.settlementAmount)
  if (Number.isFinite(stored)) return stored
  return calculateRdSettlementRow(line || {}, record?.channelFeeRate).settlementAmount
}

function lineNetRevenue(record, line) {
  const stored = Number(line?.netRevenue)
  if (Number.isFinite(stored)) return stored
  return calculateRdSettlementRow(line || {}, record?.channelFeeRate).totalFlow
}

function sum(items, getter) {
  return items.reduce((total, item) => total + number(getter(item)), 0)
}

export function sliceRdRecordForSettlementPeriod(record, period) {
  const target = rdSettlementPeriodKey(period)
  if (!target) return record

  const sourceItems = Array.isArray(record?.items) ? record.items : []
  const fallback = normalizeRdSettlementPeriod(record?.settlementMonth)
  const items = sourceItems.filter(
    (item) => rdSettlementPeriodKey(item?.settlementCycle || fallback) === target
  )
  if (items.length === 0) return null

  const selectedSettlement = sum(items, (item) => lineSettlement(record, item))
  const fullSettlement = sourceItems.length > 0
    ? sum(sourceItems, (item) => lineSettlement(record, item))
    : number(record?.settlementAmount)
  const paidAmount = number(record?.paidAmount)
  const paidRatio = fullSettlement > 0 ? selectedSettlement / fullSettlement : 0
  const selectedPaid = Math.min(Math.abs(selectedSettlement), Math.abs(paidAmount) * paidRatio)
  const normalizedPeriod = normalizeRdSettlementPeriod(period)
  const productNames = [...new Set(items.map((item) => clean(item?.gameName)).filter(Boolean))]

  return {
    ...record,
    settlementMonth: normalizedPeriod,
    settlementPeriods: [normalizedPeriod],
    settlementPeriodLabel: normalizedPeriod,
    items,
    game: productNames.join('、') || record?.game || '',
    gameFlow: sum(items, (item) => item?.revenue),
    testingFee: sum(items, (item) => item?.testFee),
    voucher: sum(items, (item) => item?.couponAmount),
    refund: sum(items, (item) => item?.extraFee),
    netRevenue: sum(items, (item) => lineNetRevenue(record, item)),
    settlementAmount: selectedSettlement,
    paidAmount: selectedPaid,
    unpaidAmount: Math.max(Math.abs(selectedSettlement) - selectedPaid, 0)
  }
}

export function buildRdMonthlyProgressRecords(records, period) {
  return (records || [])
    .map((record) => sliceRdRecordForSettlementPeriod(record, period))
    .filter(Boolean)
}

export function rdCompatibilitySettlementMonth(items, fallback = '') {
  const periods = uniqueRdSettlementPeriods(
    (items || [])
      .filter((item) => clean(item?.gameName) && number(item?.revenue) > 0)
      .map((item) => item?.settlementCycle || fallback)
  )
  return periods[0] || normalizeRdSettlementPeriod(fallback)
}
