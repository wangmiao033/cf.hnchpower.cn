import { describe, expect, it } from 'vitest'
import { assessChannelSmallVariancePreflight } from './channelSmallVarianceReview.js'

const line = {
  line_id: 'current-line',
  game_name: '云上征途（0.05飞升启航版）',
  status: 'fail',
  contract_amount: {
    status: 'pass',
    actual_amount: 0.65,
    expected_amount: 0.61
  },
  checks: [
    { key: 'share_rate', status: 'fail', label: '分成比例', bill_value: 28, contract_value: 25 },
    { key: 'channel_fee_rate', status: 'fail', label: '通道费', bill_value: 5, contract_value: 0 }
  ]
}

describe('small-variance contract preflight', () => {
  it('can advance the approved ¥0.04 financial discrepancy for admin confirmation', () => {
    const result = assessChannelSmallVariancePreflight({ bill_checks: [], lines: [line] })
    expect(result.error).toBe('')
    expect(result.totalCents).toBe(4)
    expect(result.affectedLineIds).toEqual(['current-line'])
  })

  it('does not count two resolved cases as an ¥0.08 variance', () => {
    const result = assessChannelSmallVariancePreflight({ bill_checks: [], lines: [{
      ...line,
      status: 'pass',
      checks: line.checks.map(item => ({ ...item, status: 'pass' }))
    }] })
    expect(result.totalCents).toBe(0)
    expect(result.affectedLineIds).toHaveLength(0)
  })

  it('blocks hard authorization and wrong partner identity', () => {
    const changed = {
      ...line, checks: [...line.checks, { key: 'authorization', status: 'fail', label: '合同授权' }]
    }
    expect(assessChannelSmallVariancePreflight({ lines: [changed] }).error).toMatch(/不可豁免/)
    expect(assessChannelSmallVariancePreflight({
      lines: [line], bill_checks: [{ key: 'partner_identity', status: 'fail' }]
    }).error).toMatch(/账单级/)
  })

  it('blocks any over-fifty-cent contract amount change', () => {
    expect(assessChannelSmallVariancePreflight({
      lines: [{ ...line, contract_amount: { actual_amount: 1.25, expected_amount: 0.61, status: 'fail' } }]
    }).error).toMatch(/超过0.50元/)
  })

  it('requires an available live contract response', () => {
    expect(assessChannelSmallVariancePreflight(null).error).toMatch(/未返回完整数据/)
  })
})
