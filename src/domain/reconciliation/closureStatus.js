const FINAL_BILL_STATUSES = new Set(['confirmed', 'invoiced', 'completed', 'settled', 'reconciled'])
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'void', 'deleted'])

function numberValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizedStatus(value) {
  return String(value || 'pending').trim().toLowerCase()
}

function activeContract(contracts = []) {
  return contracts.some((item) => String(item?.timeline_status || '').trim() === '生效中')
}

export function buildBillClosureStatus({
  record,
  summary,
  invoiceSummary,
  contracts = []
} = {}) {
  const billStatus = normalizedStatus(record?.status)
  const zeroSettlement = Boolean(summary?.isZeroSettlement)
  const unpaid = Math.max(0, numberValue(summary?.unpaidAmount))
  const paid = Math.max(0, numberValue(summary?.paidAmount))
  const invoiceCoverage = String(invoiceSummary?.coverage_status || '').trim().toLowerCase()

  const contractStage = activeContract(contracts)
    ? { key: 'contract', label: '合同', tone: 'pass', title: '合同有效', detail: '已匹配生效中的合同' }
    : contracts.length
      ? { key: 'contract', label: '合同', tone: 'warning', title: '合同需核对', detail: `匹配 ${contracts.length} 份合同，需确认当前有效依据` }
      : { key: 'contract', label: '合同', tone: 'pending', title: '待匹配合同', detail: '尚未找到生效中的关联合同' }

  const billStage = CANCELLED_STATUSES.has(billStatus)
    ? { key: 'bill', label: '账单', tone: 'blocked', title: '账单已作废', detail: '该账单不再进入后续闭环' }
    : FINAL_BILL_STATUSES.has(billStatus)
      ? { key: 'bill', label: '账单', tone: 'pass', title: '账单已确认', detail: '结算事实已进入正式流程' }
      : { key: 'bill', label: '账单', tone: 'warning', title: '账单待确认', detail: '完成核对后再进入发票与资金环节' }

  let invoiceStage
  if (zeroSettlement) {
    invoiceStage = { key: 'invoice', label: '发票', tone: 'pass', title: '无需开票', detail: '零结算不形成发票缺口' }
  } else if (invoiceCoverage === 'complete') {
    invoiceStage = { key: 'invoice', label: '发票', tone: 'pass', title: '发票已覆盖', detail: '账单金额已被发票完整覆盖' }
  } else if (invoiceCoverage === 'over') {
    invoiceStage = { key: 'invoice', label: '发票', tone: 'blocked', title: '发票超额', detail: '发票分配超过账单金额，需要处理' }
  } else if (invoiceCoverage === 'partial') {
    invoiceStage = { key: 'invoice', label: '发票', tone: 'warning', title: '部分覆盖', detail: `仍有 ¥${numberValue(invoiceSummary?.remaining_amount).toFixed(2)} 发票缺口` }
  } else {
    invoiceStage = { key: 'invoice', label: '发票', tone: 'pending', title: '待关联发票', detail: '尚未形成完整发票覆盖' }
  }

  let fundingStage
  if (zeroSettlement) {
    fundingStage = { key: 'funding', label: '资金', tone: 'pass', title: '无需资金动作', detail: '零结算自动跳过收付款' }
  } else if (unpaid <= 0.01) {
    fundingStage = { key: 'funding', label: '资金', tone: 'pass', title: '资金已结清', detail: '账单已无未结金额' }
  } else if (paid > 0.01) {
    fundingStage = { key: 'funding', label: '资金', tone: 'warning', title: '部分结算', detail: `仍有 ¥${unpaid.toFixed(2)} 未结` }
  } else {
    fundingStage = { key: 'funding', label: '资金', tone: 'pending', title: '待收付款', detail: `待结 ¥${unpaid.toFixed(2)}` }
  }

  const stages = [contractStage, billStage, invoiceStage, fundingStage]
  const blocked = stages.some((stage) => stage.tone === 'blocked')
  const closed = !blocked && stages.every((stage) => stage.tone === 'pass')
  const warning = !blocked && stages.some((stage) => stage.tone === 'warning')

  return {
    stages,
    state: blocked ? 'blocked' : closed ? 'closed' : warning ? 'attention' : 'pending',
    label: blocked ? '存在阻断' : closed ? '已完全闭环' : warning ? '进行中' : '待处理',
    completed: stages.filter((stage) => stage.tone === 'pass').length,
    total: stages.length
  }
}

export function listFundingClosureStatus({ amount, paid, lifecycleStatus, archived = false } = {}) {
  const total = Math.max(0, numberValue(amount))
  const settled = Math.max(0, numberValue(paid))
  const remaining = Math.max(0, total - settled)
  const status = normalizedStatus(lifecycleStatus)

  if (archived) return { tone: 'closed', label: '已归档', detail: '闭环完成' }
  if (CANCELLED_STATUSES.has(status)) return { tone: 'blocked', label: '已作废', detail: '停止结算' }
  if (remaining <= 0.01) return { tone: 'closed', label: '资金已结清', detail: '可完成闭环' }
  if (settled > 0.01) return { tone: 'attention', label: '部分结算', detail: `剩余 ¥${remaining.toFixed(2)}` }
  if (FINAL_BILL_STATUSES.has(status)) return { tone: 'pending', label: '待资金结算', detail: `未结 ¥${remaining.toFixed(2)}` }
  return { tone: 'attention', label: '账单待确认', detail: `未结 ¥${remaining.toFixed(2)}` }
}
