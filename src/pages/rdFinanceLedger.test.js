import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { writeFileSync, readdirSync } from 'node:fs'
import CoreReconciliationPage from './CoreReconciliationPage.jsx'

const { state } = vi.hoisted(() => ({ state: { recon: { records: [] }, settings: { partners: [] } } }))
vi.mock('@/app/AppStateContext.jsx', () => ({ useAppState: () => state }))

describe('研发账单七列展示', () => {
  it('keeps identity together and displays stored payment values independently of settlement', () => {
    state.recon.records = [
      { id: 'sample-1', settlementNumber: 'JS-20260908-001', partnerShortName: '龙魂', partner: '龙魂科技有限公司', game: '一起来修仙005折混服、一起修仙005专服1、长产品名称完整信息用于验证省略号', settlementMonth: '2026-08', gameFlow: 1234567.89, revenueShareRatio: 15, settlementAmount: 185185.18, prepaymentDeduction: 20000, actualPayable: 165185.18, paidAmount: 50000, unpaidAmount: 115185.18, status: 'confirmed' },
      { id: 'sample-2', settlementNumber: 'JS-20260908-002', partnerShortName: '星河', game: '星河传说', settlementPeriods: ['2026-06', '2026-07'], settlementMonth: '2026-07', settlementAmount: 8888, actualPayable: 8888, paidAmount: 8888, unpaidAmount: 0, status: 'settled' },
      { id: 'sample-3', settlementNumber: 'JS-20260908-003', partnerShortName: '山海', game: '山海奇缘', settlementMonth: '2026-08', settlementAmount: 3200, actualPayable: 3200, paidAmount: 0, unpaidAmount: 3200, status: 'pending' }
    ]
    const html = renderToStaticMarkup(React.createElement(CoreReconciliationPage))
    const table = html.match(/<table[\s\S]*?<\/table>/)[0]
    expect((table.match(/<th[ >]/g) || [])).toHaveLength(7)
    expect((table.match(/<col class/g) || [])).toHaveLength(7)
    expect(table).toContain('账单信息')
    expect(table).not.toContain('core-rd-recon-table')
    expect(table).not.toContain('360°')
    expect(table).toContain('删除</button>')
    expect(table).not.toContain('作废</button>')
    const firstCell = table.match(/<tbody><tr[^>]*><td>([\s\S]*?)<\/td>/)[1]
    for (const value of ['龙魂', 'JS-20260908-001', '2026', '一起来修仙']) expect(firstCell).toContain(value)
    expect(firstCell).toContain(`title="${state.recon.records[0].game}"`)
    expect(table).toContain('¥ 185,185.18')
    expect(table).toContain('已付 ¥ 50,000.00')
    expect(table).toContain('未付 ¥ 115,185.18')
    expect(table).toContain('资金已结清')
    expect(table).toContain('多周期')
    expect(table).toContain('rd-finance-cleared')
    expect(table).toContain('选择账单 JS-20260908-001')
    if (process.env.RD_VISUAL_FIXTURE) {
      const css = readdirSync('dist/assets').filter((file) => file.endsWith('.css')).map((file) => `<link rel="stylesheet" href="/dist/assets/${file}">`).join('')
      writeFileSync('rd-visual-check.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8">${css}<link rel="stylesheet" href="/src/styles/RdFinanceLedger.css"><body style="margin:0;padding:24px;background:#f4f7fb"><div style="max-width:1440px;margin:auto">${html}</div></body></html>`)
    }
  })
  it('spans all seven columns in the empty state', () => {
    state.recon.records = []
    const html = renderToStaticMarkup(React.createElement(CoreReconciliationPage))
    expect(html).toContain('colSpan="7"')
    expect(html).toContain('暂无研发账单')
  })
})
