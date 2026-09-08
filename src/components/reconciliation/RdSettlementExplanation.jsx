import React from 'react'
import { calculateRdSettlementRow } from '@/domain/settlement/calculateSettlementAmount.js'

export const rdMoney = (value) => value == null || !Number.isFinite(Number(value)) ? '—' : `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function RdSettlementExplanation({ line, channelFeeRate }) {
  const calc = calculateRdSettlementRow(line, channelFeeRate)
  return (
    <div className="rd-calculation-steps">
      <div><span>① 折后流水</span><p>{rdMoney(line.revenue || 0)} × {line.discountRate ?? 1} = <b>{rdMoney(calc.totalFlow)}</b></p></div>
      <div><span>② 扣除费用</span><p>代金券 {rdMoney(line.couponAmount || 0)} · 测试费 {rdMoney(line.testFee || 0)} · 额外费用 {rdMoney(line.extraFee || 0)}</p><p>计费基础 <b>{rdMoney(calc.billingBase)}</b></p></div>
      <div><span>③ 参与分成</span><p>计费基础 × (1 − 通道费 {channelFeeRate || 0}%) × (1 − 税率 {line.taxRate || 0}%)</p><p>参与分成金额 <b>{rdMoney(calc.shareAmount)}</b></p></div>
      <div><span>④ 研发应结</span><p>参与分成金额 × {line.shareRatio || 0}% = <b>{rdMoney(calc.settlementAmount)}</b></p></div>
      <small>沿用账单现有结算公式；此处金额显示到分，中间计算保留原精度。</small>
    </div>
  )
}
