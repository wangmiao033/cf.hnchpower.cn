import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/legalEntities.ts', () => ({
  getCustomerContractSource: vi.fn()
}))
vi.mock('@/lib/api/contractTerms.ts', () => ({
  recommendChannelContractRules: vi.fn()
}))

import { getCustomerContractSource } from '@/lib/api/legalEntities.ts'
import { recommendChannelContractRules } from '@/lib/api/contractTerms.ts'
import { resolveChannelContractAuthority } from './channelRuleAuthority.js'

const record = {
  partnerId: 'business-customer-1',
  partnerName: '湖南晨宇互娱网络科技有限公司',
  channelName: '天宇游戏',
  settlementMonth: '2026-08',
  items: [{ gameName: '游戏甲', settlementCycle: '2026-08',
    shareRate: '', channelFeeRate: '', taxRate: '', settlementRuleCode: '' }]
}
const recommendation = {
  lines: [{ line_index: 0, auto_apply: true,
    match: { contract_id: 'old-contract-1', access_item_id: 'old-item-1' },
    recommended: { share_rate: 30, channel_fee_rate: 5, tax_rate: 0,
      tax_mode: 'none', channel_fee_mode: 'percent', settlement_rule_code: 'from-old-contract',
      validation_tolerance: 0.05 } }]
}

beforeEach(() => {
  vi.clearAllMocks()
  getCustomerContractSource.mockResolvedValue({
    partner_id: 'business-customer-1', month: '2026-08',
    contract_party_name: '湖南天宇互娱网络科技有限公司',
    source: 'existing_customer_contract'
  })
  recommendChannelContractRules.mockResolvedValue(recommendation)
})

describe('channel contract identity vs bank payment company', () => {
  it('finds the unchanged original contract without overwriting payer/customer', async () => {
    const result = await resolveChannelContractAuthority(record, { generated: true })
    expect(getCustomerContractSource).toHaveBeenCalledWith('business-customer-1', '2026-08')
    expect(recommendChannelContractRules).toHaveBeenCalledWith(expect.objectContaining({
      partner_name: '湖南天宇互娱网络科技有限公司',
      channel_name: '天宇游戏'
    }))
    expect(result.record.partnerName).toBe('湖南晨宇互娱网络科技有限公司')
    expect(result.record.partnerId).toBe('business-customer-1')
    expect(result.record.items[0].shareRate).toBe(30)
    expect(result.summary.matched).toBe(1)
  })

  it('preserves legacy matching when no stable business customer ID exists', async () => {
    await resolveChannelContractAuthority({ ...record, partnerId: '' })
    expect(getCustomerContractSource).not.toHaveBeenCalled()
    expect(recommendChannelContractRules).toHaveBeenCalledWith(expect.objectContaining({
      partner_name: '湖南晨宇互娱网络科技有限公司'
    }))
  })

  it('respects the saved contract signer snapshot on historical bills', async () => {
    await resolveChannelContractAuthority({
      ...record, contractEntitySnapshot: '湖南天宇互娱网络科技有限公司'
    })
    expect(getCustomerContractSource).not.toHaveBeenCalled()
    expect(recommendChannelContractRules).toHaveBeenCalledWith(expect.objectContaining({
      partner_name: '湖南天宇互娱网络科技有限公司'
    }))
  })
})
