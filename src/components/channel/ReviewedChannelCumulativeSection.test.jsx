import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReviewedChannelCumulativeSection, { reviewedChannelCumulativeProps } from './ReviewedChannelCumulativeSection.jsx'

const sample = {
  id: 'CHANNEL-SAVED-1', partnerName: '北京瓦力网络科技有限公司', channelName: '瓦力（小米）',
  settlementMonth: '2026-09', status: 'confirmed', settlementAmount: 475.81, flow: 1128
}
function StubCard(props) {
  return <div data-summary={JSON.stringify(props)}>累计配置已挂载</div>
}

describe('locked channel bill exposes cumulative settlement independent of edit', () => {
  it('uses the exact legal partner, current bill ID and saved amount', () => {
    expect(reviewedChannelCumulativeProps(sample)).toEqual({
      partnerName: '北京瓦力网络科技有限公司',
      platformName: '瓦力（小米）',
      recordId: 'CHANNEL-SAVED-1',
      billStatus: 'confirmed',
      draftBasisAmount: 1128,
      draftSettlementAmount: 475.81,
      showCurrentBillStatus: true,
      compactReviewed: true
    })
  })
  it('shows the cumulative section directly on reviewed bill details', () => {
    const html = renderToStaticMarkup(<ReviewedChannelCumulativeSection record={sample} CumulativeCard={StubCard} />)
    expect(html).toContain('已核对渠道账单累计结算')
    expect(html).not.toContain('本单实结 ¥475.81')
    expect(html).toContain('475.81')
    expect(html).toContain('compactReviewed')
    expect(html).toContain('北京瓦力网络科技有限公司')
    expect(html).toContain('瓦力（小米）')
    expect(html).toContain('累计配置已挂载')
  })
  it('does not guess a missing legal partner', () => {
    const html = renderToStaticMarkup(<ReviewedChannelCumulativeSection record={{ status: 'confirmed' }} CumulativeCard={StubCard} />)
    expect(html).toContain('合作方名称缺失')
    expect(html).not.toContain('累计配置已挂载')
  })
})
