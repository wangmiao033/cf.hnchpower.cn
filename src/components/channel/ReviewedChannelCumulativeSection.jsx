import React from 'react'
import ChannelCumulativeSettlementCard from './ChannelCumulativeSettlementCard.jsx'
import './ReviewedChannelCumulativeSection.css'

export function reviewedChannelCumulativeProps(record = {}) {
  return {
    partnerName: String(record.partnerName || record.channelName || '').trim(),
    platformName: String(record.channelName || '').trim(),
    recordId: String(record.id || ''),
    billStatus: String(record.status || 'confirmed'),
    draftBasisAmount: Number(record.flow ?? record.billingFlow ?? 0),
    draftSettlementAmount: Number(record.settlementAmount ?? 0),
    showCurrentBillStatus: true
  }
}

/** A reviewed/locked channel bill can manage its payout *policy* without
 * reopening or editing any of its confirmed amounts or game lines.
 */
export default function ReviewedChannelCumulativeSection({
  record, CumulativeCard = ChannelCumulativeSettlementCard
}) {
  const props = reviewedChannelCumulativeProps(record)
  const amount = Number(record?.settlementAmount ?? 0)
  const displayAmount = (Number.isFinite(amount) ? amount : 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })
  return (
    <section className="reviewed-channel-cumulative" aria-label="已核对渠道账单累计结算">
      <header className="reviewed-channel-cumulative__head">
        <div>
          <span>结算管理 · 无需退回账单修改</span>
          <h2>本单累计结算</h2>
          <p>按同一合作方累计已核对、未收款的结算金额。未达到门槛前不代表已经付款；不同结算主体不可跨公司合并。</p>
        </div>
        <strong>本单实结 ¥{displayAmount}</strong>
      </header>
      {props.partnerName ? (
        <CumulativeCard {...props} />
      ) : (
        <p className="reviewed-channel-cumulative__missing" role="status">合作方名称缺失，无法安全配置累计结算。</p>
      )}
    </section>
  )
}
