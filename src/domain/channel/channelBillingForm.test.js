import { describe, expect, it } from 'vitest'

import { buildFullChannelRecord, initialHeaderForm } from './channelBillingForm.js'

function row(flow, shareRate, taxRate, platformSettlementAmount) {
  return {
    settlementCycle: '2026-03',
    gameName: `测试-${flow}`,
    flow: String(flow),
    discountFactor: '1',
    voucherCost: '0',
    noWorryCost: '0',
    refundCost: '0',
    testCost: '0',
    welfareCost: '0',
    coinCost: '0',
    shareRate: String(shareRate),
    taxRate: String(taxRate),
    gatewayCost: '0',
    platformSettlementAmount: String(platformSettlementAmount),
    settlementRuleCode: '',
    channelFeeMode: '',
    channelFeeRate: '',
    taxMode: '',
    validationTolerance: ''
  }
}

function header() {
  return {
    ...initialHeaderForm,
    channelName: '测试渠道',
    partnerName: '测试合作方',
    settlementRuleCode: 'legacy_fixed_fee_tax',
    channelFeeMode: 'fixed',
    taxMode: 'share',
    validationTolerance: '0.05'
  }
}

describe('channel bill rounding tail', () => {
  it('rounds the final total once when every displayed line matches the platform', () => {
    const record = buildFullChannelRecord(header(), [
      row(360.86, 30, 5, 102.85),
      row(6.48, 30, 5, 1.85),
      row(15.55, 30, 5, 4.43),
      row(1747.17, 22, 0, 384.38)
    ])

    expect(record.items.map((item) => item.systemSettlementAmount)).toEqual([102.85, 1.85, 4.43, 384.38])
    expect(record.items.reduce((sum, item) => sum + item.systemSettlementAmount, 0)).toBeCloseTo(493.51, 2)
    expect(record.systemSettlementAmount).toBe(493.5)
    expect(record.platformSettlementAmount).toBe(493.51)
    expect(record.settlementDifference).toBe(-0.01)
    expect(record.validationStatus).toBe('pass')
    expect(record.settlementAmount).toBe(493.5)
  })

  it('does not rewrite ordinary platform differences as a rounding tail', () => {
    const record = buildFullChannelRecord(header(), [
      row(360.86, 30, 5, 102.86),
      row(6.48, 30, 5, 1.85),
      row(15.55, 30, 5, 4.43),
      row(1747.17, 22, 0, 384.38)
    ])

    expect(record.systemSettlementAmount).toBe(493.51)
    expect(record.platformSettlementAmount).toBe(493.52)
    expect(record.settlementDifference).toBe(-0.01)
    expect(record.validationStatus).toBe('pass')
    expect(record.settlementAmount).toBe(493.52)
  })
})
