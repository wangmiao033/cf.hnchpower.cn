/** Conservative invoice-to-channel-bill suggestions.
 *
 * Read-only matching: one legal counterparty + already-confirmed bills +
 * server invoice *remaining* balances. Never guess an invoice's amount from a
 * chat filename, and never create links until a user approves the preview.
 */
const cents = value => {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function normalizedInvoiceCompany(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s()（）·,，.。\-_/\\]/g, '')
    .toLocaleLowerCase('zh-CN')
}

export function invoiceBuyerMatchesPartner(buyer, partner) {
  const b = normalizedInvoiceCompany(buyer)
  const p = normalizedInvoiceCompany(partner)
  // Full legal names must match exactly. A short nickname or two different
  // registered companies must never be silently treated as one entity.
  return Boolean(b && p && b === p)
}

const ISSUEABLE = new Set(['confirmed','invoiced','completed','settled','reconciled','verified'])

export function eligibleInvoicePartnerRows(rows = [], legalPartner = '', excludedIds = []) {
  const excluded = new Set(excludedIds.map(String))
  const partner = normalizedInvoiceCompany(legalPartner)
  if (!partner) return []
  return (rows || []).filter(row =>
    row && row.id && !excluded.has(String(row.id)) &&
    normalizedInvoiceCompany(row.partnerName) === partner &&
    ISSUEABLE.has(String(row.status || '').trim().toLowerCase()) &&
    cents(row.settlementAmount) > 0
  ).sort((a,b) => String(b.settlementMonth || '').localeCompare(String(a.settlementMonth || '')))
}

/** Find a *unique* exact whole-bill amount match, including all base bills.
 * If multiple combinations work, offer manual selection, not one random guess.
 * Bounds ensure UI remains responsive even for large partner histories.
 */
export function recommendInvoiceBillSet(targetGross, selectedRows = [], selectedSummaries = [], extra = []) {
  const target = cents(targetGross)
  const selected = (selectedRows || []).reduce((sum, row, index) =>
    sum + cents(selectedSummaries[index]?.remaining_amount ?? row?.settlementAmount), 0)
  const need = target - selected
  if (need <= 0 || !target) return { ids: [], unique: false, ambiguous: false }
  const available = (extra || []).filter(item => cents(item?.remaining_amount) > 0).slice(0, 24)
  const solutions = new Map([[0, [[]]]])
  for (const item of available) {
    const cost = cents(item.remaining_amount)
    for (const [sum, combos] of [...solutions.entries()].reverse()) {
      const total = sum + cost
      if (total > need) continue
      for (const combo of combos) {
        if (combo.length >= 7) continue
        const pool = solutions.get(total) || []
        if (pool.length < 2) pool.push([...combo, String(item.id)])
        solutions.set(total, pool)
      }
    }
    if (solutions.size > 20000) return { ids: [], unique: false, ambiguous: true }
  }
  const exact = solutions.get(need) || []
  return {
    ids: exact.length === 1 ? exact[0] : [],
    unique: exact.length === 1,
    ambiguous: exact.length > 1
  }
}

export function scannedInvoiceAmountState(officialGross, billTotalCents) {
  const grossCents = cents(officialGross)
  const delta = grossCents - Number(billTotalCents || 0)
  if (!grossCents) return { kind: 'unreadable', delta, message: '请核对发票价税合计' }
  if (!delta) return { kind: 'match', delta, message: '发票价税合计与已选账单未开票余额一致' }
  return {
    kind: 'mismatch', delta,
    message: delta > 0
      ? '发票金额高于当前账单，请核对是否还包含其他月份账单'
      : '发票金额低于所选账单，当前弹窗不自动冲减或分摊剩余金额'
  }
}
