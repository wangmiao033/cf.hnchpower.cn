import { describe, expect, it } from 'vitest'
import {
  ANJIU_PRE_DISCOUNT_DEDUCTION_RULE,
  calculateBillingAmount,
  calculateSettlementDetails,
  calculateShareAmount,
  detectChannelRulePreset,
  initialHeaderForm,
  initialLineItem
} from '@/domain/channel/channelBillingForm.js'

function anjiuHeader() {
  return {
    ...initialHeaderForm,
    partnerName: '广东安久科技有限公司',
    channelName: '游戏fan（安久）',
    settlementRuleCode: 'five_percent_gateway_share',
    channelFeeMode: 'percent',
    channelFeeRate: '5',
    taxMode: 'none'
  }
}

function contractLine(overrides = {}) {
  return {
    ...initialLineItem(),
    settlementCycle: '2026-07',
    settlementRuleCode: 'five_percent_gateway_share',
    channelFeeMode: 'percent',
    channelFeeRate: '5',
    taxMode: 'none',
    taxRate: '0',
    ...overrides
  }
}

describe('广东安久 / 游戏fan 专属结算顺序', () => {
  it('只对广东安久识别专属规则', () => {
    expect(detectChannelRulePreset('广东安久科技有限公司')).toBe(ANJIU_PRE_DISCOUNT_DEDUCTION_RULE)
    expect(detectChannelRulePreset('游戏fan（安久）')).toBe(ANJIU_PRE_DISCOUNT_DEDUCTION_RULE)
    expect(detectChannelRulePreset('其他渠道有限公司')).toBe('')
  })

  it('折扣为100%时与平台第一行 2478.55 一致', () => {
    const line = contractLine({
      flow: '7863',
      discountFactor: '1',
      voucherCost: '2645',
      shareRate: '50',
      platformSettlementAmount: '2478.55'
    })

    expect(calculateBillingAmount(line, anjiuHeader())).toBeCloseTo(5218, 6)
    expect(calculateShareAmount(line, anjiuHeader())).toBeCloseTo(2609, 6)
    expect(calculateSettlementDetails(line, anjiuHeader())).toMatchObject({
      systemSettlementAmount: 2478.55,
      settlementDifference: 0,
      validationStatus: 'pass'
    })
  })

  it('折扣为0.5%时先扣代金券再折扣，得到平台第二行 1984.95', () => {
    const line = contractLine({
      flow: '1396184',
      discountFactor: '0.005',
      voucherCost: '3240',
      shareRate: '30',
      platformSettlementAmount: '1984.95'
    })

    expect(calculateBillingAmount(line, anjiuHeader())).toBeCloseTo(6964.72, 6)
    expect(calculateShareAmount(line, anjiuHeader())).toBeCloseTo(2089.416, 6)
    expect(calculateSettlementDetails(line, anjiuHeader())).toMatchObject({
      systemSettlementAmount: 1984.95,
      settlementDifference: 0,
      validationStatus: 'pass'
    })
  })

  it('其他渠道仍保持原来的先折扣再扣减逻辑，不做全局修改', () => {
    const normalHeader = {
      ...initialHeaderForm,
      partnerName: '其他渠道有限公司',
      channelName: '其他渠道',
      settlementRuleCode: 'five_percent_gateway_share',
      channelFeeMode: 'percent',
      channelFeeRate: '5',
      taxMode: 'none'
    }
    const line = contractLine({
      flow: '1396184',
      discountFactor: '0.005',
      voucherCost: '3240',
      shareRate: '30'
    })

    expect(calculateBillingAmount(line, normalHeader)).toBeCloseTo(3740.92, 6)
    expect(calculateSettlementDetails(line, normalHeader).systemSettlementAmount).toBe(1066.16)
  })
})
