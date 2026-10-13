import { describe, expect, it } from 'vitest'
import { prepareRdInvoiceMerge } from './rdInvoiceMerge.js'

const rows = [
  {
    id: 'rd-july', status: 'confirmed', partner: '深圳研发合作方有限公司',
    settlementNumber: 'JS-202607-001', settlementMonth: '2026-07',
    settlementAmount: '1839.23', paidAmount: '1839.23', prepaymentDeduction: '0.00'
  },
  {
    id: 'rd-aug', status: 'confirmed', partner: '深圳研发合作方有限公司',
    settlementNumber: 'JS-202608-001', settlementMonth: '2026-08',
    settlementAmount: '2517.57', paidAmount: '0.00', prepaymentDeduction: '500.00'
  }
]
const summaries = [
  { bill_type: 'rd', bill_id: 'rd-july', bill_amount: 1839.23, allocated_amount: 0, remaining_amount: 1839.23 },
  { bill_type: 'rd', bill_id: 'rd-aug', bill_amount: 2517.57, allocated_amount: 0, remaining_amount: 2517.57 }
]

describe('merged R&D input invoice selection', () => {
  it('adds invoice coverage from saved original settlement, not unpaid cash', () => {
    const result = prepareRdInvoiceMerge(rows, summaries)
    expect(result.error).toBe('')
    expect(result.totalCents).toBe(435680)
    expect(result.items).toHaveLength(2)
    expect(result.items[0].paidCents).toBe(183923)
    expect(result.items[0].remainingCents).toBe(183923)
    expect(result.items[1].prepaymentCents).toBe(50000)
    expect(result.items[1].remainingCents).toBe(251757)
  })

  it('subtracts active invoice allocations only, without changing bill data', () => {
    const original = JSON.stringify(rows)
    const result = prepareRdInvoiceMerge(rows, [
      { ...summaries[0], allocated_amount: 500.04, remaining_amount: 1339.19 },
      summaries[1]
    ])
    expect(result.error).toBe('')
    expect(result.totalCents).toBe(385676)
    expect(JSON.stringify(rows)).toBe(original)
  })

  it('blocks two legal entities even when short names match', () => {
    const bad = [{ ...rows[0] }, { ...rows[1], partner: '另一家研发公司有限公司' }]
    expect(prepareRdInvoiceMerge(bad, summaries).error).toContain('同一研发公司')
  })

  it('rejects draft, cancelled, zero or negative settlement', () => {
    expect(prepareRdInvoiceMerge([{ ...rows[0], status: 'pending' }], [summaries[0]]).error).toContain('核对')
    expect(prepareRdInvoiceMerge([{ ...rows[0], status: 'cancelled' }], [summaries[0]]).error).toContain('核对')
    expect(prepareRdInvoiceMerge([{ ...rows[0], settlementAmount: '0.00' }], [summaries[0]]).error).toContain('零结算')
    expect(prepareRdInvoiceMerge([{ ...rows[0], settlementAmount: '-50' }], [summaries[0]]).error).toContain('零结算')
  })

  it('blocks fully invoiced bills from double registration', () => {
    const used = [{ ...summaries[0], remaining_amount: 0, allocated_amount: 1839.23 }]
    expect(prepareRdInvoiceMerge([rows[0]], used).error).toContain('全额收票')
  })

  it('blocks stale summary, wrong type and wrong bill identity', () => {
    expect(prepareRdInvoiceMerge(rows, null).error).toContain('查询')
    expect(prepareRdInvoiceMerge([rows[0]], [{ ...summaries[0], bill_type: 'channel' }]).error).toContain('不一致')
    expect(prepareRdInvoiceMerge([rows[0]], [{ ...summaries[0], bill_id: 'other' }]).error).toContain('不一致')
    expect(prepareRdInvoiceMerge([rows[0]], [{ ...summaries[0], bill_amount: 1839.22 }]).error).toContain('不一致')
  })

  it('prevents duplicate IDs and oversized batches', () => {
    expect(prepareRdInvoiceMerge([rows[0], rows[0]], summaries).error).toContain('重复')
    expect(prepareRdInvoiceMerge(Array.from({ length: 31 }, (_, i) => ({ ...rows[0], id: String(i) })), []).error).toContain('30')
  })
})
