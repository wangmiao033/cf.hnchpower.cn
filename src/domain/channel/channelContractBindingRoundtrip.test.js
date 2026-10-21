import { describe, it, expect } from 'vitest'
import { apiChannelRowToFrontend, frontendChannelRecordToPayload } from '@/lib/api/channel.ts'
import { initialHeaderForm, initialLineItem, buildFullChannelRecord, recordToLineForms, recordToHeaderForm } from './channelBillingForm.js'
import { linesWithChannelLineContractFees } from './channelLineContractFee.js'
import { applyCommercialDiscountFromGameName } from './channelLineDefaults.js'

const header = { ...initialHeaderForm, partnerName: '测试客户有限公司', channelName: '测试渠道', settlementMonth: '2026-09', settlementRuleCode: 'share_only', channelFeeMode: 'none', taxMode: 'none', channelFeeRate: '0' }
const row = { ...initialLineItem(), id: 'persisted-line-a', contractAccessItemId: 'contract-item-a', gameName: '测试游戏3折', settlementCycle: '2026-09', flow: '6', discountFactor: '0.3', testCost: '1.8', shareRate: '25', taxRate: '0', settlementRuleCode: 'five_percent_gateway_share', channelFeeMode: 'percent', channelFeeRate: '5', taxMode: 'none', platformSettlementAmount: '0' }

describe('已选合作清单保存回读', () => {
  it.each([
    ['测试游戏005折混服', 0.005], ['测试游戏01折', 0.01],
    ['测试游戏005折iOS', 0.005], ['测试游戏0.05折', 0.005]
  ])('保留源名 %s 与正确折扣系数，编辑保存回读不放大', (gameName, factor) => {
    const source = { ...row, gameName, discountFactor: String(factor) }
    const payload = frontendChannelRecordToPayload(buildFullChannelRecord(header, [source]))
    expect(payload.items[0]).toMatchObject({ game_name: gameName, discount_factor: factor })
    const reopened = apiChannelRowToFrontend({ ...payload, id: 'bill-a', items: payload.items })
    const forms = recordToLineForms(reopened).map(line => applyCommercialDiscountFromGameName(line))
    expect(forms[0]).toMatchObject({ gameName, discountFactor: String(factor) })
    const again = frontendChannelRecordToPayload(buildFullChannelRecord(recordToHeaderForm(reopened), forms))
    expect(again.items[0]).toMatchObject({ game_name: gameName, discount_factor: factor })
  })
  it('稳定原行ID、清单ID及零结算行5%费率全部保留', () => {
    const record = buildFullChannelRecord(header, linesWithChannelLineContractFees([row], header))
    const payload = frontendChannelRecordToPayload(record)
    expect(payload.items[0]).toMatchObject({ id: 'persisted-line-a', contract_access_item_id: 'contract-item-a', channel_fee_rate: 5, channel_fee_mode: 'percent' })
    const api = { ...payload, id: 'bill-a', items: [{ ...payload.items[0], id: 'saved-line-a' }] }
    const reopened = apiChannelRowToFrontend(api)
    const forms = recordToLineForms(reopened)
    const again = frontendChannelRecordToPayload(buildFullChannelRecord(recordToHeaderForm(reopened), forms))
    expect(again.items[0]).toMatchObject({ id: 'saved-line-a', contract_access_item_id: 'contract-item-a', channel_fee_rate: 5 })
  })
  it('不因平台金额碰巧支持0%而覆盖有依据的已选5%规则', () => {
    const selected = { ...row, flow: '100', discountFactor: '1', testCost: '0', platformSettlementAmount: '25' }
    expect(linesWithChannelLineContractFees([selected], header)[0].channelFeeRate).toBe('5')
  })
  it('同名重复行各自保留ID，不能按数组位置借用另一行关联', () => {
    const second = { ...row, id: 'persisted-line-b', contractAccessItemId: 'contract-item-b' }
    const payload = frontendChannelRecordToPayload(buildFullChannelRecord(header, [second, row]))
    expect(payload.items.map(x => [x.id, x.contract_access_item_id])).toEqual([
      ['persisted-line-b', 'contract-item-b'], ['persisted-line-a', 'contract-item-a']
    ])
  })
  it('旧客户端未带选择保持省略；新增行无原行ID；显式解除发送null', () => {
    const legacy = { ...row }; delete legacy.id; delete legacy.contractAccessItemId
    const payload = frontendChannelRecordToPayload(buildFullChannelRecord(header, [legacy, { ...row, contractAccessItemId: null }]))
    expect(payload.items[0]).not.toHaveProperty('id')
    expect(payload.items[0]).not.toHaveProperty('contract_access_item_id')
    expect(payload.items[1].contract_access_item_id).toBeNull()
  })
})
