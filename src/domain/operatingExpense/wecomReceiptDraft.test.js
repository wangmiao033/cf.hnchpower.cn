import { describe, expect, it } from 'vitest'
import { hasDuplicateWecomExpense, parseWecomReceiptHash, wecomReceiptToExpenseForm } from './wecomReceiptDraft.js'

describe('WeCom ¥300 paid receipt quick-entry', () => {
  const receipt = parseWecomReceiptHash('#wecom-expense?date=2026-10-08&time=15%3A58&amount=300')
  it('fills October, ¥300, paid and not-yet-invoiced fields', () => {
    expect(receipt).toMatchObject({ paymentDate:'2026-10-08', paymentTime:'15:58', amount:300, expenseMonth:'2026-10' })
    const form = wecomReceiptToExpenseForm(receipt, { invoiceStatus:'received' })
    expect(form).toMatchObject({
      expenseMonth:'2026-10', amount:'300.00', vendorName:'企业微信高级功能',
      paymentDate:'2026-10-08', paymentStatus:'paid', invoiceStatus:'pending',
      remark:'企业微信认证费（企业微信高级功能）'
    })
    expect(form.voucherNote).toContain('零钱通')
    expect(form.voucherNote).toContain('15:58')
  })
  it('does not match unrelated URL fragments', () => {
    expect(parseWecomReceiptHash('#jd-expense?amount=171')).toBe(null)
  })
  it('validates amount and actual dates', () => {
    expect(() => parseWecomReceiptHash('#wecom-expense?date=2026-02-31&time=15%3A58&amount=300')).toThrow()
    expect(() => parseWecomReceiptHash('#wecom-expense?date=2026-10-08&time=15%3A58&amount=0')).toThrow()
    expect(() => parseWecomReceiptHash('#wecom-expense?date=2026-10-08&time=25%3A58&amount=300')).toThrow()
  })
  it('detects identical already-recorded enterprise WeChat payments', () => {
    const base = { expense_month:'2026-10', payment_date:'2026-10-08', amount:300, vendor_name:'企业微信高级功能' }
    expect(hasDuplicateWecomExpense([base], receipt)).toBe(true)
    expect(hasDuplicateWecomExpense([{ ...base, amount:171 }], receipt)).toBe(false)
    expect(hasDuplicateWecomExpense([{ ...base, payment_date:'2026-10-07' }], receipt)).toBe(false)
    expect(hasDuplicateWecomExpense([{ ...base, vendor_name:'京东快递', remark:'快递费' }], receipt)).toBe(false)
  })
})
