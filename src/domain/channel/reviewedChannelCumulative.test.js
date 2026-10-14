import { describe, it, expect } from 'vitest'
import { describeReviewedChannelCumulative } from './reviewedChannelCumulative.js'

const condition = {
  mode: 'threshold', policy: { enabled: true, threshold_basis: 'settlement_amount', threshold_amount: 1000 },
  deferred: true, state: 'accumulating', batch: null
}

describe('confirmed channel bill cumulative status from server', () => {
  it('shows true server-confirmed pool membership and actual amount', () => {
    const result = describeReviewedChannelCumulative(condition, 475.81)
    expect(result.title).toBe('本单已纳入累计待结算池')
    expect(result.description).toContain('¥475.81')
    expect(result.description).toContain('不代表已开票或已收款')
  })
  it('does not mistake configured policies or settled cases for membership', () => {
    expect(describeReviewedChannelCumulative({
      mode: 'periodic', policy: { enabled: false }
    }).title).toContain('尚未启用')
    expect(describeReviewedChannelCumulative({
      ...condition, state: 'financial_activity_started', deferred: false
    }).title).toContain('未进入当前累计池')
    expect(describeReviewedChannelCumulative({
      ...condition, state: 'not_applicable', deferred: false
    }).title).toContain('不满足入池条件')
  })
  it('preserves batch number and reached-threshold distinction', () => {
    expect(describeReviewedChannelCumulative({
      ...condition, state: 'batched', deferred: false, batch: { batch_no: 'B-202609-001' }
    }).description).toContain('B-202609-001')
    expect(describeReviewedChannelCumulative({
      ...condition, state: 'ready'
    }).description).toContain('不代表已经收到款')
  })
})
