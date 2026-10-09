const JD_HASH_PREFIX = '#jd-expense?'

const compact = (value) => String(value ?? '').replace(/\s+/g, '').trim()

function valueAfterLabel(rows, target) {
  const label = compact(target)
  for (const row of rows || []) {
    const index = (row || []).findIndex((value) => compact(value) === label)
    if (index >= 0) return row[index + 1]
  }
  return null
}

function toAmount(value, label) {
  const amount = Number(String(value ?? '').replace(/[¥￥,，\s]/g, ''))
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount * 100 + 1e-7)) {
    throw new Error(`${label}无效，请检查京东账单`)
  }
  return Math.round(amount * 100) / 100
}

function makeJdBill({ period, billNo, amount, count, original, discount, company = '', payee = '' }) {
  const match = String(period || '').trim().match(/^(20\d{2}-\d{2}-\d{2})\s*-\s*(20\d{2}-\d{2}-\d{2})$/)
  if (!match || match[1].slice(0, 7) !== match[2].slice(0, 7) || match[1] > match[2]) {
    throw new Error('京东账单结算周期格式无效')
  }
  if (!/^BR[A-Z0-9-]{8,45}$/.test(String(billNo || '').trim())) {
    throw new Error('京东账单结算单号无效')
  }
  const total = toAmount(amount, '应付金额')
  const shipmentCount = Number(count)
  if (!Number.isInteger(shipmentCount) || shipmentCount <= 0 || shipmentCount > 100000) {
    throw new Error('京东账单单量无效')
  }
  const originalAmount = Number(original)
  const discountAmount = Number(discount)
  if (!Number.isFinite(originalAmount) || originalAmount < total || !Number.isFinite(discountAmount) || discountAmount < 0 || Math.abs(originalAmount - discountAmount - total) > 0.011) {
    throw new Error('京东账单金额、优惠及应付合计不一致')
  }
  return {
    expenseMonth: match[1].slice(0, 7),
    periodStart: match[1],
    periodEnd: match[2],
    billNo: String(billNo).trim(),
    amount: total,
    count: shipmentCount,
    original: Math.round(originalAmount * 100) / 100,
    discount: Math.round(discountAmount * 100) / 100,
    company: String(company || '').trim().slice(0, 160),
    payee: String(payee || '').trim().slice(0, 160)
  }
}

/** Read JD Logistics' monthly summary sheet; do not upload package/recipient details. */
export function parseJdLogisticsBillRows(summaryRows, detailRows = []) {
  if (!(summaryRows || []).slice(0, 6).some((row) => (row || []).some((value) => compact(value).includes('京东物流账单明细')))) {
    throw new Error('文件不是京东物流账单汇总页')
  }
  if (!compact(valueAfterLabel(summaryRows, '费用科目')).includes('收派服务费')) {
    throw new Error('当前只支持京东物流收派服务费账单')
  }
  const summary = makeJdBill({
    period: valueAfterLabel(summaryRows, '结算日期'),
    billNo: valueAfterLabel(summaryRows, '结算单号'),
    amount: valueAfterLabel(summaryRows, '应付合计'),
    count: valueAfterLabel(summaryRows, '单量'),
    original: null,
    discount: null,
    company: valueAfterLabel(summaryRows, '客户名称'),
    payee: valueAfterLabel(summaryRows, '涉及主体如下')
  })
  return summary
}

export function parseJdBillWithDetails(summaryRows, detailRows = []) {
  const header = (summaryRows || []).find((row) => (row || []).some((v) => compact(v) === '商家编号') && (row || []).some((v) => compact(v) === '结算金额'))
  if (!header) throw new Error('未找到京东物流结算金额明细')
  const cType = header.findIndex((v) => compact(v) === '费用类型')
  const cOriginal = header.findIndex((v) => compact(v) === '原始金额')
  const cDiscount = header.findIndex((v) => compact(v) === '折扣金额')
  const cAmount = header.findIndex((v) => compact(v) === '结算金额')
  const feeRow = (summaryRows || []).find((row) => compact((row || [])[cType]) === '快递运费')
  if (!feeRow) throw new Error('未找到快递运费结算项目')
  const enriched = (summaryRows || []).map((row) => [...(row || [])])
  // Reuse label-based parser while validating invoice math.
  const initial = Object.fromEntries(['结算日期','结算单号','应付合计','单量','客户名称','涉及主体如下'].map(label => [label, valueAfterLabel(summaryRows,label)]))
  const bill = makeJdBill({
    period: initial['结算日期'], billNo: initial['结算单号'], amount: initial['应付合计'],
    count: initial['单量'], original: feeRow[cOriginal], discount: feeRow[cDiscount],
    company: initial['客户名称'], payee: initial['涉及主体如下']
  })
  if (Math.abs(Number(feeRow[cAmount]) - bill.amount) > .011) {
    throw new Error('账单快递运费与应付合计不一致')
  }
  if (detailRows.length > 1) {
    const detailHeader = detailRows[0] || []
    const cWaybill = detailHeader.indexOf('运单号')
    const cDetailFee = detailHeader.indexOf('费用类型')
    const cSettlement = detailHeader.indexOf('结算金额')
    if (cWaybill < 0 || cDetailFee < 0 || cSettlement < 0) throw new Error('明细表缺少快递运费字段')
    const fees = detailRows.slice(1).filter((row) => compact(row[cDetailFee]) === '快递运费')
    const amount = fees.reduce((total, row) => total + Number(row[cSettlement] || 0), 0)
    const count = new Set(fees.map((row) => compact(row[cWaybill]))).size
    if (count !== bill.count || Math.abs(amount - bill.amount) > .011) throw new Error('账单汇总与运单明细不一致')
  }
  return bill
}

export function parseJdExpenseHash(hash) {
  if (!String(hash || '').startsWith(JD_HASH_PREFIX)) return null
  const params = new URLSearchParams(String(hash).slice(JD_HASH_PREFIX.length))
  const month = params.get('month') || ''
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('快捷录入月份无效')
  const endDay = new Date(Number(month.slice(0,4)), Number(month.slice(5)), 0).getDate()
  return makeJdBill({
    period: `${month}-01 - ${month}-${String(endDay).padStart(2,'0')}`,
    billNo: params.get('billNo'), amount: params.get('amount'), count: params.get('count'),
    original: params.get('original'), discount: params.get('discount')
  })
}

export function jdBillToExpenseForm(bill, defaultForm) {
  const format = (value) => Number(value).toFixed(2)
  return {
    ...defaultForm,
    expenseMonth: bill.expenseMonth,
    amount: format(bill.amount),
    vendorName: '京东物流',
    expenseSubcategory: 'courier_logistics',
    paymentStatus: 'unpaid',
    paymentDate: '',
    invoiceStatus: 'pending',
    dueDate: '',
    voucherNote: `京东物流结算单号：${bill.billNo}`,
    remark: `收派服务费 · ${bill.count}单 · ${bill.periodStart}至${bill.periodEnd} · 原价¥${format(bill.original)}，折扣¥${format(bill.discount)}，结算¥${format(bill.amount)}${bill.payee ? ` · 收款主体：${bill.payee}` : ''}`,
    importBillNo: bill.billNo
  }
}
