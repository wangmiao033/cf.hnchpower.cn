import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ChannelCumulativeLedgerPanel from './ChannelCumulativeLedgerPanel.jsx'

function row(month, due, received, partner = '四川百分网信息科技有限公司') {
  return {
    id: month,
    channelName: '百分',
    partnerName: partner,
    settlementMonth: month,
    status: received ? 'completed' : 'confirmed',
    settlementAmount: due,
    receivedAmount: received,
    items: [{ settlementCycle: month, gameName: '测试游戏' }]
  }
}

describe('cumulative partner card on channel ledger', () => {
  const bills = [
    row('2026-01',30.70,30.70),
    row('2026-02',68.31,68.31),
    row('2026-03',652.67,652.67),
    row('2026-04',887.42,887.42),
    row('2026-05',3.88,0),
    row('2026-06',5.91,0),
    row('2026-07',11.91,0),
    row('2026-08',12.92,0),
    row('2026-09',7.08,0)
  ]
  it('previews unpaid from May onward, not the four fully paid months', () => {
    const html = renderToStaticMarkup(React.createElement(ChannelCumulativeLedgerPanel, {
      groupKey: '百分', channelName: '百分', records: bills, apiEnabled: false
    }))
    expect(html).toContain('2026年5月—9月')
    expect(html).toContain('¥41.70')
    expect(html).toContain('5 张账单')
    expect(html).toContain('正式累计池')
    expect(html).toContain('未启用')
    expect(html).toContain('当前为离线模式')
    expect(html).not.toContain('¥1,639.10')
  })
  it('will not combine two distinct settlement entities in one channel', () => {
    const html = renderToStaticMarkup(React.createElement(ChannelCumulativeLedgerPanel, {
      groupKey: '百分', channelName: '百分',
      records: [...bills, row('2026-09-other',99,0,'另一家结算公司')],
      apiEnabled: false
    }))
    expect(html).toContain('请选择合作方，避免跨公司合并')
    expect(html).toContain('当前渠道可能对应多个法律主体')
    expect(html).not.toContain('¥140.70')
  })
  it('keeps the existing policy API and batch workflow, and requires explicit threshold setup', () => {
    const ledgerSource = readFileSync(new URL('../../pages/CoreChannelReconciliationGroupedPage.jsx', import.meta.url),'utf8')
    const policySource = readFileSync(new URL('./ChannelCumulativeSettlementCard.jsx', import.meta.url),'utf8')
    expect(ledgerSource).toContain('<ChannelCumulativeLedgerPanel')
    expect(ledgerSource).toContain('const poolDeferred')
    expect(ledgerSource).toContain('disabled={settled || !recon.channelApiEnabled || poolDeferred}')
    expect(policySource).toContain('确认对合作方')
    expect(policySource).toContain('不能自动采用示例金额')
    expect(policySource).toContain("policyResult.id ? (policyResult.threshold_basis || '') : ''")
    expect(policySource).toContain('scope: \'partner\'')
  })
})
