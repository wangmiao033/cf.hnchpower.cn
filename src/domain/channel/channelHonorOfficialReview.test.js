import { describe, expect, it } from 'vitest'
import { assessSavedChannelPlatformDifference, HONOR_OFFICIAL_STATEMENT_POLICY } from './channelPlatformVarianceReview.js'
const policy = { code: HONOR_OFFICIAL_STATEMENT_POLICY, partner_id: 'HONOR-ID' }
const bill = (september = true) => ({
  partner_name: '荣耀', channel_name: '荣耀', status: 'pending', validation_status: 'fail',
  system_settlement_amount: september ? 5825.40 : 4801.27,
  platform_settlement_amount: september ? 5822.55 : 4801.48,
  settlement_amount: september ? 5822.55 : 4801.48,
  items: [
    { id: 'L1', game_name: '六界仙尊', settlement_cycle: '2026-09', system_settlement_amount: september ? 1494.35 : 2009.25, platform_settlement_amount: september ? 1494.46 : 2009.46 },
    { id: 'L2', game_name: '帝国雄师', settlement_cycle: '2026-09', system_settlement_amount: september ? 4331.05 : 2792.02, platform_settlement_amount: september ? 4328.09 : 2792.02 }
  ]
})
describe('Honor-only official statement review', () => {
  it.each([false, true])('retains exact amounts and requires source-backed review, September=%s', september => {
    const saved = bill(september)
    const before = JSON.stringify(saved)
    const result = assessSavedChannelPlatformDifference(saved, policy)
    expect(result).toMatchObject({ eligible: true, reviewKind: 'documented', policyCode: policy.code, partnerId: 'HONOR-ID' })
    expect(result.officialLines).toHaveLength(2)
    expect(result.settlementAmount).toBe(september ? 5822.55 : 4801.48)
    expect(JSON.stringify(saved)).toBe(before)
  })
  it('does not relax generic offset rules or allow a name/formula-only opt-in', () => {
    expect(assessSavedChannelPlatformDifference(bill()).eligible).toBe(false)
    expect(assessSavedChannelPlatformDifference(bill(), { code: policy.code }).eligible).toBe(false)
    for (const partner_name of ['荣耀游戏', '小米', '普通渠道']) {
      expect(assessSavedChannelPlatformDifference({ ...bill(), partner_name, settlement_rule_code: 'honor_upfront_percent_fee' }, policy).eligible).toBe(false)
    }
    expect(assessSavedChannelPlatformDifference({ ...bill(), channel_name: '其他渠道' }, policy).eligible).toBe(false)
  })
  it('rejects missing official input, stale totals and independent overrides', () => {
    const missing = bill(); missing.items[0].platform_settlement_amount = null
    expect(assessSavedChannelPlatformDifference(missing, policy).eligible).toBe(false)
    expect(assessSavedChannelPlatformDifference({ ...bill(), settlement_amount: 5825.40 }, policy).eligible).toBe(false)
    expect(assessSavedChannelPlatformDifference({ ...bill(), settlement_final_override: 5822.55 }, policy).eligible).toBe(false)
  })
})
