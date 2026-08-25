import { describe, expect, it } from 'vitest'
import { buildFullChannelRecord, initialHeaderForm, initialLineItem } from './channelBillingForm.js'

describe('channel bill settlement adjustment', () => {
  it('keeps business settlement separate and exposes the signed carry-over and tail', () => {
    const record = buildFullChannelRecord(
      {
        ...initialHeaderForm,
        channelName: '通用测试渠道',
        partnerName: '通用测试合作方',
        settlementMonth: '2025-12',
        settlementRuleCode: 'share_only',
        channelFeeMode: 'none',
        taxMode: 'none',
        settlementAdjustmentType: 'historical_carryover',
        settlementAdjustmentSourceMonth: '2025-10',
        settlementAdjustmentAmount: '-498.64',
        settlementAdjustmentReason: '历史差额结转',
        settlementFinalOverride: '376.00'
      },
      [{
        ...initialLineItem(),
        settlementCycle: '2025-12',
        gameName: '测试游戏',
        flow: '874.60',
        shareRate: '100',
        taxRate: '0',
        settlementRuleCode: 'share_only',
        channelFeeMode: 'none',
        taxMode: 'none',
        platformSettlementAmount: '874.60'
      }]
    )

    expect(record.businessSettlementAmount).toBe(874.6)
    expect(record.settlementAdjustmentAmount).toBe(-498.64)
    expect(record.settlementCalculatedAfterAdjustment).toBe(375.96)
    expect(record.settlementAdjustmentTail).toBe(0.04)
    expect(record.settlementAmount).toBe(376)
  })
})
