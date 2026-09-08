import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import RdContractReview from './RdContractReview.jsx'

describe('合同核对界面', () => {
  it('keeps uncertain estimates inside collapsed evidence and does not call the difference a manual adjustment', () => {
    const html = renderToStaticMarkup(React.createElement(RdContractReview, {
      record: { settlementAmount: 22557.99, items: [{ gameName: '示例游戏', revenue: 33174989, discountRate: 0.005, couponAmount: 15488.35, shareRatio: 15 }] }, current: true,
      recommendation: { lines: [{ line_index: 0, auto_apply: false, match: { contract_name: '示例合同', authorization_status: 'covered' }, recommended: { basis_mode: 'ambiguous' }, contract_amount: { deterministic: false, expected_amount: 4973925.1 } }] }
    }))
    const evidence = html.match(/<details[\s\S]*?<\/details>/)[0]
    expect(evidence).not.toMatch(/<details[^>]* open/)
    expect(evidence).toContain('参考试算（未确认）')
    expect(evidence).toContain('4,973,925.10')
    expect(html.replace(evidence, '')).not.toContain('4,973,925.10')
    expect(html).toContain('暂不比较')
    expect(html).not.toContain('<span>人工调整</span>')
    expect(html).toContain('查看合同依据与计算过程')
    expect(html).toContain('22,557.99')
  })
})
