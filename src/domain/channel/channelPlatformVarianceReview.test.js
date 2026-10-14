import { describe, it, expect } from 'vitest'
import { assessSavedChannelPlatformVariance, assessSavedChannelPlatformDifference } from './channelPlatformVarianceReview.js'

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

describe('statement-backed Xiaomi platform difference', () => {
  const xiaomi = () => ({
    status: 'pending', validation_status: 'fail',
    settlement_amount: 475.81, platform_settlement_amount: 475.81,
    system_settlement_amount: 535.80,
    settlement_adjustment_amount: 0, settlement_final_override: null,
    items: [
      { id: 'X1', system_settlement_amount: 2.85, platform_settlement_amount: 2.42 },
      { id: 'X2', system_settlement_amount: 14.25, platform_settlement_amount: 2.85 },
      { id: 'X3', system_settlement_amount: 307.80, platform_settlement_amount: 291.27 },
      { id: 'X4', system_settlement_amount: 210.90, platform_settlement_amount: 179.27 }
    ]
  })
  it('routes a verified 59.99 discrepancy into documented human approval, not the tiny-tail path', () => {
    expect(assessSavedChannelPlatformVariance(xiaomi()).eligible).toBe(false)
    const review = assessSavedChannelPlatformDifference(xiaomi())
    expect(review).toMatchObject({
      eligible: true, reviewKind: 'documented',
      systemAmount: 535.80, platformAmount: 475.81,
      settlementAmount: 475.81,
      differenceCents: 5999, absoluteLineDifferenceCents: 5999,
      lineIds: ['X1', 'X2', 'X3', 'X4']
    })
  })
  it('rejects offsets and missing or altered platform totals before requesting audit approval', () => {
    const base = xiaomi()
    expect(assessSavedChannelPlatformDifference({
      ...base, platform_settlement_amount: 475.80
    }).eligible).toBe(false)
    expect(assessSavedChannelPlatformDifference({
      ...base, items: [
        { id: 'X1', system_settlement_amount: 200.00, platform_settlement_amount: 300.00 },
        { id: 'X2', system_settlement_amount: 335.80, platform_settlement_amount: 175.81 }
      ]
    }).eligible).toBe(false)
    expect(assessSavedChannelPlatformDifference({ ...base, status: 'confirmed' }).eligible).toBe(false)
  })
})
