import { describe, expect, it } from 'vitest'
import { billDueInfo, dueDateFromPaymentTerms, dueStatusText } from './billDueDate.js'

describe('bill due date', () => {
  it('parses next-month calendar day terms', () => {
    expect(dueDateFromPaymentTerms('2026-07', '次月20日前付款')).toBe('2026-08-20')
  })

  it('parses next-month end terms', () => {
    expect(dueDateFromPaymentTerms('2026-01', '次月底结算')).toBe('2026-02-28')
  })

  it('parses month-end plus days terms', () => {
    expect(dueDateFromPaymentTerms('2026-07', '月结30天')).toBe('2026-08-30')
    expect(dueDateFromPaymentTerms('2026-07', 'T+15')).toBe('2026-08-15')
  })

  it('uses the earliest calculable due date for a multi-period bill', () => {
    const info = billDueInfo({
      lines: [
        { settlement_cycle: '2026-07', match: { payment_terms: '次月20日' } },
        { settlement_cycle: '2026-06', match: { payment_terms: '次月20日' } }
      ]
    }, '2026-08-11')
    expect(info.dueDate).toBe('2026-07-20')
    expect(info.overdueDays).toBe(22)
    expect(dueStatusText(info, { settled: false, remainingKnown: true })).toBe('逾期 22 天')
  })

  it('does not invent a date for invoice-triggered terms', () => {
    expect(dueDateFromPaymentTerms('2026-07', '收到发票后30天付款')).toBe(null)
  })
})
