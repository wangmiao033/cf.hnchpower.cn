export const SAMSUNG_STATEMENT_FEE_RULE = 'samsung_statement_fee'
export const SAMSUNG_LEGAL_NAME = '北京鹏泰博兴科技有限公司'

export function isSamsungIdentity(header = {}) {
  return String(header.partnerName || '').trim() === SAMSUNG_LEGAL_NAME
    && ['三星', '鹏泰博兴'].includes(String(header.channelName || '').trim())
}

export function isSamsungRule(row = {}, header = {}) {
  return (row?.settlementRuleCode || header?.settlementRuleCode) === SAMSUNG_STATEMENT_FEE_RULE
}

export function samsungRuleFields() {
  return { settlementRuleCode: SAMSUNG_STATEMENT_FEE_RULE, channelFeeMode: 'fixed', channelFeeRate: '4', taxMode: 'none' }
}

// A saved explicit statement rule must survive contract refresh and smart entry.
export function preserveSamsungRule(row, next, header = {}) {
  return isSamsungRule(row, header) ? { ...next, ...samsungRuleFields(), shareRate: row.shareRate, taxRate: row.taxRate, gatewayCost: row.gatewayCost } : next
}
