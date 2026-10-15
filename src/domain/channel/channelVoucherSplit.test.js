import { describe, expect, it } from 'vitest'
import {
  ANJIU_PRE_DISCOUNT_DEDUCTION_RULE,
  XIAN_WEIZHEN_9917_RULE,
  buildLineRecordFromForm,
  calculateBillingAmount,
  calculateSettlementDetails,
  hasSplitVoucherFields,
  initialLineItem,
  recordToLineForms,
  voucherCostForStorage
} from './channelBillingForm.js'

const rule = { settlementRuleCode: 'five_percent_gateway_share', channelFeeMode: 'percent', channelFeeRate: '5', taxMode: 'none' }
const oldRow = {
  ...initialLineItem(),
  flow: '74312', discountFactor: '0.005', voucherCost: '3.24',
  voucherFaceValue: null, voucherDirectCost: null,
  shareRate: '30', taxRate: '0', platformSettlementAmount: '104.97'
}

describe('渠道代金券双输入框', () => {
  it('历史单字段保留原始扣减，不进行二次折算', () => {
    expect(hasSplitVoucherFields(oldRow)).toBe(false)
    expect(calculateSettlementDetails(oldRow, rule).systemSettlementAmount).toBe(104.97)
    const rebuilt = buildLineRecordFromForm(oldRow, rule)
    expect(rebuilt.voucherFaceValue).toBeNull()
    expect(rebuilt.voucherDirectCost).toBeNull()
    expect(rebuilt.voucherCost).toBe(3.24)
    const reopened = recordToLineForms({ items: [rebuilt] })[0]
    expect(reopened.voucherFaceValue).toBeNull()
    expect(reopened.voucherDirectCost).toBeNull()
    expect(reopened.voucherCost).toBe('3.24')
  })

  it('648元原始面额折算券只抵扣3.24，结算104.97', () => {
    const row = { ...oldRow, voucherFaceValue: '648', voucherDirectCost: '0' }
    expect(voucherCostForStorage(row, rule)).toBe(3.24)
    expect(calculateBillingAmount(row, rule)).toBeCloseTo(368.32, 8)
    expect(calculateSettlementDetails(row, rule).systemSettlementAmount).toBe(104.97)
    const saved = buildLineRecordFromForm(row, rule)
    expect(saved.voucherFaceValue).toBe(648)
    expect(saved.voucherDirectCost).toBe(0)
    expect(saved.voucherCost).toBe(3.24)
    const reopened = recordToLineForms({ items: [saved] })[0]
    expect(reopened.voucherFaceValue).toBe('648')
    expect(reopened.voucherDirectCost).toBe('0')
  })

  it('直扣券不折算，折算券与直扣券可以同时填写', () => {
    const direct = { ...oldRow, voucherFaceValue: '0', voucherDirectCost: '648' }
    expect(voucherCostForStorage(direct, rule)).toBe(648)
    expect(calculateBillingAmount(direct, rule)).toBeCloseTo(-276.44, 8)
    const both = { ...direct, voucherFaceValue: '648', voucherDirectCost: '10' }
    expect(voucherCostForStorage(both, rule)).toBe(13.24)
    expect(calculateSettlementDetails(both, rule).systemSettlementAmount).toBe(102.12)
  })

  it('安久特殊规则仍先换算折算券，直扣券不再乘折扣', () => {
    const anjiu = { settlementRuleCode: ANJIU_PRE_DISCOUNT_DEDUCTION_RULE, channelFeeMode: 'percent', channelFeeRate: '5', taxMode: 'share' }
    const row = { ...oldRow, voucherFaceValue: '648', voucherDirectCost: '10' }
    expect(voucherCostForStorage(row, anjiu)).toBe(2648)
    expect(calculateBillingAmount(row, anjiu)).toBeCloseTo(358.32, 8)
  })

  it('西安维真专属规则代金券仅记录，不参与扣减', () => {
    const xian = { settlementRuleCode: XIAN_WEIZHEN_9917_RULE, channelFeeMode: 'percent', channelFeeRate: 5, taxMode: 'none' }
    const row = { ...oldRow, voucherFaceValue: '648', voucherDirectCost: '10' }
    expect(calculateBillingAmount(row, xian)).toBeCloseTo(371.56, 8)
  })
})
