import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { auditChannelBillMonths, channelAuditMonths } from './channelMonthCoverage.js'
import ChannelMonthCoveragePanel from '@/components/channel/ChannelMonthCoveragePanel.jsx'

const now = new Date(2026, 9, 10, 10, 0, 0)
function bill(month, channelName, gameName='一起来修仙') {
  return {
    id: month + '-' + channelName,
    channelName,
    partnerName: channelName + '合作方',
    settlementMonth: month,
    status: 'confirmed',
    items: [{ settlementCycle: month, gameName }]
  }
}

describe('channel month coverage follows ledger identity search', () => {
  it('filters to one channel but scans all its historical months even if keyword matched a single game', () => {
    const records = [
      bill('2026-04','百分','旧游戏'),
      bill('2026-09','百分','云上征途'),
      bill('2026-06','八门','云上征途')
    ]
    const focused = auditChannelBillMonths(records, {now,channelFilter:'百分',keyword:'云上征途'})
    expect(focused.coveredChannelCount).toBe(1)
    expect(focused.matchingChannelCount).toBe(1)
    expect(focused.channels[0].name).toBe('百分')
    expect(focused.channels[0].gaps).toEqual(['2026-05','2026-06','2026-07','2026-08'])
    expect(focused.channels[0].cells.find(c => c.month==='2026-04').kind).toBe('recorded')
  })

  it('matches partner or local channel search, and distinguishes no search matches', () => {
    const rows = [bill('2026-07','百分'), bill('2026-08','八门')]
    expect(auditChannelBillMonths(rows,{now,keyword:'百分'}).channels.map(r=>r.name)).toEqual(['百分'])
    expect(auditChannelBillMonths(rows,{now,localChannelSearch:'百分合作方'}).channels.map(r=>r.name)).toEqual(['百分'])
    expect(auditChannelBillMonths(rows,{now,keyword:'未知渠道'}).matchingChannelCount).toBe(0)
  })

  it('shows a channel with no internal gaps when it is focused, with clickable recorded months', () => {
    const months=channelAuditMonths({now,windowSize:6})
    const rows=[...months.map(month=>bill(month,'百分')),bill(months[0],'八门'),bill(months[5],'八门')]
    const html=renderToStaticMarkup(React.createElement(ChannelMonthCoveragePanel,{
      initialExpanded:true,focusKeyword:'百分',records:rows,enabled:true
    }))
    expect(html).toContain('账期巡检')
    expect(html).toContain('关键词')
    expect(html).toContain('百分')
    expect(html).toContain('1</strong> 个渠道已检查')
    expect(html).toContain('0</strong> 个渠道断档')
    expect(html).toContain('channel-month-audit__recorded-button')
    expect(html).toContain('6<!-- -->/<!-- -->6<!-- -->个月有账单')
    expect(html).not.toContain('八门</strong>')
  })
})
