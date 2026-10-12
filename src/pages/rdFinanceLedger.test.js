import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import CoreReconciliationPage from './CoreReconciliationPage.jsx'

const { state } = vi.hoisted(() => ({ state: { recon: { records: [] }, settings: { partners: [] } } }))
vi.mock('@/app/AppStateContext.jsx', () => ({ useAppState: () => state }))

describe('研发账单明细展示', () => {
  it('separates bill identity and stored payment amounts while preserving prepayment and multi-period meaning', () => {
    state.recon.records = [
      { id: 'sample-1', settlementNumber: 'JS-20260908-001', partnerShortName: '龙魂', partner: '龙魂科技有限公司', game: '一起来修仙005折混服、一起修仙005专服1、长产品名称完整信息用于验证省略号', settlementMonth: '2026-08', gameFlow: 1234567.89, revenueShareRatio: 15, settlementAmount: 185185.18, prepaymentDeduction: 20000, actualPayable: 165185.18, paidAmount: 50000, unpaidAmount: 115185.18, status: 'confirmed' },
      { id: 'sample-2', settlementNumber: 'JS-20260908-002', partnerShortName: '星河', game: '星河传说', settlementPeriods: ['2026-06', '2026-07'], settlementMonth: '2026-07', settlementAmount: 8888, actualPayable: 8888, paidAmount: 8888, unpaidAmount: 0, status: 'settled' },
      { id: 'sample-3', settlementNumber: 'JS-20260908-003', partnerShortName: '山海', game: '山海奇缘', settlementMonth: '2026-08', settlementAmount: 3200, actualPayable: 3200, paidAmount: 0, unpaidAmount: 3200, status: 'pending' }
    ]
    const html = renderToStaticMarkup(React.createElement(CoreReconciliationPage))
    const table = html.match(/<table[\s\S]*?<\/table>/)[0]
    expect((table.match(/<th[ >]/g) || [])).toHaveLength(9)
    expect((table.match(/<col class/g) || [])).toHaveLength(9)
    for (const title of ['结算月份', '研发 / 合作方', '游戏 / 账单编号', '研发应结', '已付', '未付', '核对 / 付款']) expect(table).toContain(title)
    expect(table).not.toContain('core-rd-recon-table')
    expect(table).not.toContain('360°')
    expect(table).toContain('删除</button>')
    expect(table).not.toContain('作废</button>')
    const firstBill = table.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*JS-20260908-001(?:(?!<\/tr>)[\s\S])*<\/tr>/)[0]
    for (const value of ['龙魂', 'JS-20260908-001', '2026-08', '一起来修仙']) expect(firstBill).toContain(value)
    expect(firstBill).toContain(`title="${state.recon.records[0].game}"`)
    expect(table).toContain('¥ 185,185.18')
    expect(table).toContain('>¥ 50,000.00</td>')
    expect(table).toContain('>¥ 115,185.18</td>')
    expect(table).toContain('抵扣 ¥ 20,000.00')
    expect(table).toContain('实际应付 ¥ 165,185.18')
    expect(table).toContain('资金已结清')
    expect(table).toContain('跨月账单')
    expect(table).toContain('2026-06—2026-07')
    expect(table).toContain('选择账单 JS-20260908-001')
    expect(table).toContain('详情</button>')
  })
  it('spans every column in the empty state', () => {
    state.recon.records = []
    const html = renderToStaticMarkup(React.createElement(CoreReconciliationPage))
    expect(html).toContain('colSpan="9"')
    expect(html).toContain('暂无研发账单')
  })
  it('paginates the newest bills without reducing totals to the visible page', () => {
    state.recon.records = Array.from({ length: 105 }, (_, i) => ({
      id: String(i), settlementNumber: `JS-${String(i).padStart(3, '0')}`, partner: '测试研发',
      settlementMonth: i === 0 ? '2026-09' : '2026-08', game: '游戏甲',
      settlementAmount: 100, paidAmount: 25, unpaidAmount: 75, actualPayable: 100, status: 'confirmed'
    }))
    const html = renderToStaticMarkup(React.createElement(CoreReconciliationPage))
    const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1]
    expect((tbody.match(/<tr /g) || [])).toHaveLength(100)
    expect(tbody.indexOf('JS-000')).toBeLessThan(tbody.indexOf('JS-104'))
    expect(tbody).not.toContain('JS-001')
    expect(html).toContain('¥ 10,500.00')
    expect(html).toContain('¥ 7,875.00')
    expect(html).toContain('显示第 1–100 条，共 105 条')
    expect(html).toContain('选择当前页全部可操作账单')
  })
})
