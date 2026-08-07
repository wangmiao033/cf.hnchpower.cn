const FINAL_STATUSES = new Set(['completed', 'settled', 'reconciled'])
const INVOICE_EXPECTED_STATUSES = new Set(['confirmed', 'invoiced', 'completed', 'settled', 'reconciled'])
const CLOSED_STATUSES = new Set(['cancelled', 'canceled', 'deleted', 'void', 'archived'])

export const ANOMALY_SEVERITY_ORDER = {
  critical: 0,
  warning: 1,
  info: 2
}

export const ANOMALY_CATEGORY_LABELS = {
  payment: '收付款',
  invoice: '发票',
  duplicate: '重复风险',
  contract: '合同',
  data: '数据',
  quality: '资料完整性'
}

function text(value) {
  return value == null ? '' : String(value).trim()
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeMonthKey(value) {
  const raw = text(value)
  const match = raw.match(/(20\d{2})\D{0,3}(1[0-2]|0?[1-9])(?:\D|$)/)
  return match ? `${match[1]}-${String(Number(match[2])).padStart(2, '0')}` : ''
}

function normalizeCompany(value) {
  return text(value)
    .toLowerCase()
    .replace(/[\s()（）·,，.。\-_/\\]/g, '')
    .replace(/股份有限公司$/g, '')
    .replace(/有限责任公司$/g, '')
    .replace(/有限公司$/g, '')
}

function billStatus(row) {
  return text(row?.status || 'pending').toLowerCase()
}

function isClosedBill(row) {
  return CLOSED_STATUSES.has(billStatus(row))
}

function billNumber(type, row) {
  return text(
    type === 'rd'
      ? row?.settlementNumber || row?.statementNo || row?.billNumber
      : row?.billNumber || row?.statementNo || row?.settlementNumber
  )
}

function billPartner(type, row) {
  return text(
    type === 'rd'
      ? row?.partnerShortName || row?.partner || row?.partyBName
      : row?.partnerName || row?.channelName
  )
}

function billPartnerId(type, row) {
  return type === 'rd' ? text(row?.partnerId) : text(row?.partnerId)
}

function billSettlementAmount(row) {
  return Math.abs(number(row?.settlementAmount ?? row?.totalAmount ?? row?.amount))
}

function billPaidAmount(type, row) {
  return Math.abs(
    number(type === 'rd' ? row?.paidAmount : row?.receivedAmount ?? row?.paidAmount)
  )
}

function billPeriods(type, row) {
  if (type === 'channel') {
    const key = normalizeMonthKey(row?.settlementMonth || row?.billMonth || row?.month)
    return key ? [key] : []
  }

  const candidates = [
    ...(Array.isArray(row?.settlementPeriods) ? row.settlementPeriods : []),
    ...(Array.isArray(row?.items)
      ? row.items.map((item) => item?.settlementCycle || item?.settlement_period)
      : []),
    row?.settlementMonth,
    row?.month
  ]
  return [...new Set(candidates.map(normalizeMonthKey).filter(Boolean))]
}

function billPrimaryPeriod(type, row) {
  return billPeriods(type, row)[0] || normalizeMonthKey(row?.settlementMonth || row?.month)
}

function billGameLabel(type, row) {
  if (type === 'channel') {
    const names = Array.isArray(row?.items)
      ? row.items.map((item) => text(item?.gameName)).filter(Boolean)
      : []
    return [...new Set(names)].join('、') || text(row?.gameName || row?.game)
  }
  const names = Array.isArray(row?.items)
    ? row.items.map((item) => text(item?.gameName)).filter(Boolean)
    : []
  return [...new Set(names)].join('、') || text(row?.game)
}

function anomalyId(rule, type, id, suffix = '') {
  return [rule, type || 'global', text(id) || 'unknown', text(suffix)].filter(Boolean).join(':')
}

function statusFor(id, statusMap) {
  return statusMap?.[id] || 'pending'
}

function billTarget(type) {
  return type === 'rd' ? 'recon-rd' : 'recon-channel'
}

function addBillAnomaly(out, statusMap, {
  rule,
  type,
  row,
  suffix = '',
  severity,
  category,
  title,
  detail,
  amount = null,
  targetView = null
}) {
  const id = anomalyId(rule, type, row?.id, suffix)
  out.push({
    id,
    severity,
    category,
    title,
    detail,
    amount,
    billType: type,
    billId: text(row?.id),
    billNumber: billNumber(type, row),
    partnerName: billPartner(type, row),
    settlementMonth: billPrimaryPeriod(type, row),
    gameName: billGameLabel(type, row),
    targetView: targetView || billTarget(type),
    status: statusFor(id, statusMap)
  })
}

function addStandaloneAnomaly(out, statusMap, anomaly) {
  const id = anomaly.id
  out.push({ ...anomaly, status: statusFor(id, statusMap) })
}

function buildInvoiceMap(items) {
  if (!Array.isArray(items)) return null
  return new Map(
    items.map((item) => [`${item.bill_type}:${String(item.bill_id)}`, item])
  )
}

function buildContractMaps(contracts) {
  if (!Array.isArray(contracts)) return null
  const byPartnerId = new Map()
  const byName = new Map()
  for (const contract of contracts) {
    const partnerId = text(contract?.partner_id)
    if (partnerId) {
      const list = byPartnerId.get(partnerId) || []
      list.push(contract)
      byPartnerId.set(partnerId, list)
    }
    const names = [contract?.partner_name, contract?.counterparty]
      .map(normalizeCompany)
      .filter(Boolean)
    for (const name of names) {
      const list = byName.get(name) || []
      list.push(contract)
      byName.set(name, list)
    }
  }
  return { byPartnerId, byName }
}

function matchingContracts(type, row, contractMaps) {
  if (!contractMaps) return null
  const partnerId = billPartnerId(type, row)
  if (partnerId && contractMaps.byPartnerId.has(partnerId)) {
    return contractMaps.byPartnerId.get(partnerId)
  }
  const name = normalizeCompany(billPartner(type, row))
  return name ? contractMaps.byName.get(name) || [] : []
}

function checkBill(out, statusMap, type, row, context) {
  if (!row || !text(row.id) || isClosedBill(row)) return
  const amount = billSettlementAmount(row)
  const paid = billPaidAmount(type, row)
  const remaining = Math.max(0, amount - paid)
  const status = billStatus(row)

  if (paid > amount + 0.01 && amount > 0) {
    addBillAnomaly(out, statusMap, {
      rule: 'payment-over',
      type,
      row,
      severity: 'critical',
      category: 'payment',
      title: type === 'rd' ? '付款金额超过应付金额' : '收款金额超过应收金额',
      detail: `账单金额 ¥${amount.toFixed(2)}，已${type === 'rd' ? '付' : '收'} ¥${paid.toFixed(2)}，超出 ¥${(paid - amount).toFixed(2)}。`,
      amount: paid - amount
    })
  }

  if (FINAL_STATUSES.has(status) && remaining > 0.01) {
    addBillAnomaly(out, statusMap, {
      rule: 'final-but-unpaid',
      type,
      row,
      severity: 'critical',
      category: 'payment',
      title: '账单已完成但仍有未结金额',
      detail: `当前状态为 ${status}，账单金额 ¥${amount.toFixed(2)}，仍有 ¥${remaining.toFixed(2)} 未${type === 'rd' ? '付款' : '收款'}。`,
      amount: remaining
    })
  }

  const overview = context.invoiceMap?.get(`${type}:${String(row.id)}`)
  if (overview) {
    if (overview.coverage_status === 'over') {
      addBillAnomaly(out, statusMap, {
        rule: 'invoice-over',
        type,
        row,
        severity: 'critical',
        category: 'invoice',
        title: '发票分配金额超过账单金额',
        detail: `账单 ¥${number(overview.bill_amount).toFixed(2)}，已分配发票 ¥${number(overview.allocated_amount).toFixed(2)}。`,
        amount: Math.max(0, number(overview.allocated_amount) - number(overview.bill_amount)),
        targetView: type === 'rd' ? 'invoice-input' : 'invoice-manage'
      })
    } else if (INVOICE_EXPECTED_STATUSES.has(status) && overview.coverage_status === 'none' && amount > 0.01) {
      addBillAnomaly(out, statusMap, {
        rule: 'invoice-none',
        type,
        row,
        severity: 'warning',
        category: 'invoice',
        title: '账单尚未关联合格发票',
        detail: `账单已进入 ${status} 阶段，但发票覆盖仍为 0%。`,
        amount,
        targetView: type === 'rd' ? 'invoice-input' : 'invoice-manage'
      })
    } else if (INVOICE_EXPECTED_STATUSES.has(status) && overview.coverage_status === 'partial') {
      addBillAnomaly(out, statusMap, {
        rule: 'invoice-partial',
        type,
        row,
        severity: 'warning',
        category: 'invoice',
        title: '发票尚未覆盖完整账单',
        detail: `当前覆盖 ${number(overview.coverage_percent).toFixed(1)}%，仍差 ¥${number(overview.remaining_amount).toFixed(2)}。`,
        amount: number(overview.remaining_amount),
        targetView: type === 'rd' ? 'invoice-input' : 'invoice-manage'
      })
    }
  }

  if (!billNumber(type, row)) {
    addBillAnomaly(out, statusMap, {
      rule: 'missing-number',
      type,
      row,
      severity: 'info',
      category: 'quality',
      title: '账单缺少编号',
      detail: '该记录没有可追踪的账单编号，建议补齐后再进入正式结算。'
    })
  }

  if (!billPartner(type, row)) {
    addBillAnomaly(out, statusMap, {
      rule: 'missing-partner',
      type,
      row,
      severity: 'warning',
      category: 'quality',
      title: '账单缺少合作方',
      detail: '无法确认往来单位，也会影响合同与发票自动匹配。'
    })
  }

  if (billPeriods(type, row).length === 0) {
    addBillAnomaly(out, statusMap, {
      rule: 'missing-period',
      type,
      row,
      severity: 'warning',
      category: 'quality',
      title: '账单缺少结算月份',
      detail: '该账单没有可识别的结算月份，月度统计和流水核对可能不准确。'
    })
  }

  if (type === 'rd' && context.quickSdkMonths) {
    const meaningfulFlow = Math.abs(number(row?.gameFlow)) > 0.01 ||
      (Array.isArray(row?.items) && row.items.some((item) => Math.abs(number(item?.revenue)) > 0.01))
    if (meaningfulFlow) {
      for (const period of billPeriods(type, row)) {
        if (!context.quickSdkMonths.has(period)) {
          addBillAnomaly(out, statusMap, {
            rule: 'quicksdk-month-missing',
            type,
            row,
            suffix: period,
            severity: 'warning',
            category: 'data',
            title: '账单月份缺少 QuickSDK 流水数据',
            detail: `${period} 在数据库月度数据中不存在，建议先确认是否漏导入流水。`,
            targetView: 'quicksdk-library'
          })
        }
      }
    }
  }

  const contracts = matchingContracts(type, row, context.contractMaps)
  if (Array.isArray(contracts) && billPartner(type, row)) {
    if (contracts.length === 0 && INVOICE_EXPECTED_STATUSES.has(status)) {
      addBillAnomaly(out, statusMap, {
        rule: 'contract-unlinked',
        type,
        row,
        severity: 'info',
        category: 'contract',
        title: '正式账单未匹配到关联合同',
        detail: '合作方已有正式结算记录，但合同中心没有找到关联记录。',
        targetView: 'contracts'
      })
    } else if (contracts.length > 0) {
      const active = contracts.some((contract) => contract?.timeline_status === '生效中')
      const expired = contracts.some((contract) => contract?.timeline_status === '已过期')
      if (!active && expired) {
        addBillAnomaly(out, statusMap, {
          rule: 'contract-expired',
          type,
          row,
          severity: 'warning',
          category: 'contract',
          title: '账单合作方没有生效中的合同',
          detail: '当前能匹配到的合同已过期，请确认续约或补充新合同。',
          targetView: 'contracts'
        })
      }
    }
  }
}

function duplicateBillNumberAnomalies(out, statusMap, type, rows) {
  const groups = new Map()
  for (const row of rows || []) {
    if (!row || isClosedBill(row)) continue
    const numberText = billNumber(type, row).toLowerCase()
    if (!numberText) continue
    const group = groups.get(numberText) || []
    group.push(row)
    groups.set(numberText, group)
  }

  for (const [numberText, group] of groups.entries()) {
    if (group.length < 2) continue
    const first = group[0]
    const id = anomalyId('duplicate-number', type, numberText)
    addStandaloneAnomaly(out, statusMap, {
      id,
      severity: 'critical',
      category: 'duplicate',
      title: '发现重复账单编号',
      detail: `编号 ${billNumber(type, first)} 同时出现在 ${group.length} 条${type === 'rd' ? '研发' : '渠道'}账单中。`,
      amount: null,
      billType: type,
      billId: text(first?.id),
      billNumber: billNumber(type, first),
      partnerName: billPartner(type, first),
      settlementMonth: billPrimaryPeriod(type, first),
      gameName: billGameLabel(type, first),
      targetView: billTarget(type),
      relatedBillIds: group.map((row) => text(row?.id)).filter(Boolean)
    })
  }
}

function contractStandaloneAnomalies(out, statusMap, contracts) {
  if (!Array.isArray(contracts)) return
  for (const contract of contracts) {
    const contractId = text(contract?.id)
    if (!contractId) continue
    if (contract?.contract_no_duplicate) {
      const id = anomalyId('contract-number-duplicate', 'contract', contractId)
      addStandaloneAnomaly(out, statusMap, {
        id,
        severity: 'critical',
        category: 'contract',
        title: '合同编号重复',
        detail: `合同 ${text(contract?.contract_name) || contractId} 的编号 ${text(contract?.contract_no) || '-'} 存在重复。`,
        amount: null,
        billType: null,
        billId: '',
        billNumber: text(contract?.contract_no),
        partnerName: text(contract?.partner_short_name || contract?.partner_name || contract?.counterparty),
        settlementMonth: '',
        gameName: '',
        targetView: 'contracts',
        contractId
      })
    }
    if (contract?.timeline_status === '即将到期') {
      const id = anomalyId('contract-expiring', 'contract', contractId)
      addStandaloneAnomaly(out, statusMap, {
        id,
        severity: 'info',
        category: 'contract',
        title: '合同即将到期',
        detail: `${text(contract?.contract_name) || '合同'} 将于 ${text(contract?.end_date) || '近期'} 到期。`,
        amount: null,
        billType: null,
        billId: '',
        billNumber: text(contract?.contract_no),
        partnerName: text(contract?.partner_short_name || contract?.partner_name || contract?.counterparty),
        settlementMonth: '',
        gameName: '',
        targetView: 'contracts',
        contractId
      })
    }
  }
}

export function buildReconciliationAnomalies({
  rdRecords = [],
  channelRecords = [],
  invoiceOverviews = null,
  contracts = null,
  quickSdkMonthly = null,
  statusMap = {}
} = {}) {
  const invoiceMap = buildInvoiceMap(invoiceOverviews)
  const contractMaps = buildContractMaps(contracts)
  const quickSdkMonths = Array.isArray(quickSdkMonthly)
    ? new Set(quickSdkMonthly.map((item) => normalizeMonthKey(item?.settlement_month)).filter(Boolean))
    : null
  const context = { invoiceMap, contractMaps, quickSdkMonths }
  const out = []

  for (const row of rdRecords || []) checkBill(out, statusMap, 'rd', row, context)
  for (const row of channelRecords || []) checkBill(out, statusMap, 'channel', row, context)
  duplicateBillNumberAnomalies(out, statusMap, 'rd', rdRecords)
  duplicateBillNumberAnomalies(out, statusMap, 'channel', channelRecords)
  contractStandaloneAnomalies(out, statusMap, contracts)

  return out.sort((left, right) => {
    const severityDiff = ANOMALY_SEVERITY_ORDER[left.severity] - ANOMALY_SEVERITY_ORDER[right.severity]
    if (severityDiff) return severityDiff
    if (left.status !== right.status) return left.status === 'pending' ? -1 : 1
    return `${left.settlementMonth || ''}${left.billNumber || ''}`.localeCompare(
      `${right.settlementMonth || ''}${right.billNumber || ''}`,
      'zh-CN'
    )
  })
}

export function summarizeAnomalies(items = []) {
  return (items || []).reduce(
    (acc, item) => {
      acc.total += 1
      acc[item.status === 'pending' ? 'pending' : item.status] += 1
      if (item.status === 'pending') acc[item.severity] += 1
      return acc
    },
    {
      total: 0,
      pending: 0,
      critical: 0,
      warning: 0,
      info: 0,
      ignored: 0,
      resolved: 0
    }
  )
}
