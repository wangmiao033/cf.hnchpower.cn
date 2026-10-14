import { describe, expect, it } from 'vitest'
import { matchesChannelLedgerFilters, sortChannelLedgerRows, channelLedgerSum } from './channelFlatLedgerFilters.js'

const bill = (id, month, amount, extra = {}) => ({
  id,
  channelName: '百分',
  partnerName: '四川百分网',
  status: 'confirmed',
  settlementMonth: month,
  statementNo: 'QD-' + id,
  settlementAmount: amount,
  receivedAmount: 0,
  items: [{ settlementCycle: month, gameName: '一起来修仙', flow: '100', discountFactor: '0.05' }],
  ...extra
})

describe('flat channel ledger', () => {
  it('finds every monthly bill without opening a channel accordion', () => {
    const rows = ['2026-05','2026-06','2026-07','2026-08','2026-09']
      .map((month, i) => bill(String(i), month, [3.88,5.91,11.91,12.92,7.08][i]))
    const target = rows.filter(row => matchesChannelLedgerFilters(row, {
      fromMonth: '2026-05', toMonth: '2026-09', channel: '百分', game: '一起'
    }))
    expect(target).toHaveLength(5)
    expect(channelLedgerSum(target).unpaidCents).toBe(4170)
  })
  it('keeps a multi-period bill intact and never double-counts the amount', () => {
    const multi = bill('multi','2026-08',200,{
      items: [
        { settlementCycle: '2026-07', gameName: '游戏 A' },
        { settlementCycle: '2026-08', gameName: '游戏 B' }
      ]
    })
    expect(matchesChannelLedgerFilters(multi, { month:'2026-07' })).toBe(true)
    expect(matchesChannelLedgerFilters(multi, { month:'2026-08' })).toBe(true)
    expect(matchesChannelLedgerFilters(multi, { fromMonth:'2026-07', toMonth:'2026-08' })).toBe(true)
    expect(matchesChannelLedgerFilters(multi, { fromMonth:'2026-09', toMonth:'2026-09' })).toBe(false)
    expect(channelLedgerSum([multi]).settlementCents).toBe(20000)
  })
  it('supports case-insensitive search, game and status filtering', () => {
    const row = bill('ABC','2026-09',12,{ status:'pending' })
    expect(matchesChannelLedgerFilters(row,{query:'qd-abc'})).toBe(true)
    expect(matchesChannelLedgerFilters(row,{game:'修仙'})).toBe(true)
    expect(matchesChannelLedgerFilters(row,{status:'confirmed'})).toBe(false)
    expect(matchesChannelLedgerFilters(row,{fromMonth:'2026-10',toMonth:'2026-09'})).toBe(false)
  })
  it('discovers 游海、麦游、海游 and mixed old labels in the same keyword box', () => {
    const youhai = bill('YOUHAI', '2026-08', 3119.46, {
      channelName: '游海', partnerName: '西安游海网络科技有限公司',
      originalChannelName: '游海（麦游）'
    })
    const maiyou = bill('MAIYOU', '2026-09', 2802.70, {
      channelName: '麦游', partnerName: '西安麦游网络科技有限公司'
    })
    const other = bill('OTHER', '2026-09', 100, {
      channelName: '百分', partnerName: '四川百分网'
    })
    for (const query of ['游海', '麦游', '海游', '游海（麦游）', '游海(麦游)', '游海麦游']) {
      expect([youhai, maiyou, other].filter(row => matchesChannelLedgerFilters(row, { query })).map(row => row.id), query)
        .toEqual(['YOUHAI', 'MAIYOU'])
    }
    expect(matchesChannelLedgerFilters(youhai, { query: '西安游海网络科技有限公司' })).toBe(true)
    expect(matchesChannelLedgerFilters(maiyou, { query: '西安游海网络科技有限公司' })).toBe(false)
    expect(matchesChannelLedgerFilters(maiyou, { query: '西安麦游网络科技有限公司' })).toBe(true)
    // Search groups results, but doesn't merge legal entities or modify amounts.
    expect(youhai.partnerName).not.toBe(maiyou.partnerName)
    expect(youhai.settlementAmount).toBe(3119.46)
    expect(maiyou.settlementAmount).toBe(2802.70)
  })

  it('searches original legacy channel names without altering their stored company', () => {
    const row = bill('LEGACY', '2026-07', 833.30, {
      channelName: '游海', originalChannelName: '游海（麦游）',
      partnerName: '西安游海网络科技有限公司'
    })
    expect(matchesChannelLedgerFilters(row, { query: '麦游' })).toBe(true)
    expect(matchesChannelLedgerFilters(row, { query: '游海（麦游）' })).toBe(true)
    expect(matchesChannelLedgerFilters(row, { query: '西安麦游网络科技有限公司' })).toBe(false)
    expect(matchesChannelLedgerFilters(row, { query: '完全不相关' })).toBe(false)
  })

  it('sorts by latest month, unpaid amount and channel, without mutating input', () => {
    const x = bill('a','2026-07',20,{channelName:'九游'})
    const y = bill('b','2026-09',5,{channelName:'八门'})
    const input = [x,y]
    expect(sortChannelLedgerRows(input).map(v=>v.id)).toEqual(['b','a'])
    expect(sortChannelLedgerRows(input,'unpaid-desc').map(v=>v.id)).toEqual(['a','b'])
    expect(input.map(v=>v.id)).toEqual(['a','b'])
  })
})
