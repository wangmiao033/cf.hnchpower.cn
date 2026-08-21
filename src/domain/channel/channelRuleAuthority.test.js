import { describe, expect, it } from 'vitest'
import {
  applyContractRecommendation,
  sanitizeGeneratedHistoryRules
} from './channelRuleAuthority.js'

function baseRecord() {
  return {
    partnerName: '厦门三七三三网络科技有限公司',
    channelName: '3733 游戏',
    settlementMonth: '2026-07',
    items: [
      {
        gameName: '一起来修仙（0.05折）',
        settlementCycle: '2026-07',
        flow: '19706.79',
        testCost: '0.03',
        shareRate: 30,
        taxRate: 5,
        channelFeeRate: 0,
        settlementRuleCode: 'legacy',
        channelFeeMode: 'percent',
        taxMode: 'share',
        platformSettlementAmount: '4926.69'
      }
    ]
  }
}

describe('channelRuleAuthority', () => {
  it('does not let generated history silently carry financial rules forward', () => {
    const sanitized = sanitizeGeneratedHistoryRules(baseRecord())
    expect(sanitized.items[0]).toMatchObject({
      gameName: '一起来修仙（0.05折）',
      shareRate: '',
      taxRate: '',
      channelFeeRate: '',
      settlementRuleCode: '',
      channelFeeMode: 'none',
      taxMode: 'none'
    })
    expect(sanitized.items[0].flow).toBe('19706.79')
    expect(sanitized.items[0].platformSettlementAmount).toBe('4926.69')
  })

  it('applies an authoritative contract recommendation over old history', () => {
    const recommendation = {
      version: 'test',
      lines: [
        {
          line_index: 0,
          auto_apply: true,
          match: { contract_id: 'C1', access_item_id: 'A1' },
          recommended: {
            share_rate: 25,
            tax_rate: 0,
            settlement_rule_code: 'contract_rule',
            channel_fee_mode: 'none',
            channel_fee_rate: 0,
            tax_mode: 'none',
            validation_tolerance: 0.02
          }
        }
      ]
    }
    const result = applyContractRecommendation(baseRecord(), recommendation, { generated: true })
    expect(result.record.items[0]).toMatchObject({
      shareRate: 25,
      taxRate: 0,
      channelFeeRate: 0,
      settlementRuleCode: 'contract_rule',
      channelFeeMode: 'none',
      taxMode: 'none'
    })
    expect(result.summary).toMatchObject({ total: 1, matched: 1, unmatched: 0 })
  })

  it('keeps manual values when no contract rule is auto-applicable and the line was not generated', () => {
    const result = applyContractRecommendation(baseRecord(), {
      lines: [{ line_index: 0, auto_apply: false, match: null, recommended: null }]
    })
    expect(result.record.items[0].shareRate).toBe(30)
    expect(result.record.items[0].taxRate).toBe(5)
  })

  it('leaves generated unmatched lines blank instead of guessing from history', () => {
    const result = applyContractRecommendation(baseRecord(), {
      lines: [{ line_index: 0, auto_apply: false, match: null, recommended: null }]
    }, { generated: true })
    expect(result.record.items[0].shareRate).toBe('')
    expect(result.record.items[0].taxRate).toBe('')
    expect(result.summary.unmatched).toBe(1)
  })
})
