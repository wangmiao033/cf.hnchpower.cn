import React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ChannelBillReadonlyView from './ChannelBillReadonlyView.jsx'

const bill = {
  id: 'XIAOMI-202609',
  billNumber: 'QD-20261010-09CA29',
  partnerName: '北京瓦力网络科技有限公司',
  channelName: '瓦力（小米）',
  settlementMonth: '2026-09',
  status: 'confirmed',
  flow: 1128,
  billingAmount: 1001.70,
  shareAmount: 500.85,
  settlementAmount: 475.81,
  platformSettlementAmount: 475.81,
  receivedAmount: 0,
  remark: '小米平台确认，累计满1000元后申请结算',
  validationStatus: 'pass'
}

describe('reviewed channel bill detail density', () => {
  it('keeps primary game table visible and full audit data in closed disclosures', () => {
    const html = renderToStaticMarkup(
      <ChannelBillReadonlyView recordId="XIAOMI-202609" fallbackRecord={bill} />
    )
    expect(html).toContain('游戏结算明细')
    expect(html).toContain('游戏结算简明表')
    expect(html).toContain('代金券')
    expect(html).toContain('平台实结')
    expect(html).toContain('北京瓦力网络科技有限公司')
    expect(html).toContain('QD-20261010-09CA29')
    expect(html).toContain('全部结算计算字段')
    expect(html).toContain('账单资料与金额构成')
    expect(html).toContain('结算规则、历史备注与调整')
    expect(html).toContain('原始账单附件')
    expect((html.match(/<details class="channel-readonly-fold"/g) || []).length).toBe(4)
    expect(html).not.toContain('<details open')
    expect(html).toContain('¥475.81') // saved record, not recalculated
    // Heavy detail DOM and secondary attachments load only on expansion.
    expect(html).not.toContain('¥0.00')
    expect(html).not.toContain('小米平台确认，累计满1000元后申请结算')
    expect(html).toContain('按需查看')
    expect(html).not.toContain('保存修改')
  })
})
