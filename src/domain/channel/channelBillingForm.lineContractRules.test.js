import { describe, expect, it } from 'vitest'
import {
  buildFullChannelRecord,
  calculateSettlementDetails,
  initialHeaderForm,
  resolveChannelLineRuleHeader
} from './channelBillingForm.js'

function baseLine(overrides = {}) {
  return {
    settlementCycle: '2026-01',
    gameName: '测试游戏',
    flow: '1000',
    discountFactor: '1',
    voucherCost: '0',
    noWorryCost: '0',
    refundCost: '0',
    testCost: '0',
    welfareCost: '0',
    coinCost: '0',
    shareRate: '30',
    taxRate: '0',
    gatewayCost: '',
    platformSettlementAmount: '',
    ...overrides
  }
}

const fivePercentHeader = {
  ...initialHeaderForm,
  partnerName: '测试渠道公司',
  channelName: '测试渠道',
  settlementRuleCode: 'five_percent_gateway_share',
  channelFeeMode: 'percent',
  channelFeeRate: '5',
  taxMode: 'none',
  validationTolerance: '0.05'
}

describe('渠道账单按明细合同规则计算', () => {
  it('行级不扣通道费可以覆盖账单头部 5% 通道费', () => {
    const row = baseLine({
      gameName: '龙吟大陆',
      flow: '34811.2',
      shareRate: '3',
      platformSettlementAmount: '1044.34',
      settlementRuleCode: 'share_only',
      channelFeeMode: 'none',
      channelFeeRate: '0',
      taxMode: 'none'
    })

    const effectiveRule = resolveChannelLineRuleHeader(row, fivePercentHeader)
    const details = calculateSettlementDetails(row, fivePercentHeader)

    expect(effectiveRule.channelFeeMode).toBe('none')
    expect(Number(effectiveRule.channelFeeRate)).toBe(0)
    expect(details.systemSettlementAmount).toBe(1044.34)
    expect(details.settlementDifference).toBe(0)
    expect(details.validationStatus).toBe('pass')
  })

  it('同一张账单可同时存在 5% 通道费与 0% 通道费', () => {
    const record = buildFullChannelRecord(fivePercentHeader, [
      baseLine({
        gameName: '游戏A',
        platformSettlementAmount: '285',
        settlementRuleCode: 'five_percent_gateway_share',
        channelFeeMode: 'percent',
        channelFeeRate: '5',
        taxMode: 'none'
      }),
      baseLine({
        gameName: '龙吟大陆',
        shareRate: '3',
        platformSettlementAmount: '30',
        settlementRuleCode: 'share_only',
        channelFeeMode: 'none',
        channelFeeRate: '0',
        taxMode: 'none'
      })
    ])

    expect(record.items[0].systemSettlementAmount).toBe(285)
    expect(record.items[1].systemSettlementAmount).toBe(30)
    expect(record.items[0].channelFeeRate).toBe(5)
    expect(record.items[1].channelFeeRate).toBe(0)
    expect(record.systemSettlementAmount).toBe(315)
    expect(record.platformSettlementAmount).toBe(315)
    expect(record.settlementDifference).toBe(0)
    expect(record.validationStatus).toBe('pass')
  })
})