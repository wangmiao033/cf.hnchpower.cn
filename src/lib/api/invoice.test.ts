import { describe, expect, it } from 'vitest'
import { frontendInvoiceRecordToPayload } from './invoice.ts'

describe('发票 API 字段映射', () => {
  it('保留进项方向、购销方和税务状态', () => {
    const payload = frontendInvoiceRecordToPayload({
      invoiceDirection: 'input',
      sellerName: '测试销售方',
      sellerTaxNo: '91440000123456789X',
      amount: 100,
      taxAmount: 6,
      amountWithTax: 106,
      status: '已开',
      taxStatus: 'normal'
    })

    expect(payload.invoice_direction).toBe('input')
    expect(payload.seller_name).toBe('测试销售方')
    expect(payload.seller_tax_no).toBe('91440000123456789X')
    expect(payload.amount_with_tax).toBe(106)
    expect(payload.tax_status).toBe('normal')
  })

  it('旧状态为作废时自动映射为税务作废', () => {
    const payload = frontendInvoiceRecordToPayload({ status: '作废' })
    expect(payload.tax_status).toBe('void')
  })
})
