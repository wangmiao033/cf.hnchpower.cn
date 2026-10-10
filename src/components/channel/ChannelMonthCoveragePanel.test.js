import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ChannelMonthCoveragePanel from './ChannelMonthCoveragePanel.jsx'
import { channelAuditMonths } from '@/domain/channel/channelMonthCoverage.js'

function mockBill(month) {
  return {
    id: 'channel-' + month,
    channelName: '八门',
    settlementMonth: month,
    status: 'pending',
    items: [{ settlementCycle: month, gameName: '游戏' }]
  }
}

describe('channel ledger compact overview', () => {
  it('collapses audit details by default while keeping the gap summary visible', () => {
    const months = channelAuditMonths({ windowSize: 3 })
    const html = renderToStaticMarkup(
      React.createElement(ChannelMonthCoveragePanel, {
        records: [mockBill(months[0]), mockBill(months[2])],
        enabled: true
      })
    )
    expect(html).toContain('账期巡检')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('展开检查')
    expect(html).toContain('channel-month-audit__inline-metrics')
    expect(html).toContain('1</strong> 个渠道断档')
    expect(html).toContain('1</strong> 个月次待核实')
    expect(html).not.toContain('channel-month-audit__matrix')
    expect(html).not.toContain('channel-month-audit__filters')
  })

  it('preserves offline-data warnings even when the details are collapsed', () => {
    const html = renderToStaticMarkup(
      React.createElement(ChannelMonthCoveragePanel, { records: [], enabled: false })
    )
    expect(html).toContain('渠道接口暂未连接')
    expect(html).toContain('aria-expanded="false"')
  })

  it('keeps the four live KPIs and applies only channel-scoped compact CSS', () => {
    const page = readFileSync(new URL('../../pages/CoreChannelReconciliationGroupedPage.jsx', import.meta.url), 'utf8')
    const style = readFileSync(new URL('./ChannelMonthCoveragePanel.css', import.meta.url), 'utf8')
    expect(page).toContain('core-recon-stats core-channel-stats-compact')
    expect(page).toContain('core-channel-stat__bottom')
    expect(page).toContain('<ChannelMonthCoveragePanel')
    expect(style).toContain('.core-channel-recon-page .core-recon-stats.core-channel-stats-compact')
    expect(style).toContain('height: auto;')
    expect(style).toContain('overflow: visible;')
    expect(style).toContain('max-height: 600px;')
    expect(style).not.toContain('max-height: min(250px, 36vh)')
  })
})
