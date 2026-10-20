import { describe, expect, it } from 'vitest'
import { availableChoices } from './ChannelContractIssueEditor.jsx'

describe('existing cooperation list choices', () => {
  it('compact iOS bill finds bracketed full-platform SKU before substring filtering', () => {
    const item = { id: 'a', product_name: '一起来修仙（0.05折）', platform: '全版本' }
    const contract = { id: 'c', partner_id: 'p', partner_name: '测试客户', access_items: [item] }
    const result = availableChoices([contract], { game_name: '一起来修仙005折-ios' }, '测试客户', 'p')
    expect(result).toEqual([{ contract, item }])
  })
  it('SKU alias cannot expose another customer list', () => {
    const item = { id: 'a', product_name: '一起来修仙（0.05折）', platform: '全版本' }
    expect(availableChoices([{ id: 'c', partner_id: 'other', partner_name: '测试客户', access_items: [item] }], { game_name: '一起来修仙005折-ios' }, '测试客户', 'p')).toEqual([])
  })
})
