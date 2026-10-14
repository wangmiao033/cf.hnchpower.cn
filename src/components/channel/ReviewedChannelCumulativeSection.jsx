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
    showCurrentBillStatus: true,
    compactReviewed: true
  }
}

/** A reviewed/locked channel bill can manage its payout *policy* without
 * reopening or editing any of its confirmed amounts or game lines.
 */
export default function ReviewedChannelCumulativeSection({
  record, CumulativeCard = ChannelCumulativeSettlementCard
}) {
  const props = reviewedChannelCumulativeProps(record)
  return (
    <section className="reviewed-channel-cumulative" aria-label="已核对渠道账单累计结算">
      {props.partnerName ? (
        <CumulativeCard {...props} />
      ) : (
        <p className="reviewed-channel-cumulative__missing" role="status">
          合作方名称缺失，暂时无法配置累计结算。
        </p>
      )}
    </section>
  )
}
