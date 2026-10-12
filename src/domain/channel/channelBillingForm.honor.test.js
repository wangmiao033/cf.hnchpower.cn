import { describe, expect, it } from 'vitest'
import {
  HONOR_UPFRONT_PERCENT_FEE_RULE,
  applyTargetedChannelRule,
  buildFullChannelRecord,
  calculateSettlementDetails,
  detectChannelRulePreset,
  initialHeaderForm,
  initialLineItem
} from './channelBillingForm.js'

const honorHeader = {
  ...initialHeaderForm,
  channelName: '荣耀',
  partnerName: '深圳市荣耀软件技术有限公司'
}

function line(gameName, flow, voucherCost, platformSettlementAmount) {
  return {
    ...initialLineItem(),
    settlementCycle: '2026-08',
    gameName,
    flow: String(flow),
    discountFactor: '1',
    voucherCost: String(voucherCost),
    shareRate: '50',
    taxRate: '0',
    platformSettlementAmount: String(platformSettlementAmount)
  }
}

describe('荣耀账单通道费先扣、代金券再扣、最后分成', () => {
  it('只匹配明确的荣耀渠道名称，保持其他渠道规则不变', () => {
    expect(detectChannelRulePreset('荣耀')).toBe(HONOR_UPFRONT_PERCENT_FEE_RULE)
    expect(detectChannelRulePreset('深圳市荣耀软件技术有限公司')).toBe(HONOR_UPFRONT_PERCENT_FEE_RULE)
    expect(detectChannelRulePreset('Honor')).toBe(HONOR_UPFRONT_PERCENT_FEE_RULE)
    expect(detectChannelRulePreset('普通渠道')).toBe('')
    expect(detectChannelRulePreset('小米应用商店')).toBe('xiaomi_percent_fee')
    expect(applyTargetedChannelRule(honorHeader).settlementRuleCode).toBe(HONOR_UPFRONT_PERCENT_FEE_RULE)
    expect(applyTargetedChannelRule({ ...initialHeaderForm, channelName: '普通渠道' }).settlementRuleCode).toBe('legacy_fixed_fee_tax')
  })

  it('代金券存在时，荣耀按总流水 5% 扣通道费，不在分成后重复扣除', () => {
    const record = buildFullChannelRecord(honorHeader, [
      line('六界仙尊', 4230, 0, 2009.46),
      line('帝国雄师', 6428, 522.56, 2792.02)
    ])

    expect(record.channelFeeRate).toBe(5)
    expect(record.channelFeeMode).toBe('percent')
    expect(record.taxMode).toBe('none')
    expect(record.items.map((item) => item.systemSettlementAmount)).toEqual([2009.25, 2792.02])
    expect(record.items[1].billingAmount).toBe(5584.04)
    expect(record.items[1].validationStatus).toBe('pass')
    // 另一行仍存在0.21元差异，不能假装已经完全对平。
    expect(record.systemSettlementAmount).toBe(4801.27)
    expect(record.platformSettlementAmount).toBe(4801.48)
    expect(record.settlementDifference).toBe(-0.21)
    expect(record.validationStatus).toBe('fail')
  })

  it('未录入代金券时保留差异提示，不推断或自动填券', () => {
    const result = calculateSettlementDetails(line('帝国雄师', 6428, 0, 2792.02), honorHeader)
    expect(result.systemSettlementAmount).toBe(3053.3)
    expect(result.settlementDifference).toBe(261.28)
    expect(result.validationStatus).toBe('fail')
  })

  it('同样数据在非荣耀渠道仍为先分成、再扣5%费', () => {
    const otherHeader = {
      ...initialHeaderForm,
      channelName: '普通渠道',
      partnerName: '普通合作方',
      settlementRuleCode: 'five_percent_gateway_share',
      channelFeeMode: 'percent',
      channelFeeRate: '5',
      taxMode: 'none'
    }
    const result = calculateSettlementDetails(line('帝国雄师', 6428, 522.56, 2792.02), otherHeader)
    expect(result.systemSettlementAmount).toBe(2805.08)
    expect(result.validationStatus).toBe('fail')
  })

  it('荣耀账单下显式合同明细规则仍保留优先级', () => {
    const special = line('特别合作游戏', 1000, 0, 500)
    special.settlementRuleCode = 'share_only'
    special.channelFeeMode = 'none'
    special.channelFeeRate = '0'
    special.taxMode = 'none'
    const result = calculateSettlementDetails(special, honorHeader)
    expect(result.systemSettlementAmount).toBe(500)
    expect(result.validationStatus).toBe('pass')
  })
})
