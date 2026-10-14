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
    expect(html).toContain('上传原始结算凭证')
    expect(html).toContain('请选择已上传的平台结算单')
    expect(html).toContain('核准平台实结金额并完成核对')
    expect(html).toMatch(/disabled=""[^>]*>核准平台实结金额并完成核对/)
  })

  it('enables documented confirmation only after file selection and checked acknowledgement', () => {
    const html = renderToStaticMarkup(React.createElement(ChannelSmallVarianceApprovalPanel, {
      ...props,
      attachments: [{ id: 'A1', file_name: '小米开发者平台2026-09.pdf' }],
      selectedAttachmentId: 'A1',
      acknowledgedSource: true
    }))
    expect(html).toContain('小米开发者平台2026-09.pdf')
    expect(html).not.toMatch(/disabled=""[^>]*>核准平台实结金额并完成核对/)
  })

  it('keeps the tiny-variance path free of a mandatory upload', () => {
    const html = renderToStaticMarkup(React.createElement(ChannelSmallVarianceApprovalPanel, {
      ...props,
      platformReview: { ...review, reviewKind: 'small', differenceCents: 21 },
      note: '按平台分成表确认少量尾差'
    }))
    expect(html).toContain('平台小额尾差确认')
    expect(html).not.toContain('上传原始结算凭证（必需）')
  })
})
