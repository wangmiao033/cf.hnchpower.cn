import React from 'react'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ChannelFlatLedger from './ChannelFlatLedger.jsx'

const bill = (month, amount, more = {}) => ({
  id: month,
  channelName: '百分',
  partnerName: '四川百分网',
  settlementMonth: month,
  billNumber: 'QD-' + month,
  settlementAmount: amount,
  receivedAmount: 0,
  status: 'confirmed',
  items: [{ gameName: '一起来修仙', settlementCycle: month, flow: '100', discountFactor: '0.05' }],
  ...more
})

describe('channel bill flat list rendering', () => {
  it('shows every month directly without the channel accordion', () => {
    const rows = [
      bill('2026-05', 3.88),
      bill('2026-06', 5.91),
      bill('2026-07', 11.91),
      bill('2026-08', 12.92),
      bill('2026-09', 7.08)
    ]
    const html = renderToStaticMarkup(React.createElement(ChannelFlatLedger, {
      rows,
      pageSize: 100,
      page: 1,
      apiEnabled: false
    }))
    expect(html).toContain('账单明细')
    expect(html).toContain('2026-05')
    expect(html).toContain('2026-09')
    expect(html).toContain('¥3.88')
    expect(html).toContain('¥7.08')
    expect(html).toContain('四川百分网')
    expect(html).toContain('一起来修仙')
    expect(html).toContain('共 5 条')
    expect(html).not.toContain('channel-group-toggle')
  })

  it('treats a multi-month record as one bill and labels its range', () => {
    const html = renderToStaticMarkup(React.createElement(ChannelFlatLedger, {
      rows: [bill('2026-08', 100, {
        items: [
          { gameName: '游戏 A', settlementCycle:'2026-07' },
          { gameName: '游戏 B', settlementCycle:'2026-08' }
        ]
      })],
      pageSize: 100,
      apiEnabled: false
    }))
    expect(html).toContain('2026-07 — 2026-08')
    expect(html).toContain('跨月账单')
    expect(html).toContain('¥100.00')
    expect(html).toContain('共 1 条')
  })

  it('keeps existing channel and R&D navigation while introducing internal list modes', () => {
    const page = readFileSync(new URL('../../pages/CoreChannelReconciliationGroupedPage.jsx', import.meta.url), 'utf8')
    const wrapper = readFileSync(new URL('../../pages/CoreChannelReconciliationMasterDetailPage.jsx', import.meta.url), 'utf8')
    expect(page).toContain("const [ledgerView, setLedgerView] = useState('detail')")
    expect(page).toContain("const [flatPageSize, setFlatPageSize] = useState(100)")
    expect(page).toContain("key: 'group', label: '按渠道汇总'")
    expect(page).toContain("key: 'audit', label: '账期巡检'")
    expect(page).toContain('<ChannelFlatLedger')
    expect(page).toContain("style={{ display: ledgerView === 'group' ? undefined : 'none' }}")
    expect(wrapper).toContain('<CoreChannelReconciliationGroupedPage />')
  })
})
