import { describe, expect, it } from 'vitest'
import { buildRdContractReview, finiteAmount, hasRdAdditionalFees } from './rdContractReview.js'

const record = { partner: '示例研发', channelFeeRate: 0, settlementAmount: 22557.99, items: [{ id: 'example', gameName: '示例游戏', settlementCycle: '2025年12月', revenue: 33174989, discountRate: 0.005, couponAmount: 15488.35, testFee: 0, extraFee: 0, shareRatio: 15, taxRate: 0 }] }
function recommendation(overrides = {}) {
  return { header_recommendation: { compatible: true }, lines: [{ line_index: 0, auto_apply: true, match: { authorization_status: 'covered' }, recommended: { basis_mode: 'discounted_flow', settlement_discount_rate: 0.005, share_ratio: 15, channel_fee_rate: 0, tax_rate: 0, test_fee: 0 }, contract_amount: { deterministic: true, expected_amount: 22557.99 }, ...overrides }] }
}

describe('研发合同核对展示', () => {
  it('does not turn missing values into zero amounts', () => {
    for (const value of [null, undefined, '', ' ', 'invalid', Infinity]) expect(finiteAmount(value)).toBeNull()
    expect(finiteAmount(0)).toBe(0)
  })
  it('keeps ambiguous contract estimates out of totals and differences', () => {
    const rec = recommendation({ auto_apply: false, recommended: { basis_mode: 'ambiguous', settlement_discount_rate: 1 }, contract_amount: { deterministic: false, expected_amount: 4973925.1 } })
    const review = buildRdContractReview(record, rec)
    expect(review.comparable).toBe(false)
    expect(review.expected).toBeNull()
    expect(review.difference).toBeNull()
    expect(review.lines[0].expected).toBe(4973925.1)
    expect(review.lines[0].reasons.join()).toContain('账单当前系数 0.005')
    expect(review.lines[0].comparisons).toEqual([])
  })
  it('compares fully determined amounts and reuses the existing calculation', () => {
    const review = buildRdContractReview(record, recommendation())
    expect(review.comparable).toBe(true)
    expect(review.difference).toBe(0)
    expect(review.lines[0].calculation).toEqual({ totalFlow: 165874.95, billingBase: 150386.6, shareAmount: 150386.6, settlementAmount: 22557.99 })
  })
  it('identifies a changed share rate without labeling it a proven manual adjustment', () => {
    const changed = { ...record, settlementAmount: 30077.32, items: [{ ...record.items[0], shareRatio: 20 }] }
    const review = buildRdContractReview(changed, recommendation())
    expect(review.lines[0].comparisons).toEqual([{ key: 'share', label: '分成比例', actual: 20, recommended: 15, unit: '%' }])
    expect(review.difference).toBe(7519.33)
  })
  it('does not sum a partial set of contract matches as a complete bill', () => {
    const mixed = { ...record, items: [...record.items, { ...record.items[0], id: 'unmatched', gameName: '未匹配游戏' }] }
    const review = buildRdContractReview(mixed, recommendation())
    expect(review.pendingCount).toBe(1)
    expect(review.expected).toBeNull()
    expect(review.difference).toBeNull()
  })
  it.each([{ current: false }, { loading: true }, { error: 'unavailable' }])('does not compare stale, loading or failed recommendations: %j', (options) => {
    expect(buildRdContractReview(record, recommendation(), options).difference).toBeNull()
  })
  it('does not treat uncertain matching or incompatible header fees as confirmed', () => {
    expect(buildRdContractReview(record, recommendation({ auto_apply: false })).comparable).toBe(false)
    const incompatible = recommendation()
    incompatible.header_recommendation.compatible = false
    expect(buildRdContractReview(record, incompatible).expected).toBeNull()
  })
  it('does not compare missing contract amounts and allows a confirmed zero amount', () => {
    expect(buildRdContractReview(record, recommendation({ contract_amount: { deterministic: true, expected_amount: null } })).expected).toBeNull()
    expect(buildRdContractReview(record, recommendation({ contract_amount: { deterministic: true, expected_amount: 0 } })).expected).toBe(0)
  })
  it('does not mutate input records or recommendations', () => {
    const rec = recommendation()
    const before = JSON.stringify({ record, rec })
    buildRdContractReview(record, rec)
    expect(JSON.stringify({ record, rec })).toBe(before)
  })
  it('expands fees for nonzero amounts or rates, including negative adjustments', () => {
    expect(hasRdAdditionalFees(record.items[0], 0)).toBe(false)
    for (const field of ['testFee', 'extraFee', 'taxRate']) expect(hasRdAdditionalFees({ ...record.items[0], [field]: -1 }, 0)).toBe(true)
    expect(hasRdAdditionalFees(record.items[0], '0.01')).toBe(true)
  })
})
