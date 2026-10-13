import { channelBillMonths } from '@/domain/reconciliation/sharedBillMonthOptions.js'

/**
 * Channel invoice merge selection safety. "Unreceived" is NOT "uninvoiced":
 * getBillInvoiceSummary is the only source for remaining invoice coverage.
 */
const ISSUEABLE_STATUSES = new Set(['confirmed', 'invoiced', 'completed', 'settled', 'reconciled', 'verified'])

function asCents(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) : 0
}

function companyName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

export function prepareChannelInvoiceMerge(rows, summaries) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: '请先选择需要合并开票的渠道账单', items: [], totalCents: 0 }
  }
  if (rows.length > 30) {
    return { error: '每次最多合并 30 张账单，请分批处理', items: [], totalCents: 0 }
  }
  const ids = rows.map(row => String(row?.id || '').trim())
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) {
    return { error: '选择的账单存在重复或无效编号', items: [], totalCents: 0 }
  }
  const partners = [...new Set(rows.map(row => companyName(row?.partnerName)))]
  if (partners.length !== 1 || !partners[0]) {
    return { error: '合并开票必须属于同一合作方公司主体；请先核对每张账单的“合作方”', items: [], totalCents: 0 }
  }
  if (rows.some(row => !ISSUEABLE_STATUSES.has(String(row?.status || 'pending').trim().toLowerCase()))) {
    return { error: '存在尚未核对或已作废的账单；请先完成核对，再合并开票', items: [], totalCents: 0 }
  }
  if (rows.some(row => asCents(row?.settlementAmount) <= 0)) {
    return { error: '零结算或负数冲减账单不可按普通销项发票合并', items: [], totalCents: 0 }
  }

  if (!Array.isArray(summaries) || summaries.length !== rows.length) {
    return { error: '正在核对已开票记录，请稍后再试', items: [], totalCents: 0 }
  }
  const items = rows.map((row, i) => ({
    id: ids[i],
    number: row.billNumber || row.statementNo || ids[i],
    period: (() => {
      const months = channelBillMonths(row)
      return months.length > 1 ? months[0] + ' — ' + months[months.length - 1] : months[0] || String(row.settlementMonth || '')
    })(),
    game: String(row.gameName || ''),
    settlementCents: asCents(row.settlementAmount),
    receivedCents: asCents(row.receivedAmount),
    invoicedCents: asCents(summaries[i]?.allocated_amount),
    remainingCents: asCents(summaries[i]?.remaining_amount)
  }))
  if (items.some(item => item.remainingCents <= 0)) {
    return { error: '选中的账单包含已全额开票项目，请取消该项，避免重复开票', items, totalCents: 0 }
  }
  if (items.some(item => item.remainingCents > item.settlementCents)) {
    return { error: '有账单的剩余开票金额超出账单结算额，请先核实开票记录', items, totalCents: 0 }
  }
  const totalCents = items.reduce((total, item) => total + item.remainingCents, 0)
  return {
    error: '',
    items,
    partnerName: partners[0],
    totalCents
  }
}

export function yuanFromCents(cents) {
  return (cents / 100).toFixed(2)
}
