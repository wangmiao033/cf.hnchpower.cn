import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/components/billing/BillScanAttachments.jsx', () => ({ default: () => React.createElement('div', null, '附件上传') }))
import Panel from './ChannelSmallVarianceApprovalPanel.jsx'
const lines = [
  { line_id: 'L1', game_name: '六界仙尊', settlement_cycle: '2026-09', system_amount: 1494.35, platform_amount: 1494.46 },
  { line_id: 'L2', game_name: '帝国雄师', settlement_cycle: '2026-09', system_amount: 4331.05, platform_amount: 4328.09 }
]
const props = {
  open: true, kind: 'platform', busy: false, note: '逐游戏核对官方九月结算单',
  onNoteChange: () => {}, onConfirm: () => {}, onCancel: () => {},
  attachments: [{ id: 'ATT', file_name: 'sep.pdf' }],
  platformReview: { policyCode: 'honor_official_statement_v1', reviewKind: 'documented', officialLines: lines,
    systemAmount: 5825.40, platformAmount: 5822.55, settlementAmount: 5822.55,
    differenceCents: 285, absoluteLineDifferenceCents: 307 },
  officialConfirmedLineIds: ['L1', 'L2']
}
const render = overrides => renderToStaticMarkup(React.createElement(Panel, { ...props, ...overrides }))
const confirmDisabled = html => /<button[^>]*class="is-primary"[^>]*disabled|<button[^>]*disabled[^>]*class="is-primary"/.test(html)
describe('Honor official statement confirmation panel', () => {
  it('displays per-game official and computed amounts with a required source reason', () => {
    const html = render({})
    expect(html).toContain('荣耀官方结算单确认')
    expect(html).toContain('官方 ¥1494.46；公式 ¥1494.35')
    expect(html).toContain('官方 ¥4328.09；公式 ¥4331.05')
    expect(html).toContain('sep.pdf')
    expect(html).toContain('官方结算核对依据（必填，至少6个字）')
    expect(confirmDisabled(html)).toBe(false)
  })
  it('blocks incomplete lines, missing source and missing reason', () => {
    expect(confirmDisabled(render({ officialConfirmedLineIds: ['L1'] }))).toBe(true)
    expect(confirmDisabled(render({ note: '' }))).toBe(true)
    expect(confirmDisabled(render({ attachments: [] }))).toBe(true)
  })
  it('leaves generic platform review free of Honor requirements', () => {
    const html = render({ platformReview: { ...props.platformReview, policyCode: undefined, officialLines: undefined }, note: '' })
    expect(html).not.toContain('逐游戏确认官方结算金额')
    expect(confirmDisabled(html)).toBe(false)
  })
})
