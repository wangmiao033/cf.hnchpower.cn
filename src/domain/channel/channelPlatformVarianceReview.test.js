import { describe, it, expect } from 'vitest'
import { assessSavedChannelPlatformVariance, assessSavedChannelPlatformDifference, buildChannelPlatformApprovalNote } from './channelPlatformVarianceReview.js'

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

describe('automated audit note for explicit human platform confirmation', () => {
  const review = {
    reviewKind: 'documented',
    systemAmount: 7.33, platformAmount: 9.38,
    settlementAmount: 9.38, differenceCents: -205
  }
  it('provides a complete 12+-character reason without requiring the user to retype the file or amount', () => {
    const reason = buildChannelPlatformApprovalNote(review, '', '广州熊动科技有限公司9月份账单.xlsx')
    expect(reason.length).toBeGreaterThanOrEqual(12)
    expect(reason).toContain('广州熊动科技有限公司9月份账单.xlsx')
    expect(reason).toContain('¥7.33')
    expect(reason).toContain('¥9.38')
    expect(reason).toContain('¥2.05')
    expect(reason).toContain('不作修改')
    expect(reason).not.toContain('已收款¥9.38')
  })
  it('preserves a supplementary comment, and never exceeds the backend 500-character limit', () => {
    const reason = buildChannelPlatformApprovalNote(review, '补充原始对账单', '凭证.xlsx')
    expect(reason).toContain('补充说明：补充原始对账单')
    expect(buildChannelPlatformApprovalNote(review, 'A'.repeat(1000), '凭证.xlsx').length).toBe(500)
  })
  it('does not fabricate an uploaded source for small platform tails or approve anything', () => {
    const reason = buildChannelPlatformApprovalNote({ ...review, reviewKind: 'small' })
    expect(reason).toContain('已核对渠道平台账单')
    expect(reason).not.toContain('原始结算凭证')
    expect(buildChannelPlatformApprovalNote(null)).toBe('')
  })
})

describe('single authorized July bill attachment exception', () => {
  const single = () => ({
    id: 'single', statement_no: 'QD-20261015-041F2B', partner_name: '四三九九网络股份有限公司',
    channel_name: '4399', settlement_month: '2026-07', status: 'pending', validation_status: 'fail',
    system_settlement_amount: 135.85, platform_settlement_amount: 144.4, settlement_amount: 144.4,
    items: [{id:'J1',settlement_cycle:'2026-07',system_settlement_amount:135.85,platform_settlement_amount:144.4}]
  })
  const exception = () => ({code:'4399_july_2026_single_bill_v1',bill_id:'single',statement_no:'QD-20261015-041F2B',
    partner_name:'四三九九网络股份有限公司',partner_id:'customer-id',settlement_month:'2026-07',review_revision:'a'.repeat(64)})
  it('retains documented difference and only attaches a server-authorized single-bill review', () => {
    expect(assessSavedChannelPlatformDifference(single(),null,exception())).toMatchObject({
      reviewKind:'documented',differenceCents:-855,manualException:exception()
    })
    expect(assessSavedChannelPlatformDifference(single()).manualException).toBeUndefined()
  })
  it.each([
    {statement_no:'another'}, {partner_name:'4399'}, {channel_name:'other'}, {settlement_month:'2026-08'},
    {id:'other'}, {status:'confirmed'}, {platform_settlement_amount:144.41}
  ])('does not extend to another identity or amount %j', changes => {
    expect(assessSavedChannelPlatformDifference({...single(),...changes},null,exception()).manualException).toBeUndefined()
  })
  it.each([{code:'other'},{review_revision:''},{partner_id:''},{statement_no:'other'},{settlement_month:'2026-08'}])('fails closed on invalid server scope %j', changes => {
    expect(assessSavedChannelPlatformDifference(single(),null,{...exception(),...changes}).manualException).toBeUndefined()
  })
  it('does not claim that an original attachment was reviewed', () => {
    const review = assessSavedChannelPlatformDifference(single(),null,exception())
    const note = buildChannelPlatformApprovalNote(review,'已按真实来源逐项核对，本次保留差异并人工确认')
    expect(note).toContain('文字依据')
    expect(note).toContain('8.55')
    expect(note).not.toContain('已按所选平台原始结算凭证')
  })
  it('does not apply to a line from another month', () => {
    const row=single();row.items[0].settlement_cycle='2026-08'
    expect(assessSavedChannelPlatformDifference(row,null,exception()).manualException).toBeUndefined()
  })
})
