const RECEIPT_HASH_PREFIX = '#wecom-expense?'
const MERCHANT_NAME = '企业微信高级功能'
const ACCOUNTING_REMARK = '企业微信认证费（企业微信高级功能）'

function isRealDate(text) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text
}

/** Reads a fragment-only receipt: it does not submit or change any accounting data. */
export function parseWecomReceiptHash(hash) {
  if (!String(hash || '').startsWith(RECEIPT_HASH_PREFIX)) return null
  const params = new URLSearchParams(String(hash).slice(RECEIPT_HASH_PREFIX.length))
  const paymentDate = params.get('date') || ''
  const paymentTime = params.get('time') || ''
  const rawAmount = params.get('amount')
  const amount = Number(rawAmount)
  if (!isRealDate(paymentDate)) throw new Error('企业微信付款日期无效')
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(paymentTime)) throw new Error('企业微信付款时间无效')
  if (rawAmount === null || rawAmount.trim() === '' || !Number.isFinite(amount) || amount <= 0 || amount > 1e8 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.001) {
    throw new Error('企业微信付款金额无效')
  }
  return {
    paymentDate,
    paymentTime,
    amount: Math.round(amount * 100) / 100,
    expenseMonth: paymentDate.slice(0, 7)
  }
}

export function wecomReceiptToExpenseForm(receipt, defaultForm = {}) {
  const total = Number(receipt.amount).toFixed(2)
  return {
    ...defaultForm,
    expenseMonth: receipt.expenseMonth,
    amount: total,
    vendorName: MERCHANT_NAME,
    paymentStatus: 'paid',
    paymentDate: receipt.paymentDate,
    invoiceStatus: 'pending',
    invoiceNumber: '',
    dueDate: '',
    voucherNote: `微信支付 · 零钱通 · ${receipt.paymentDate} ${receipt.paymentTime} · ¥${total}（账单截图）`,
    remark: ACCOUNTING_REMARK,
    wecomReceiptFingerprint: `${receipt.paymentDate}|${total}`
  }
}

export function hasDuplicateWecomExpense(rows, receipt) {
  const paymentDate = receipt.paymentDate
  const amount = Math.round(Number(receipt.amount) * 100)
  return (rows || []).some((row) => (
    row.expense_month === receipt.expenseMonth
    && row.payment_date === paymentDate
    && Math.round(Number(row.amount || 0) * 100) === amount
    && ((row.vendor_name || '').includes('企业微信') || (row.remark || '').includes('企业微信认证费'))
  ))
}
