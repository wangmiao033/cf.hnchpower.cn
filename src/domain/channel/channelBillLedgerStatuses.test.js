import { describe, expect, it } from 'vitest'
import { channelBillLedgerStatuses } from './channelBillLedgerStatuses.js'

const row = (status) => ({ id: 'BILL-1', status })

describe('channel review and payment statuses remain independent', () => {
  it('labels an audited but entirely unpaid monthly bill as 已核对 and 未收款', () => {
    const state = channelBillLedgerStatuses(row('confirmed'), { settlement: 864.83, received: 0 })
    expect(state.review.label).toBe('已核对')
    expect(state.receipt.label).toBe('未收款')
    expect(state.variance).toBe(null)
  })

  it('never infers 已核对 from a mathematically matching or paid pending bill', () => {
    const noReceipt = channelBillLedgerStatuses({ status: 'pending', validationStatus: 'pass' }, { settlement: 52.37 })
    expect(noReceipt.review.label).toBe('待核对')
    expect(noReceipt.receipt.label).toBe('未收款')
    const paid = channelBillLedgerStatuses(row('pending'), { settlement: 52.37, received: 52.37, settled: true })
    expect(paid.review.label).toBe('待核对')
    expect(paid.receipt.label).toBe('已结清')
  })

  it('tracks partial cash collection separately from lifecycle confirmation', () => {
    const state = channelBillLedgerStatuses(row('confirmed'), { settlement: 220.24, received: 100 })
    expect(state.review.label).toBe('已核对')
    expect(state.receipt.label).toBe('部分收款')
  })

  it('preserves recorded platform anomalies without concealing approval status', () => {
    const reviewed = channelBillLedgerStatuses(row('confirmed'), {
      settlement: 475.81, received: 0, difference: true
    })
    expect(reviewed.review.label).toBe('已核对')
    expect(reviewed.receipt.label).toBe('未收款')
    expect(reviewed.variance?.label).toBe('差异留痕')

    const pending = channelBillLedgerStatuses(row('pending'), {
      settlement: 475.81, difference: true
    })
    expect(pending.review.label).toBe('待核对')
    expect(pending.variance?.label).toBe('金额待核')
  })

  it('shows accumulation alongside—not instead of—an unpaid receipt state', () => {
    const state = channelBillLedgerStatuses(row('confirmed'), {
      settlement: 475.81, cumulative: true, cumulativeState: 'accumulating'
    })
    expect(state.receipt.label).toBe('未收款')
    expect(state.accumulation?.label).toBe('累计中')
    const ready = channelBillLedgerStatuses(row('confirmed'), {
      settlement: 475.81, cumulative: true, cumulativeState: 'ready'
    })
    expect(ready.accumulation?.label).toBe('累计达标')
  })

  it('keeps cancelled and archived bills distinct from current verification or receipts', () => {
    const voided = channelBillLedgerStatuses(row('cancelled'), {
      cancelled: true, settlement: 100, difference: true
    })
    expect(voided.review.label).toBe('已作废')
    expect(voided.receipt.label).toBe('—')
    expect(voided.variance).toBe(null)
    const archived = channelBillLedgerStatuses(row('confirmed'), {
      archived: true, settlement: 100, received: 100, settled: true
    })
    expect(archived.review.label).toBe('已归档')
    expect(archived.receipt.label).toBe('已结清')
  })

  it('uses 无需收款 on zero-receivable months rather than falsely claiming money arrived', () => {
    const zero = channelBillLedgerStatuses(row('confirmed'), { settlement: 0, received: 0, settled: true })
    expect(zero.review.label).toBe('已核对')
    expect(zero.receipt.label).toBe('无需收款')
  })
})
