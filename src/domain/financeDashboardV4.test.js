import { describe, expect, it } from 'vitest'
import { summarizeFinancePeriod, combineMonthlyTrends, displayMoney, latestPeriod } from './financeDashboardV4.js'

const profit = {
  month: '2026-08', available_months: ['2026-08','2026-07'],
  channel_settlement: { value: 100000 }, rd_cost: { value: 35000 },
  operating_profit: { value: 37000 }, project_gross_profit: { value: 41000 },
  shared_server_cost: { value: 1000 }, shared_expense: { value: 3000 },
  attributed_expense: { value: 7000 }, server_cost: { value: 11000 },
  operating_expense: { value: 17000 },
  trend: [
    { month: '2026-07', channel_settlement: 60000, rd_cost: 10000, server_cost: 1000, operating_expense: 9000, project_gross_profit: 42000, operating_profit: 40000 },
    { month: '2026-08', channel_settlement: 100000, rd_cost: 35000, server_cost: 11000, operating_expense: 17000, project_gross_profit: 41000, operating_profit: 37000 }
  ]
}
const business = {
  month: '2026-09', available_months: ['2026-09','2026-08','2026-07'],
  channel_settlement: { value: 90000 }, rd_settlement: { value: 20000 },
  channel_receipts: { value: 16000 }, rd_payments: { value: 25000 }, contribution: { value: 60000 },
  trend: [
    {month: '2026-07', channel_settlement: 60000, rd_settlement: 10000, contribution: 50000, channel_receipts: 12000, rd_payments: 8000, cash_net: 4000},
    {month: '2026-08', channel_settlement: 91000, rd_settlement: 36000, contribution: 51000, channel_receipts: 16000, rd_payments: 25000, cash_net: -9000},
    {month: '2026-09', channel_settlement: 90000, rd_settlement: 20000, contribution: 60000, channel_receipts: 32000, rd_payments: 19000, cash_net: 13000}
  ]
}

describe('V4 finance overview scopes and display-only metrics', () => {
  it('keeps selected-month profit and cash-date business accounting distinct', () => {
    const b = { ...business, month: '2026-08', channel_settlement: {value: 91000}, rd_settlement: {value: 36000} }
    const s = summarizeFinancePeriod(profit, b, '2026-08')
    expect(s.gross).toBe(41000)
    expect(s.operating).toBe(37000)
    expect(s.sharedTotal).toBe(4000)
    expect(s.channelSettlement).toBe(91000)
    expect(s.cashNet).toBe(-9000)
    expect(s.profitIncome).toBe(100000)
    expect(s.gross - s.sharedTotal).toBe(s.operating)
  })
  it('does not show false zero profit for a cash-only period', () => {
    const s = summarizeFinancePeriod(profit, business, '2026-09')
    expect(s.profitReady).toBe(false)
    expect(s.gross).toBeNull()
    expect(s.operating).toBeNull()
    expect(s.businessReady).toBe(true)
  })
  it('annual metrics sum existing month trend with same year, not future placeholders', () => {
    const s = summarizeFinancePeriod(profit, business, '2026-year')
    expect(s.gross).toBe(83000)
    expect(s.operating).toBe(77000)
    expect(s.sharedTotal).toBe(6000)
    expect(s.cashNet).toBe(8000)
    expect(s.channelSettlement).toBe(241000)
  })
  it('formatting does not invent values, preserves cents on small numbers', () => {
    expect(displayMoney(null)).toBe('—')
    expect(displayMoney(10000)).toBe('1.00 万元')
    expect(displayMoney(-28950.25)).toBe('−2.90 万元')
    expect(displayMoney(9999.99)).toBe('¥9,999.99')
  })
  it('uses the latest month from both services and excludes future placeholders', () => {
    expect(latestPeriod(profit, business)).toBe('2026-09')
    const rows=combineMonthlyTrends(profit,business,'2026-09',{months:12})
    expect(rows).toHaveLength(3)
    const year=combineMonthlyTrends(profit,business,'',{annual:true,year:'2026',months:12})
    expect(year.at(-1).month).toBe('2026-09')
  })
})
