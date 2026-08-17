function text(value) {
  return String(value ?? '').trim()
}

function hasNumber(value) {
  if (value === null || value === undefined || text(value) === '') return false
  const number = Number(value)
  return Number.isFinite(number) && number >= 0
}

function settlementMode(entry) {
  return text(entry?.settlement_mode || entry?.settlementMode).toLowerCase()
}

function settlementBasis(entry) {
  return text(entry?.settlement_basis || entry?.settlementBasis).toLowerCase()
}

function isShareBased(entry) {
  const combined = `${settlementMode(entry)} ${settlementBasis(entry)}`
  if (/cpa|cps|单价|固定|fixed|unit/.test(combined)) return false
  if (/分成|流水|share|revenue|充值/.test(combined)) return true
  return hasNumber(entry?.share_rate ?? entry?.shareRate)
}

export function getContractRuleReadiness(entry, options = {}) {
  const issues = []
  const warnings = []
  const partnerLinked = options.partnerLinked !== false

  if (!partnerLinked) issues.push('未关联客户')
  if (!text(entry?.product_name || entry?.productName)) issues.push('缺游戏/项目名称')

  const start = text(entry?.authorization_start || entry?.authorizationStart)
  const end = text(entry?.authorization_end || entry?.authorizationEnd)
  if (!start || !end) issues.push('缺完整授权期')
  else if (start > end) issues.push('授权期日期异常')

  const mode = text(entry?.settlement_mode || entry?.settlementMode)
  const basis = text(entry?.settlement_basis || entry?.settlementBasis)
  if (!mode && !basis) warnings.push('未明确结算模式/基数')

  if (isShareBased(entry) && !hasNumber(entry?.share_rate ?? entry?.shareRate)) {
    issues.push('缺分成比例')
  }

  const cycle = text(entry?.settlement_cycle || entry?.settlementCycle)
  if (!cycle) warnings.push('未填写结算周期')

  const paymentTerms = text(entry?.payment_terms || entry?.paymentTerms)
  if (!paymentTerms) warnings.push('未填写账期/付款条款')

  const taxRate = entry?.invoice_tax_rate ?? entry?.invoiceTaxRate
  if (!hasNumber(taxRate)) warnings.push('未填写发票税率')

  const channelFeeRate = entry?.channel_fee_rate ?? entry?.channelFeeRate
  if (!hasNumber(channelFeeRate)) warnings.push('未确认通道费率')

  const ready = issues.length === 0
  const level = ready ? (warnings.length ? 'usable' : 'complete') : 'blocked'
  const label = level === 'complete' ? '自动对账就绪' : level === 'usable' ? '可对账 · 建议补全' : '规则待补'

  return {
    ready,
    level,
    label,
    issues,
    warnings,
    missingCount: issues.length + warnings.length,
    blockingCount: issues.length
  }
}

export function summarizeContractReadiness(contract) {
  const items = Array.isArray(contract?.access_items) ? contract.access_items : []
  if (!items.length) {
    return {
      total: 0,
      ready: 0,
      complete: 0,
      blocked: 0,
      label: '未录合作清单',
      level: 'empty'
    }
  }

  const partnerLinked = contract?.partner_link_status === 'linked'
  const results = items.map((item) => getContractRuleReadiness(item, { partnerLinked }))
  const ready = results.filter((item) => item.ready).length
  const complete = results.filter((item) => item.level === 'complete').length
  const blocked = results.filter((item) => item.level === 'blocked').length
  const level = blocked ? 'blocked' : complete === items.length ? 'complete' : 'usable'
  const label = blocked
    ? `${blocked} 条规则待补`
    : complete === items.length
      ? '全部自动对账就绪'
      : `${ready}/${items.length} 条可自动对账`

  return { total: items.length, ready, complete, blocked, label, level, results }
}
