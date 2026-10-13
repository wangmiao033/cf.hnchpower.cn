import { rdRecordSettlementPeriodLabel } from '@/domain/reconciliation/rdSettlementPeriods.js'

/** Inputs are RECEIVED from R&D suppliers, not output invoices issued to channels. */
const ELIGIBLE_STATUSES = new Set(['confirmed', 'invoiced', 'completed', 'settled', 'reconciled', 'verified'])

const asCents = value => {
  if (value === null || value === undefined || value === '') return NaN
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}

const legalName = value => String(value || '').trim().replace(/\s+/g, '')

export const yuanFromCents = cents => (cents / 100).toFixed(2)

export function prepareRdInvoiceMerge(rows, summaries) {
  const empty = { items: [], totalCents: 0, partnerName: '', error: '' }
  if (!Array.isArray(rows) || !rows.length) {
    return { ...empty, error: '请先勾选需要收取进项发票的研发账单' }
  }
  if (rows.length > 30) return { ...empty, error: '每次最多合并30张研发账单，请分批处理' }

  const ids = rows.map(row => String(row?.id || '').trim())
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
    return { ...empty, error: '所选研发账单编号有误或重复，请重新勾选' }
  }

  const partnerNames = rows.map(row => String(row.partner || row.partnerName || row.partyBName || '').trim())
  if (partnerNames.some(name => !legalName(name)) || new Set(partnerNames.map(legalName)).size !== 1) {
    return { ...empty, error: '只能合并同一研发公司主体的账单，请核对每张账单的合作方全称' }
  }
  if (rows.some(row => !ELIGIBLE_STATUSES.has(String(row.status || 'pending').trim().toLowerCase()))) {
    return { ...empty, error: '部分账单尚未核对完成；请先完成核对，不能提前登记正式进项发票' }
  }
  const amounts = rows.map(row => asCents(row.settlementAmount))
  if (amounts.some(amount => !Number.isFinite(amount) || amount <= 0)) {
    return { ...empty, error: '零结算、冲减或无金额的研发账单不能合并登记普通进项发票' }
  }
  if (!Array.isArray(summaries) || summaries.length !== rows.length) {
    return { ...empty, error: '正在查询正式发票的关联金额，请稍后再试' }
  }
  const items = rows.map((row, index) => {
    const summary = summaries[index]
    return {
      id: ids[index],
      number: row.settlementNumber || row.statementNo || ids[index],
      period: rdRecordSettlementPeriodLabel(row),
      game: row.game || '',
      settlementCents: amounts[index],
      prepaymentCents: asCents(row.prepaymentDeduction) || 0,
      paidCents: asCents(row.paidAmount) || 0,
      allocatedCents: asCents(summary?.allocated_amount),
      remainingCents: asCents(summary?.remaining_amount),
      summaryBillId: String(summary?.bill_id || ''),
      summaryBillType: String(summary?.bill_type || ''),
      summaryGrossCents: asCents(summary?.bill_amount)
    }
  })
  if (items.some(item =>
    !Number.isFinite(item.remainingCents) ||
    !Number.isFinite(item.allocatedCents) ||
    item.summaryBillId !== item.id ||
    item.summaryBillType !== 'rd' ||
    item.summaryGrossCents !== item.settlementCents
  )) {
    return { ...empty, error: '发票关联数据和账单结算金额不一致，请刷新后重新核对' }
  }
  if (items.some(item => item.remainingCents <= 0)) {
    return { ...empty, items, error: '所选账单包含已全额收票项目，请取消该项以防重复关联' }
  }
  if (items.some(item => item.remainingCents > item.settlementCents || item.allocatedCents < 0)) {
    return { ...empty, items, error: '剩余收票金额异常，已阻止操作以保护原始账单' }
  }
  const totalCents = items.reduce((sum, item) => sum + item.remainingCents, 0)
  return { items, totalCents, partnerName: partnerNames[0], error: '' }
}
