import { describe, expect, it } from 'vitest'
import {
  buildElectronicInvoiceRecord,
  calculateTaxSplit,
  taskInvoiceAmountState
} from './electronicInvoiceQuickEntry.js'

describe('electronic invoice quick entry', () => {
  it('splits gross amount at 6% VAT', () => {
    expect(calculateTaxSplit(1145.05, 6)).toEqual({ net: 1080.24, tax: 64.81, gross: 1145.05 })
  })

  it('uses task partner and amount when file fields are incomplete', () => {
    const record = buildElectronicInvoiceRecord(
      { digital_invoice_no: '26442000002619268196', invoice_date: '2026-03-11' },
      { partner_name: '上海趣淘网络科技有限公司', requested_amount: 1145.05 },
      6
    )
    expect(record.buyer_name).toBe('上海趣淘网络科技有限公司')
    expect(record.amount_with_tax).toBe(1145.05)
    expect(record.invoice_amount).toBe(1080.24)
    expect(record.tax_amount).toBe(64.81)
  })

  it('distinguishes match, partial and over-invoice task amounts', () => {
    expect(taskInvoiceAmountState(100, 100).key).toBe('match')
    expect(taskInvoiceAmountState(60, 100)).toMatchObject({ key: 'partial', allocationAmount: 60 })
    expect(taskInvoiceAmountState(120, 100)).toMatchObject({ key: 'over', allocationAmount: 100 })
  })
})
