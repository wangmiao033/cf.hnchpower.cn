import { describe, expect, it } from 'vitest'
import { prepareChannelSpecialSettlement } from './channelSpecialSettlement.js'

const billId = 'channel-aug-2026'
const record = {
  id: billId,
  status: 'pending',
  settlementAmount: 3119.46,
  channelFeeRate: 5,
  items: [
    {
      id: 'game-a',
      settlementCycle: '2026-08',
      gameName: '一起来修仙（0.05折）',
      shareRate: 25,
      channelFeeRate: 5,
      settlementAmount: 3118.81
    },
    {
      id: 'game-b',
      settlementCycle: '2026-08',
      gameName: '云上征途（0.05飞升启航版）',
      shareRate: 28,
      channelFeeRate: 5,
      settlementAmount: 0.65
    }
  ]
}

const difference = {
  id: 'case-aug-2026',
  bill_type: 'channel',
  bill_id: billId,
  line_id: 'game-b',
  game_name: '云上征途（0.05飞升启航版）',
  settlement_cycle: '2026-08',
  actual_amount: 0.65,
  expected_amount: 0.61,
  status: 'pending',
  handling_type: null
}

describe('channel special settlement direct confirmation', () => {
  it('keeps the actual 28% share, 5% channel fee and ¥3119.46 untouched', () => {
    const before = JSON.stringify(record)
    const result = prepareChannelSpecialSettlement({ billId, record, cases: [difference] })
    expect(result.error).toBe('')
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0].reasonType).toBe('商务特殊约定')
    expect(result.actions[0].description).toContain('28%')
    expect(result.actions[0].description).toContain('5%')
    expect(result.actions[0].description).toContain('¥0.65')
    expect(result.billAmount).toBe('3119.46')
    expect(JSON.stringify(record)).toBe(before)
  })

  it('cannot mistakenly approve a different bill or modified game amount', () => {
    expect(prepareChannelSpecialSettlement({ billId, record, cases: [{ ...difference, bill_id: 'other' }] }).error)
      .toMatch(/其他账单/)
    expect(prepareChannelSpecialSettlement({ billId, record, cases: [{ ...difference, actual_amount: 1.65 }] }).error)
      .toMatch(/金额与服务器账单不一致/)
  })

  it('rejects an invoice with other difference-handling workflows', () => {
    const result = prepareChannelSpecialSettlement({
      billId, record, cases: [{ ...difference, status: 'processing', handling_type: 'adjustment' }]
    })
    expect(result.error).toMatch(/其他处理流程/)
  })

  it('never confirms a locked bill or absent cases', () => {
    expect(prepareChannelSpecialSettlement({
      billId, record: { ...record, status: 'confirmed' }, cases: [difference]
    }).error).toMatch(/状态已更新/)
    expect(prepareChannelSpecialSettlement({ billId, record, cases: [] }).error).toMatch(/还没有生成/)
  })

  it('matches historical field-only cases by product and cycle if line ID changed', () => {
    const result = prepareChannelSpecialSettlement({
      billId, record, cases: [{ ...difference, line_id: 'legacy-old-line-id' }]
    })
    expect(result.error).toBe('')
    expect(result.actions).toHaveLength(1)
  })
})
