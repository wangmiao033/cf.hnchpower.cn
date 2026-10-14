import { describe, it, expect } from 'vitest'
import { assessSavedChannelPlatformVariance } from './channelPlatformVarianceReview.js'

const bill = (overrides = {}) => ({
  status: 'pending', validation_status: 'fail',
  system_settlement_amount: 4801.27,
  platform_settlement_amount: 4801.48,
  settlement_amount: 4801.48,
  settlement_adjustment_amount: 0, settlement_final_override: null,
  items: [
    { id: 'L1', system_settlement_amount: 2009.25, platform_settlement_amount: 2009.46 },
    { id: 'L2', system_settlement_amount: 2792.02, platform_settlement_amount: 2792.02 },
  ], ...overrides
})

describe('saved channel platform variance review', () => {
  it('offers one manual note for ¥4801.27 versus ¥4801.48', () => {
    expect(assessSavedChannelPlatformVariance(bill())).toMatchObject({
      eligible: true, differenceCents: -21, systemAmount: 4801.27,
      platformAmount: 4801.48, settlementAmount: 4801.48,
      lineIds: ['L1', 'L2']
    })
  })
  it('never offers bypass after a bill changes status or amount', () => {
    expect(assessSavedChannelPlatformVariance(bill({ status: 'confirmed' })).eligible).toBe(false)
    expect(assessSavedChannelPlatformVariance(bill({ settlement_amount: 4801.27 })).eligible).toBe(false)
    expect(assessSavedChannelPlatformVariance(bill({ settlement_adjustment_amount: -0.21 })).eligible).toBe(false)
  })
  it('rejects missing platform detail, excessive total differences and offsetting large errors', () => {
    expect(assessSavedChannelPlatformVariance(bill({ items: [
      { id: 'L1', system_settlement_amount: 2009.25, platform_settlement_amount: null },
      { id: 'L2', system_settlement_amount: 2792.02, platform_settlement_amount: 2792.02 }
    ] })).eligible).toBe(false)
    expect(assessSavedChannelPlatformVariance(bill({ items: [
      { id: 'L1', system_settlement_amount: 2009.25, platform_settlement_amount: 2029.25 },
      { id: 'L2', system_settlement_amount: 2792.02, platform_settlement_amount: 2772.23 }
    ] })).eligible).toBe(false)
  })
})
