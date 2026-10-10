import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/app/AppStateContext.jsx', () => ({
  useAppState: () => ({ setActiveView: () => {}, showToast: () => {} })
}))

import ProfitAnalysisPage, { AnnualProfitOverview, ProfitTrend } from './ProfitAnalysisPage.jsx'

describe('profit analysis render smoke tests', () => {
  it('renders an explicit loading message before the API responds', () => {
    const html = renderToStaticMarkup(React.createElement(ProfitAnalysisPage))
    expect(html).toContain('正在读取利润分析')
    expect(html).toContain('role="status"')
    expect(html).toContain('profit-loading-state')
  })

  it('renders the monthly trend using a React memo hook without ReferenceError', () => {
    const html = renderToStaticMarkup(React.createElement(ProfitTrend, {
      rows: [
        { month: '2026-08', channel_settlement: 200, operating_profit: 85 },
        { month: '2026-09', channel_settlement: 100, operating_profit: -20 }
      ]
    }))
    expect(html).toContain('十二个月经营利润趋势')
    expect(html).toContain('08月')
    expect(html).toContain('09月')
    expect(html).toContain('is-loss')
  })

  it('renders the annual overview and its nested monthly chart after data arrives', () => {
    const html = renderToStaticMarkup(React.createElement(AnnualProfitOverview, {
      data: {
        available_months: ['2026-09', '2026-08'],
        trend: [
          {
            month: '2026-08', channel_settlement: 200,
            rd_cost: 50, server_cost: 10, operating_expense: 40,
            operating_profit: 100, profit_margin: 50
          },
          {
            month: '2026-09', channel_settlement: 150,
            rd_cost: 60, server_cost: 10, operating_expense: 40,
            operating_profit: 40, profit_margin: 26.67
          }
        ]
      },
      selectedYear: '2026',
      setSelectedYear: () => {},
      onRefresh: () => {},
      loading: false
    }))
    expect(html).toContain('2026 年度利润总览')
    expect(html).toContain('年度经营概况')
    expect(html).toContain('¥140.00')
    expect(html).toContain('08月')
    expect(html).toContain('09月')
  })
})
