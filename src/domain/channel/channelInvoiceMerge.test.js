import { describe, expect, it } from 'vitest'
import { prepareChannelInvoiceMerge } from './channelInvoiceMerge.js'

const rows = [
  { id: 'july', status: 'confirmed', partnerName: '上海合作方公司', settlementMonth: '2026-07', statementNo: 'B-07', settlementAmount: 479.52, receivedAmount: 0 },
  { id: 'may-june', status: 'confirmed', partnerName: '上海合作方公司', settlementMonth: '2026-05', statementNo: 'B-05', settlementAmount: 475.53, receivedAmount: 0 }
]

const summary = [
  { bill_id: 'july', bill_amount: 479.52, allocated_amount: 0, remaining_amount: 479.52 },
  { bill_id: 'may-june', bill_amount: 475.53, allocated_amount: 0, remaining_amount: 475.53 }
]

describe('channel merged invoicing selection', () => {
  it('uses actual invoice coverage and combines 479.52 + 475.53 to 955.05', () => {
    const result = prepareChannelInvoiceMerge(rows, summary)
    expect(result.error).toBe('')
    expect(result.items).toHaveLength(2)
    expect(result.totalCents).toBe(95505)
    expect(result.partnerName).toBe('上海合作方公司')
  })

  it('does not treat payment receipts as already invoiced', () => {
    const result = prepareChannelInvoiceMerge([{ ...rows[0], receivedAmount: 479.52 }], [summary[0]])
    expect(result.totalCents).toBe(47952)
  })

  it('subtracts previously linked invoice amounts from gross', () => {
    const result = prepareChannelInvoiceMerge(rows, [
      { ...summary[0], allocated_amount: 100, remaining_amount: 379.52 },
      summary[1]
    ])
    expect(result.totalCents).toBe(85505)
    expect(result.items[0].invoicedCents).toBe(10000)
  })

  it('blocks combining two different company entities', () => {
    const result = prepareChannelInvoiceMerge([{ ...rows[0] }, { ...rows[1], partnerName: '另一个法人主体' }], summary)
    expect(result.error).toMatch(/同一合作方/)
  })

  it('blocks unconfirmed invoices, no partner, and zero settlement', () => {
    expect(prepareChannelInvoiceMerge([{ ...rows[0], status: 'pending' }], [summary[0]]).error).toMatch(/核对/)
    expect(prepareChannelInvoiceMerge([{ ...rows[0], partnerName: '' }], [summary[0]]).error).toMatch(/合作方/)
    expect(prepareChannelInvoiceMerge([{ ...rows[0], settlementAmount: 0 }], [summary[0]]).error).toMatch(/零结算/)
  })

  it('rejects an invoice that is already fully covered', () => {
    const result = prepareChannelInvoiceMerge(rows, [{ ...summary[0], allocated_amount: 479.52, remaining_amount: 0 }, summary[1]])
    expect(result.error).toMatch(/重复开票/)
  })

  it('does not allow a batch to proceed before coverage is fetched', () => {
    expect(prepareChannelInvoiceMerge(rows, null).error).toMatch(/核对/)
  })
})
