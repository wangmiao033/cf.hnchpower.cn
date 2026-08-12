import { describe, expect, it } from 'vitest'
import {
  buildExactBillCombination,
  normalizeBankAllocationParty
} from './bankCombinationAllocation.js'

function candidate({
  id,
  amount,
  partner = '广州天盛互娱科技有限公司',
  month = '2026-01',
  score = 80
}) {
  return {
    bill_type: 'channel',
    bill_id: id,
    bill_number: `CH-${id}`,
    partner_name: partner,
    settlement_month: month,
    game_name: '测试游戏',
    bill_amount: amount,
    outstanding_amount: amount,
    recommended_amount: amount,
    score,
    confidence_level: 'high',
    reasons: []
  }
}

describe('bank exact multi-bill combination', () => {
  it('normalizes company suffixes before comparing counterparties', () => {
    expect(normalizeBankAllocationParty('广州天盛互娱科技有限公司'))
      .toBe(normalizeBankAllocationParty('广州天盛互娱科技'))
  })

  it('detects the Tiansheng 3394.37 + 3090.85 = 6485.22 combination', () => {
    const result = buildExactBillCombination({
      direction: 'collection',
      remaining_amount: 6485.22,
      counterparty_name: '广州天盛互娱科技有限公司',
      candidates: [
        candidate({ id: 'jan', amount: 3394.37, month: '2026-01' }),
        candidate({ id: 'feb', amount: 3090.85, month: '2026-02' }),
        candidate({ id: 'mar', amount: 999.99, month: '2026-03' })
      ]
    })

    expect(result).not.toBeNull()
    expect(result.exact).toBe(true)
    expect(result.ambiguous).toBe(false)
    expect(result.autoReady).toBe(true)
    expect(result.confidenceLevel).toBe('high')
    expect(result.totalAmount).toBe(6485.22)
    expect(result.items.map((item) => item.candidate.bill_id)).toEqual(['jan', 'feb'])
    expect(result.items.map((item) => item.amount)).toEqual([3394.37, 3090.85])
  })

  it('never builds one combination by mixing different partners', () => {
    const result = buildExactBillCombination({
      direction: 'collection',
      remaining_amount: 6485.22,
      counterparty_name: '广州天盛互娱科技有限公司',
      candidates: [
        candidate({ id: 'jan', amount: 3394.37, partner: '广州天盛互娱科技有限公司' }),
        candidate({ id: 'feb', amount: 3090.85, partner: '另一家科技有限公司' })
      ]
    })

    expect(result).toBeNull()
  })

  it('finds an exact same-partner combination even when counterparty text is weak, but does not mark it auto-ready', () => {
    const result = buildExactBillCombination({
      direction: 'collection',
      remaining_amount: 300,
      counterparty_name: '未知付款方',
      candidates: [
        candidate({ id: 'a', amount: 100, partner: '合作方A有限公司' }),
        candidate({ id: 'b', amount: 200, partner: '合作方A有限公司' })
      ]
    })

    expect(result).not.toBeNull()
    expect(result.totalAmount).toBe(300)
    expect(result.confidenceLevel).toBe('medium')
    expect(result.autoReady).toBe(false)
  })

  it('downgrades ambiguous exact combinations instead of silently choosing a high-confidence one', () => {
    const result = buildExactBillCombination({
      direction: 'collection',
      remaining_amount: 300,
      counterparty_name: '合作方A有限公司',
      candidates: [
        candidate({ id: 'a', amount: 100, partner: '合作方A有限公司' }),
        candidate({ id: 'b', amount: 200, partner: '合作方A有限公司' }),
        candidate({ id: 'c', amount: 120, partner: '合作方A有限公司' }),
        candidate({ id: 'd', amount: 180, partner: '合作方A有限公司' })
      ]
    })

    expect(result).not.toBeNull()
    expect(result.ambiguous).toBe(true)
    expect(result.autoReady).toBe(false)
    expect(result.confidenceLevel).toBe('medium')
  })
})
