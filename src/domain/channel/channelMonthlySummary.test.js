import { describe, expect, it } from 'vitest'
import { channelMonthBreakdown, summarizeChannelReceivable } from './channelMonthlySummary.js'
import { matchesChannelLedgerFilters, channelLedgerSum } from './channelFlatLedgerFilters.js'
import { monthlyBills } from '../../../tests/fixtures/channel-monthly-data.js'

const july = { month: '2026-07' }
const sum = rows => summarizeChannelReceivable(rows, july)

describe('channel monthly receivable (saved amounts, including archives)', () => {
  it('reproduces 39 ordinary + 6 archived bills and preserves the real source difference', () => {
    const rows = monthlyBills()
    const before = JSON.stringify(rows)
    expect(channelLedgerSum(rows.slice(0, 39)).settlementCents).toBe(5195541)
    expect(channelLedgerSum(rows.slice(39)).settlementCents).toBe(987651)
    expect(sum(rows)).toMatchObject({ cents: 6095009, billCount: 45, incompleteCount: 0, unknownMonthCount: 0 })
    expect(sum(rows).cents - 6039840).toBe(55169)
    expect(summarizeChannelReceivable(rows, { month: '2026-08' }).cents).toBe(50891)
    expect(summarizeChannelReceivable(rows, { month: '2026-06' }).cents).toBe(37292)
    expect(JSON.stringify(rows)).toBe(before)
  })
  it('does not double-count repeated bill IDs or include cancelled bills', () => {
    const rows = monthlyBills()
    expect(sum([...rows, ...rows, { ...rows[0], id: 'void', status: 'cancelled' }]).cents).toBe(6095009)
  })
  it('retains business filters, including partner search, and never uses a page subtotal', () => {
    const rows = monthlyBills()
    const partner = rows.filter(row => matchesChannelLedgerFilters(row, { query: '跨月甲测试合作方' }))
    expect(sum(partner).cents).toBe(1000000)
    expect(sum(rows.slice(0, 25)).cents).not.toBe(sum(rows).cents)
    expect(sum(rows.filter(row => matchesChannelLedgerFilters(row, { game: '不存在' }))).cents).toBe(0)
  })
  it('preserves a real zero month and signed amounts without substituting the header', () => {
    const row = { id: 'zero', settlementAmount: 90, items: [
      { settlementCycle: '2026-07', settlementAmount: 0 },
      { settlementCycle: '2026-08', settlementAmount: 100 },
      { settlementCycle: '2026-06', settlementAmount: -10 }
    ] }
    expect(sum([row])).toMatchObject({ cents: 0, billCount: 1, incompleteCount: 0 })
    expect(summarizeChannelReceivable([row], { month: '2026-06' }).cents).toBe(-1000)
  })
  it('uses the authoritative single-month total including rounding, and legacy header periods', () => {
    const row = { settlementMonth: '2026年7月', settlementAmount: 10.01,
      items: [{ settlementAmount: 5 }, { settlementAmount: 5 }] }
    expect(sum([row]).cents).toBe(1001)
    expect(sum([{ settlementMonth: '2026/7', settlementAmount: 12 }]).cents).toBe(1200)
    expect(sum([{ settlementMonth: '2026-08', settlementAmount: 9,
      items: [{ settlementCycle: '2026-07', settlementAmount: 9 }] }]).cents).toBe(900)
  })
  it('does not invent months or allocate incomplete multi-month amounts', () => {
    const row = { id: 'incomplete', settlementAmount: 1000, items: [
      { settlementCycle: '2026-07', settlementAmount: null },
      { settlementCycle: '2026-08', settlementAmount: 12 },
      { settlementCycle: 'invalid', settlementAmount: 50 }
    ] }
    expect(sum([row])).toMatchObject({ cents: 0, incompleteCount: 1, unknownMonthCount: 1 })
    expect(sum([{ settlementAmount: 10 }])).toMatchObject({ cents: 0, billCount: 0, unknownMonthCount: 1 })
    expect(sum([{ settlementMonth: '2026-13', settlementAmount: 10 }]).cents).toBe(0)
  })
  it('uses line periods with header fallback for legacy undated lines', () => {
    const row = { settlementMonth: '2026-08', settlementAmount: 30, items: [
      { settlementCycle: '2026-07', settlementAmount: 10 }, { settlementAmount: 20 }
    ] }
    expect(channelMonthBreakdown(row).byMonth.get('2026-08').cents).toBe(2000)
    expect(sum([row]).cents).toBe(1000)
  })
  it('reports missing amounts and unallocated multi-month adjustments without inventing values', () => {
    expect(sum([{ settlementMonth: '2026-07', items: [] }]).incompleteCount).toBe(1)
    const row = { settlementAmount: 101, items: [
      { settlementCycle: '2026-07', settlementAmount: 40 },
      { settlementCycle: '2026-08', settlementAmount: 60 }
    ] }
    expect(sum([row])).toMatchObject({ cents: 4000, unallocatedCount: 1 })
  })
  it('handles month ranges, all months and empty results without proportional allocations', () => {
    const rows = monthlyBills()
    expect(summarizeChannelReceivable(rows, { fromMonth: '2026-07', toMonth: '2026-07' }).cents).toBe(6095009)
    expect(summarizeChannelReceivable(rows).cents).toBe(6183192)
    expect(summarizeChannelReceivable(rows, { fromMonth: '2026-08', toMonth: '2026-07' }).cents).toBe(0)
    expect(sum([]).cents).toBe(0)
  })
})
