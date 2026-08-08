import { describe, expect, it } from 'vitest'
import {
  buildFullChannelRecord,
  channelSettlementPeriodFromLines,
  normalizeChannelSettlementCycle
} from './channelBillingForm.js'

describe('channel multi-period billing', () => {
  it('normalizes common settlement month formats', () => {
    expect(normalizeChannelSettlementCycle('2025.09')).toBe('2025-09')
    expect(normalizeChannelSettlementCycle('2026年6月')).toBe('2026-06')
  })

  it('keeps each line month and derives the parent period from the latest line', () => {
    const record = buildFullChannelRecord(
      { channelName: '4399', partnerName: '四三九九网络股份有限公司', status: 'pending' },
      [
        { settlementCycle: '2025.09', gameName: '浮光幻想', flow: 1167, shareRate: 50, taxRate: 5, settlementAmount: 554.33 },
        { settlementCycle: '2026-05', gameName: '六界仙尊', flow: 235, shareRate: 50, taxRate: 5, settlementAmount: 111.63 },
        { settlementCycle: '2026-06', gameName: '六界仙尊', flow: 3736, shareRate: 50, taxRate: 5, settlementAmount: 1774.6 }
      ]
    )

    expect(record.items.map((item) => item.settlementCycle)).toEqual(['2025-09', '2026-05', '2026-06'])
    expect(record.settlementMonth).toBe('2026-06')
    expect(record.startDate).toBe('2025-09-01')
    expect(record.endDate).toBe('2026-06-30')
  })

  it('summarizes distinct months without assuming every month is continuous', () => {
    const period = channelSettlementPeriodFromLines([
      { settlementCycle: '2025-09' },
      { settlementCycle: '2025-10' },
      { settlementCycle: '2026-05' },
      { settlementCycle: '2026-06' }
    ])
    expect(period.months).toEqual(['2025-09', '2025-10', '2026-05', '2026-06'])
    expect(period.lastMonth).toBe('2026-06')
  })
})
