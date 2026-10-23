export const INCOMPLETE_233 = 'channel_233_incomplete'
export const LEGAL_NAME_233 = '北京龙威互动科技有限公司'
export const INCOMPLETE_233_NOTE = '233内购资料未齐：原始充值、分成比例及税费依据待补；0仅系统占位。平台结算按原单录入，保持待核对、未收款，不计入已核对累计池。'
export const INCOMPLETE_233_BLOCK = '233资料未齐，请先补齐原始充值、分成及税费依据并保存，再确认核对。'

export function is233Customer(record) {
  return String(record?.partnerName || '').trim() === LEGAL_NAME_233 && String(record?.channelName || '').trim() === '龙威233'
}

export function is233Incomplete(record, parent) {
  return record?.settlementRuleCode === INCOMPLETE_233 || parent?.settlementRuleCode === INCOMPLETE_233
}

export function incomplete233Fields() {
  return { settlementRuleCode: INCOMPLETE_233, channelFeeMode: 'none', channelFeeRate: '', taxMode: 'none' }
}

export function incomplete233Line(line) {
  return { ...line, ...incomplete233Fields(), flow: '', shareRate: '', taxRate: '', contractAccessItemId: null }
}

export function incomplete233Validation(header, lines, intent = 'back') {
  if (!is233Incomplete(header) && !header.completeIncompleteDraft) return ''
  if (intent === 'confirm') return INCOMPLETE_233_BLOCK
  if (!is233Customer(header)) return '资料未齐暂存仅限北京龙威互动科技有限公司的233内购账单'
  if (is233Incomplete(header)) {
    if (new Set(lines.map(row => row.settlementCycle)).size !== 1) return '233暂存请按真实结算月份逐月保存'
    if (lines.some(row => row.contractAccessItemId)) return '资料未齐暂存不能绑定合同清单'
  } else if (!String(header.incompleteCompletionReason || '').trim()) {
    return '请填写补齐资料的来源说明'
  }
  if (header.completeIncompleteDraft && !header.settlementRuleCode) return '请选择补齐后的结算规则'
  for (const [index, row] of lines.entries()) {
    const keys = is233Incomplete(header) ? ['platformSettlementAmount'] : ['flow', 'shareRate', 'taxRate', 'platformSettlementAmount']
    if (header.completeIncompleteDraft && header.channelFeeMode === 'fixed') keys.push('gatewayCost')
    if (header.completeIncompleteDraft && header.channelFeeMode === 'percent' && (header.channelFeeRate === '' || header.channelFeeRate == null)) return '请明确填写正常结算规则的通道费率'
    if (keys.some(key => row[key] == null || String(row[key]).trim() === '' || !Number.isFinite(Number(row[key])))) {
      return `第 ${index + 1} 行：${is233Incomplete(header) ? '请填写真实平台结算，允许负退款' : '请明确填写原始充值、分成、税率、适用通道费及平台结算，不能沿用未知占位'}`
    }
  }
  return ''
}

export function is233UnknownField(record, key, parent) {
  return is233Incomplete(record, parent) && ['flow', 'effectiveFlow', 'billingAmount', 'shareRate', 'shareAmount', 'taxRate', 'systemSettlementAmount', 'settlementDifference', 'channelFeeRate'].includes(key)
}
