import { describe, expect, it } from 'vitest'
import {
  buildCustomerBillSearchIndex,
  customerSearchFieldsForBill,
  linkedCustomerMatchesKeyword,
  normalizeCustomerSearch
} from './customerBillSearchIndex.js'
import { matchesChannelLedgerFilters } from '@/domain/channel/channelFlatLedgerFilters.js'

const company = '湖南芯动网络科技有限公司'
const customers = [
  { id: 'p1', name: company, shortName: '芯动（朋克）', tag2: '折扣游戏渠道' },
  { id: 'p2', name: '上海其他网络科技有限公司', shortName: '其他（朋克4）', tag2: '合作结算' },
  { id: 'p3', name: '西安游海网络科技有限公司', shortName: '游海（麦游）', tag2: '' }
]
const index = buildCustomerBillSearchIndex(customers)
const channelBill = {
  id: 'channel-2026-07',
  channelName: '芯动',
  partnerName: company,
  settlementMonth: '2026-07',
  statementNo: 'QD-XD-202607',
  gameName: '某游戏',
  status: 'confirmed',
  settlementAmount: 955.05,
  items: [{ settlementCycle: '2026-07', gameName: '某游戏', flow: 1000 }]
}

describe('generic customer-linked bill searching', () => {
  it('searches 芯动, 朋克, and 芯动（朋克） without modifying the original bill', () => {
    const before = JSON.stringify(channelBill)
    for (const query of ['芯动', '朋克', '芯动（朋克）', '芯动(朋克)', '芯动 朋克']) {
      expect(matchesChannelLedgerFilters(channelBill, { query, customerIndex: index }), query)
        .toBe(true)
    }
    expect(JSON.stringify(channelBill)).toBe(before)
    expect(customerSearchFieldsForBill(channelBill, index)).toContain('芯动（朋克）')
  })

  it('does not search another legal company tag or a similarly named brand', () => {
    const unrelated = {
      ...channelBill,
      id: 'other',
      partnerName: '上海其他网络科技有限公司',
      channelName: '芯动'
    }
    expect(matchesChannelLedgerFilters(channelBill, { query: '朋克4', customerIndex: index })).toBe(false)
    expect(matchesChannelLedgerFilters(unrelated, { query: '朋克', customerIndex: index })).toBe(true)
    expect(matchesChannelLedgerFilters(unrelated, { query: '折扣游戏渠道', customerIndex: index })).toBe(false)
  })

  it('prefers exact legal identity and ignores a shared or misleading channel nickname', () => {
    const another = { id: 'p4', name: '广州独立网络科技有限公司', shortName: '芯动（朋克4）' }
    const multiIndex = buildCustomerBillSearchIndex([...customers, another])
    expect(matchesChannelLedgerFilters(channelBill, { query: '朋克4', customerIndex: multiIndex })).toBe(false)
    expect(matchesChannelLedgerFilters(channelBill, { query: '朋克', customerIndex: multiIndex })).toBe(true)
    expect(customerSearchFieldsForBill({ channelName: '芯动', partnerName: '' }, multiIndex)).toEqual([])
  })

  it('allows a unique exact parenthesized short-name base for legacy bills missing a legal partner', () => {
    const legacy = { ...channelBill, partnerName: '' }
    expect(linkedCustomerMatchesKeyword(legacy, '朋克', index)).toBe(true)
    expect(customerSearchFieldsForBill(legacy, index)).toContain('芯动（朋克）')
    expect(linkedCustomerMatchesKeyword({ ...legacy, channelName: '动' }, '朋克', index)).toBe(false)
  })

  it('cannot override an explicitly different legal company using a channel brand prefix', () => {
    const bill = { channelName: '芯动', partnerName: '深圳另一家科技有限公司' }
    expect(customerSearchFieldsForBill(bill, index)).toEqual([])
    expect(linkedCustomerMatchesKeyword(bill, '朋克', index)).toBe(false)
  })

  it('supports a stable linked customer ID for RD bills even if display names are historical', () => {
    const bill = { partnerId: 'p1', partner: '过去的研发方简称' }
    expect(linkedCustomerMatchesKeyword(bill, '朋克', index)).toBe(true)
    expect(linkedCustomerMatchesKeyword({ ...bill, partnerId: 'does-not-exist' }, '朋克', index)).toBe(false)
  })

  it('does not use substring guessing for different customer legal names', () => {
    const channelA = { channelName: '游戏合作', partnerName: company }
    const channelB = { channelName: '游戏合作', partnerName: '湖南芯动互动科技有限公司' }
    expect(linkedCustomerMatchesKeyword(channelA, '朋克', index)).toBe(true)
    expect(linkedCustomerMatchesKeyword(channelB, '朋克', index)).toBe(false)
  })

  it('keeps channel bill periods, game, amount, and number keyword search intact', () => {
    expect(matchesChannelLedgerFilters(channelBill, { query: 'QD-XD', customerIndex: index })).toBe(true)
    expect(matchesChannelLedgerFilters(channelBill, { query: '某游戏', customerIndex: index })).toBe(true)
    expect(matchesChannelLedgerFilters(channelBill, { month: '2026-08', query: '朋克', customerIndex: index })).toBe(false)
    expect(matchesChannelLedgerFilters(channelBill, { query: '朋克' })).toBe(false)
    expect(matchesChannelLedgerFilters(channelBill, { query: '【】', customerIndex: index })).toBe(false)
  })

  it('normalizes full-width brackets and spaces without confusing 朋克 and 朋克4', () => {
    expect(normalizeCustomerSearch('芯动（朋克）')).toBe('芯动朋克')
    expect(normalizeCustomerSearch('芯动 ( 朋克 )')).toBe('芯动朋克')
    expect(normalizeCustomerSearch('朋克4')).not.toEqual(normalizeCustomerSearch('朋克'))
  })
})
