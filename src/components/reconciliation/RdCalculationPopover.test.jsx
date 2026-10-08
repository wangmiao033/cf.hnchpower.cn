import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import RdCalculationPopover from './RdCalculationPopover.jsx'

describe('研发应结计算详情入口', () => {
  const line = {
    gameName: '六界飞仙0.1折', settlementCycle: '2026年7月',
    revenue: '1000', discountRate: '0.01', shareRatio: '20',
    couponAmount: '0', testFee: '0', extraFee: '0', taxRate: '0'
  }

  it('renders a compact calculation button inside the payable field', () => {
    const markup = renderToStaticMarkup(
      <RdCalculationPopover line={line} amount={2} rowIndex={0} channelFeeRate="0" />
    )
    expect(markup).toContain('第 1 行研发应结')
    expect(markup).toContain('value="2.00"')
    expect(markup).toContain('aria-haspopup="dialog"')
    expect(markup).toContain('title="查看本行计算过程"')
  })

  it('does not render a separate calculation row or dialog until clicked', () => {
    const markup = renderToStaticMarkup(
      <RdCalculationPopover line={line} amount={2} rowIndex={0} channelFeeRate="0" />
    )
    expect(markup).not.toContain('rd-focused-formula')
    expect(markup).not.toContain('rd-calculation-overlay')
    expect(markup).not.toContain('role="dialog"')
  })
})
