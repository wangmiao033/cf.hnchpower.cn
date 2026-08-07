function number(value) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeBillMonth(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/(20\d{2})\D{0,3}(1[0-2]|0?[1-9])(?:\D|$)/)
  if (!match) return ''
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
}

export function bill360PartnerName(billType, record) {
  if (billType === 'channel') {
    return String(record?.partnerName || record?.channelName || '').trim()
  }
  return String(record?.partnerShortName || record?.partner || record?.partyBName || '').trim()
}

export function bill360Number(billType, record) {
  if (billType === 'channel') {
    return String(record?.billNumber || record?.statementNo || '').trim()
  }
  return String(record?.settlementNumber || record?.statementNo || '').trim()
}

export function bill360Lines(billType, record) {
  const items = Array.isArray(record?.items) ? record.items : []
  if (items.length > 0) {
    return items.map((item, index) => {
      if (billType === 'channel') {
        return {
          key: String(item.id || index),
          month: normalizeBillMonth(item.settlementCycle || record?.settlementMonth),
          game: String(item.gameName || record?.gameName || '').trim(),
          flow: number(item.flow ?? item.billingFlow ?? item.revenue),
          shareRate: number(item.shareRate),
          shareAmount: number(item.shareAmount),
          settlementAmount: number(item.settlementAmount),
          discount: number(item.discountFactor ?? 1),
          taxRate: number(item.taxRate),
          extraAmount: number(item.refundCost ?? item.extraFee)
        }
      }
      return {
        key: String(item.id || index),
        month: normalizeBillMonth(item.settlementCycle || record?.settlementMonth),
        game: String(item.gameName || record?.game || '').trim(),
        flow: number(item.revenue),
        shareRate: number(item.shareRatio),
        shareAmount: number(item.shareAmount),
        settlementAmount: number(item.settlementAmount),
        discount: number(item.discountRate ?? 1),
        taxRate: number(item.taxRate),
        extraAmount: number(item.extraFee)
      }
    })
  }

  return [
    {
      key: 'legacy',
      month: normalizeBillMonth(record?.settlementMonth),
      game: String(billType === 'channel' ? record?.gameName : record?.game || '').trim(),
      flow: number(billType === 'channel' ? record?.flow : record?.gameFlow),
      shareRate: number(billType === 'channel' ? record?.shareRate : record?.revenueShareRatio),
      shareAmount: number(record?.shareAmount),
      settlementAmount: number(record?.settlementAmount),
      discount: number(billType === 'channel' ? 1 : record?.discount || 1),
      taxRate: number(billType === 'channel' ? record?.taxRate : record?.taxPoint),
      extraAmount: number(billType === 'channel' ? record?.refundCost : record?.refund)
    }
  ]
}

export function bill360QuickSdkKeys(billType, record) {
  if (billType !== 'rd') return []
  const seen = new Set()
  const out = []
  for (const line of bill360Lines(billType, record)) {
    if (!line.game || !line.month) continue
    const key = `${line.month}::${line.game}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, month: line.month, game: line.game })
  }
  return out
}

export function summarizeBill360({ billType, record, invoiceSummary, quickSdkRows = [] }) {
  const settlementAmount = Math.abs(number(record?.settlementAmount))
  const paidAmount = Math.abs(
    number(billType === 'channel' ? record?.receivedAmount ?? record?.paidAmount : record?.paidAmount)
  )
  const unpaidAmount = Math.max(0, settlementAmount - paidAmount)
  const invoiceAllocated = Math.abs(number(invoiceSummary?.allocated_amount))
  const invoiceRemaining = Math.max(0, number(invoiceSummary?.remaining_amount ?? settlementAmount))
  const billFlow = bill360Lines(billType, record).reduce((sum, line) => sum + number(line.flow), 0)
  const databaseFlow = quickSdkRows.reduce((sum, row) => sum + number(row?.total_flow), 0)
  const flowDifference = billType === 'rd' && quickSdkRows.length > 0 ? databaseFlow - billFlow : null

  return {
    settlementAmount,
    paidAmount,
    unpaidAmount,
    paymentPercent: settlementAmount > 0 ? Math.min(100, (paidAmount / settlementAmount) * 100) : 0,
    invoiceAllocated,
    invoiceRemaining,
    invoicePercent: settlementAmount > 0 ? Math.min(999.9, (invoiceAllocated / settlementAmount) * 100) : 0,
    billFlow,
    databaseFlow,
    flowDifference,
    flowMatched: flowDifference == null ? null : Math.abs(flowDifference) <= 0.01
  }
}

export function normalizeCompanyName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s()（）·,，.。\-_/\\]/g, '')
    .replace(/股份有限公司$/g, '')
    .replace(/有限责任公司$/g, '')
    .replace(/有限公司$/g, '')
}

export function filterBill360Contracts(contracts, partnerName, partnerId = '') {
  if (!Array.isArray(contracts)) return []
  const normalizedName = normalizeCompanyName(partnerName)
  return contracts.filter((contract) => {
    if (partnerId && String(contract?.partner_id || '') === String(partnerId)) return true
    const candidates = [contract?.partner_name, contract?.partner_short_name, contract?.counterparty]
      .map(normalizeCompanyName)
      .filter(Boolean)
    return normalizedName && candidates.some((value) => value === normalizedName || value.includes(normalizedName) || normalizedName.includes(value))
  })
}
