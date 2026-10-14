/** Explain the status of ONE confirmed bill based on the server condition.
 * Never infer pool membership from the partner's policy alone.
 */
const money = value => {
  const n = Number(value)
  return '¥' + (Number.isFinite(n) ? n : 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })
}

export function describeReviewedChannelCumulative(condition, savedBillAmount = 0) {
  if (!condition) return {
    tone: 'loading', title: '正在核实本单累计状态',
    description: '以服务器保存的结算策略和财务记录为准。'
  }
  if (condition.mode !== 'threshold' || !condition.policy?.enabled) return {
    tone: 'setup', title: '本单尚未启用累计结算',
    description: '请在下方为对应合作方设置累计规则，无需修改或重新核对本张账单。'
  }
  if (condition.state === 'batched') return {
    tone: 'batched', title: '本单已进入累计结算批次',
    description: `批次：${condition.batch?.batch_no || '请查看下方记录'}。后续按批次收款，不会再次加入当前累计池。`
  }
  if (condition.deferred && condition.state === 'accumulating') return {
    tone: 'accumulating', title: '本单已纳入累计待结算池',
    description: `本单结算 ${money(savedBillAmount)}；未达到门槛时只累计应收，不代表已开票或已收款。`
  }
  if (condition.deferred && condition.state === 'ready') return {
    tone: 'ready', title: '本单已入池，累计金额达到结算门槛',
    description: `本单结算 ${money(savedBillAmount)}；可以生成结算批次，但尚不代表已经收到款。`
  }
  if (condition.state === 'financial_activity_started') return {
    tone: 'warning', title: '本单未进入当前累计池',
    description: '请核对是否已有收款、发票关联或其他财务处理，避免重复累计。'
  }
  if (condition.state === 'not_applicable') return {
    tone: 'warning', title: '本单尚不满足入池条件',
    description: '需符合当前合作方的政策，并且账单已核对、尚未收款或开票。'
  }
  return {
    tone: 'warning', title: '本单累计状态需要进一步核实',
    description: '请检查本单实际财务记录；不会自动更改结算或收款。'
  }
}
