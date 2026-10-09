import { describe, expect, it } from 'vitest'
import { buildFullChannelRecord, initialHeaderForm, initialLineItem } from './channelBillingForm.js'
import {
  describeChannelDifference,
  channelDifferenceLabel,
  createChannelDifferenceNote,
  potentialDoubleAdjustment,
  upsertChannelDifferenceNote
} from './channelDifferenceReview.js'

function makeBamenBill() {
  return buildFullChannelRecord({
    ...initialHeaderForm,
    channelName: '八门',
    partnerName: '长沙某渠道公司',
    settlementMonth: '2026-09',
    settlementRuleCode: 'five_percent_gateway_share',
    channelFeeMode: 'percent',
    channelFeeRate: '5',
    taxMode: 'none'
  }, [
    {
      ...initialLineItem(),
      settlementCycle: '2026-09',
      gameName: '一起来修仙（0.05折）',
      flow: '1638',
      discountFactor: '0.005',
      voucherCost: '6.48',
      shareRate: '30',
      taxRate: '0',
      platformSettlementAmount: '0.49'
    },
    {
      ...initialLineItem(),
      settlementCycle: '2026-09',
      gameName: '云上征途（3折）',
      flow: '80',
      discountFactor: '0.3',
      shareRate: '30',
      taxRate: '0',
      platformSettlementAmount: '8.89'
    }
  ])
}

describe('read-only channel/platform difference notes', () => {
  it('identifies higher platform settlement without increasing final receivable a second time', () => {
    const record = makeBamenBill()
    const review = describeChannelDifference(record)
    expect(record.flow).toBe(32.19)
    expect(record.systemSettlementAmount).toBe(7.33)
    expect(record.platformSettlementAmount).toBe(9.38)
    expect(record.settlementAmount).toBe(9.38)
    expect(review).toMatchObject({ kind: 'higher', system: 7.33, platform: 9.38, delta: 2.05, absoluteDifference: 2.05 })
    expect(review.games).toEqual(['云上征途（3折）'])
    expect(channelDifferenceLabel(review)).toContain('多结')
    expect(potentialDoubleAdjustment(review, 2.05)).toBe(true)
    expect(potentialDoubleAdjustment(review, 0)).toBe(false)
  })

  it('keeps notes idempotent and does not touch amounts or existing remarks', () => {
    const record = makeBamenBill()
    const review = describeChannelDifference(record)
    const note = createChannelDifferenceNote(record, review, { reason: '渠道账单待提供明细' })
    const once = upsertChannelDifferenceNote('账款回款日为次月', note)
    const twice = upsertChannelDifferenceNote(once, note)
    expect(twice).toBe(once)
    expect(once).toContain('账款回款日为次月')
    expect(once).toContain('系统核算¥7.33，渠道账单¥9.38')
    expect(once).toContain('本条仅记录差异，不额外调整金额')
    expect(record.settlementAmount).toBe(9.38)
  })

  it('requires support for confirmed differences; does not label partial invoices as higher', () => {
    const record = makeBamenBill()
    const review = describeChannelDifference(record)
    expect(() => createChannelDifferenceNote(record, review, { status: 'platform_confirmed' }))
      .toThrow('核对依据')
    const partialRecord = {
      ...record, items: record.items.map((item, index) => index === 0 ? item : { ...item, platformSettlementAmount: null })
    }
    expect(describeChannelDifference(partialRecord).kind).toBe('partial')
  })

  it('shows lower settlement without treating it as a positive payment adjustment', () => {
    const record = makeBamenBill()
    const lower = { ...record, platformSettlementAmount: 5.28, items: record.items.map((item, index) =>
      index === 1 ? { ...item, platformSettlementAmount: 4.79 } : item
    ) }
    const review = describeChannelDifference(lower)
    expect(review.kind).toBe('lower')
    expect(review.delta).toBe(-2.05)
    expect(potentialDoubleAdjustment(review, -2.05)).toBe(true)
  })
})
