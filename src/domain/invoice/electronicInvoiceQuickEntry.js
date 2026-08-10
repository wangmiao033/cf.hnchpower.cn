export const DEFAULT_ELECTRONIC_SPECIAL_INVOICE_TYPE = '电子发票（增值税专用发票）'

export function calculateTaxSplit(grossValue, taxRateValue) {
  const gross = Number(grossValue)
  const taxRate = Number(taxRateValue)
  if (!Number.isFinite(gross) || gross <= 0) return { net: 0, tax: 0, gross: 0 }
  if (!Number.isFinite(taxRate) || taxRate < 0) return { net: gross, tax: 0, gross }
  const net = Math.round((gross / (1 + taxRate / 100) + Number.EPSILON) * 100) / 100
  const tax = Math.round((gross - net + Number.EPSILON) * 100) / 100
  return { net, tax, gross: Math.round((gross + Number.EPSILON) * 100) / 100 }
}

export function taskInvoiceAmountState(invoiceGrossValue, taskAmountValue, tolerance = 0.05) {
  const invoiceGross = Number(invoiceGrossValue) || 0
  const taskAmount = Number(taskAmountValue) || 0
  const difference = Math.round((invoiceGross - taskAmount + Number.EPSILON) * 100) / 100
  if (!taskAmount || Math.abs(difference) <= tolerance) {
    return { key: 'match', label: '与开票任务金额一致', difference, allocationAmount: invoiceGross }
  }
  if (difference < 0) {
    return {
      key: 'partial',
      label: `本次部分开票，剩余 ¥${Math.abs(difference).toFixed(2)} 可继续提交`,
      difference,
      allocationAmount: invoiceGross
    }
  }
  return {
    key: 'over',
    label: `发票金额高于任务 ¥${difference.toFixed(2)}，本次仅关联任务金额`,
    difference,
    allocationAmount: taskAmount
  }
}

export function buildElectronicInvoiceRecord(parsed = {}, task = null, fallbackTaxRate = 6) {
  const gross = Number(parsed.amount_with_tax || task?.requested_amount || 0)
  const taxRate = parsed.tax_rate == null || parsed.tax_rate === ''
    ? Number(fallbackTaxRate)
    : Number(parsed.tax_rate)
  const split = calculateTaxSplit(gross, taxRate)
  const net = Number(parsed.invoice_amount || 0) || split.net
  const tax = Number(parsed.tax_amount || 0) || split.tax
  const buyerName = parsed.buyer_name || task?.partner_name || ''
  return {
    invoice_direction: 'output',
    invoice_type: parsed.invoice_type || DEFAULT_ELECTRONIC_SPECIAL_INVOICE_TYPE,
    digital_invoice_no: parsed.digital_invoice_no || '',
    invoice_code: parsed.invoice_code || '',
    invoice_no: parsed.invoice_no || '',
    buyer_name: buyerName,
    buyer_tax_no: parsed.buyer_tax_no || '',
    seller_name: parsed.seller_name || '',
    seller_tax_no: parsed.seller_tax_no || '',
    title: buyerName,
    tax_no: parsed.buyer_tax_no || '',
    invoice_amount: net,
    tax_amount: tax,
    amount_with_tax: gross,
    tax_rate: taxRate,
    invoice_date: parsed.invoice_date || '',
    issuer: parsed.issuer || '',
    invoice_source: parsed.invoice_source || '电子发票文件上传',
    source_file_name: parsed.source_file_name || '',
    source_file_url: parsed.source_file_url || '',
    source_file_type: parsed.source_file_type || '',
    source_file_size: Number(parsed.source_file_size || 0),
    tax_status: 'normal',
    status: '已开',
    remark: '',
    verified: false,
    verified_amount: 0,
    verified_record_ids: []
  }
}
