import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ChannelSmallVarianceApprovalPanel from './ChannelSmallVarianceApprovalPanel.jsx'

const review = {
  reviewKind: 'documented',
  systemAmount: 535.80, platformAmount: 475.81,
  settlementAmount: 475.81, differenceCents: 5999,
  absoluteLineDifferenceCents: 5999
}
const props = {
  open: true, kind: 'platform', platformReview: review,
  billId: 'channel-xiaomi-202609',
  note: '已人工核对九月小米平台原始结算单，真实分成按平台入账',
  onNoteChange: () => {}, onConfirm: () => {},
  onCancel: () => {}, onAttachmentChange: () => {},
  onAcknowledgedSourceChange: () => {}
}

describe('single evidence-backed platform reconciliation UI', () => {
  it('requires an uploaded document and attestation for a ¥59.99 difference', () => {
    const html = renderToStaticMarkup(React.createElement(ChannelSmallVarianceApprovalPanel, props))
    expect(html).toContain('平台结算金额差异确认')
    expect(html).toContain('535.80')
    expect(html).toContain('475.81')
    expect(html).toContain('平台结算凭证')
    expect(html).toContain('账单附件')
    expect(html).toContain('补充说明（选填')
    expect(html).toContain('按平台¥475.81确认账单')
    expect(html).toMatch(/disabled=""[^>]*>我已核对凭证，按平台¥475.81确认账单/)
  })

  it('lets admin click once when a document is already linked, even with a blank note', () => {
    const html = renderToStaticMarkup(React.createElement(ChannelSmallVarianceApprovalPanel, {
      ...props,
      note: '',
      attachments: [{ id: 'A1', file_name: '小米开发者平台2026-09.pdf' }]
    }))
    expect(html).toContain('已自动关联')
    expect(html).toContain('小米开发者平台2026-09.pdf')
    expect(html).toContain('补充说明（选填')
    expect(html).toContain('我已核对凭证，按平台¥475.81确认账单')
    expect(html).not.toMatch(/disabled=""[^>]*>我已核对凭证，按平台¥475.81确认账单/)
    expect(html).not.toContain('我已核对小米（或对应平台）的原始分成明细')
  })

  it('only requires selecting a document when there is more than one', () => {
    const html = renderToStaticMarkup(React.createElement(ChannelSmallVarianceApprovalPanel, {
      ...props, note: '',
      attachments: [{ id: 'A1', file_name: 'A.xlsx' }, { id: 'A2', file_name: 'B.pdf' }]
    }))
    expect(html).toContain('本单有 2 份附件')
    expect(html).toContain('选择本次核对的原始凭证')
    expect(html).toMatch(/disabled=""[^>]*>我已核对凭证，按平台¥475.81确认账单/)
  })

  it('keeps the tiny-variance path free of a mandatory upload', () => {
    const html = renderToStaticMarkup(React.createElement(ChannelSmallVarianceApprovalPanel, {
      ...props,
      platformReview: { ...review, reviewKind: 'small', differenceCents: 21 },
      note: '按平台分成表确认少量尾差'
    }))
    expect(html).toContain('平台小额尾差确认')
    expect(html).not.toContain('平台结算凭证')
    expect(html).not.toContain('已自动关联')
  })
})
