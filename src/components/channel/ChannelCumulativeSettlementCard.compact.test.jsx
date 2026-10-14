import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/features/auth/AuthContext.jsx', () => ({
  useAuth: () => ({ can: () => true })
}))

import ChannelCumulativeSettlementCard from './ChannelCumulativeSettlementCard.jsx'

describe('compact cumulative settlement on confirmed channel bills', () => {
  it('uses one three-number summary and a foldable cumulative setup', () => {
    const html = renderToStaticMarkup(
      <ChannelCumulativeSettlementCard
        partnerName="北京瓦力网络科技有限公司"
        platformName="瓦力（小米）"
        recordId="XIAOMI-202609"
        billStatus="confirmed"
        draftBasisAmount={1128}
        draftSettlementAmount={475.81}
        showCurrentBillStatus
        compactReviewed
      />
    )
    expect(html).toContain('is-reviewed-compact')
    expect(html).toContain('本单累计结算')
    expect(html).toContain('本期已核对金额')
    expect(html).toContain('当前累计应收')
    expect(html).toContain('距离结算门槛')
    expect(html).toContain('¥475.81')
    expect(html).toContain('正在核实本单累计状态')
    expect(html).not.toContain('channel-cumulative-card__bill-status')
    expect(html).not.toContain('channel-cumulative-card__metrics')
    expect(html).not.toContain('月度账单照常核对并锁定')
    expect(html).not.toContain('¥1,000.00') // never assume server policy before it is read
  })
})
