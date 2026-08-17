import { describe, expect, it } from 'vitest'
import { getContractRuleReadiness, summarizeContractReadiness } from './contractRuleReadiness.js'

const base = {
  product_name: '圣树唤歌（0.1折）',
  authorization_start: '2026-01-01',
  authorization_end: '2026-12-31',
  share_rate: 30,
  channel_fee_rate: 5,
  settlement_mode: '流水分成',
  settlement_basis: '实付流水扣除代金券后',
  settlement_cycle: '月结',
  payment_terms: '次月 15 日前',
  invoice_tax_rate: 0
}

describe('contract rule readiness', () => {
  it('marks a fully structured share contract as complete', () => {
    const result = getContractRuleReadiness(base, { partnerLinked: true })
    expect(result.ready).toBe(true)
    expect(result.level).toBe('complete')
    expect(result.missingCount).toBe(0)
  })

  it('blocks a share contract without share rate', () => {
    const result = getContractRuleReadiness({ ...base, share_rate: '' }, { partnerLinked: true })
    expect(result.ready).toBe(false)
    expect(result.issues).toContain('缺分成比例')
  })

  it('does not require share rate for fixed unit-price settlement', () => {
    const result = getContractRuleReadiness({
      ...base,
      share_rate: '',
      settlement_mode: 'CPA固定单价',
      settlement_basis: '有效激活',
      unit_price: 10
    }, { partnerLinked: true })
    expect(result.ready).toBe(true)
    expect(result.issues).not.toContain('缺分成比例')
  })

  it('treats missing partner link and authorization period as blocking', () => {
    const result = getContractRuleReadiness({ ...base, authorization_end: '' }, { partnerLinked: false })
    expect(result.ready).toBe(false)
    expect(result.issues).toContain('未关联客户')
    expect(result.issues).toContain('缺完整授权期')
  })

  it('summarizes readiness across access items', () => {
    const result = summarizeContractReadiness({
      partner_link_status: 'linked',
      access_items: [base, { ...base, product_name: '另一个游戏', share_rate: '' }]
    })
    expect(result.total).toBe(2)
    expect(result.ready).toBe(1)
    expect(result.blocked).toBe(1)
    expect(result.level).toBe('blocked')
  })
})
