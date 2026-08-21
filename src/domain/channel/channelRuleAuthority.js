import { recommendChannelContractRules } from '@/lib/api/contractTerms.ts'

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

export function isSmartGeneratedMessage(message = '') {
  const text = String(message || '')
  return text.includes('已生成') || text.includes('游戏清单') || text.includes('上月账单')
}

export function clearInheritedRuleFields(line) {
  return {
    ...line,
    shareRate: '',
    taxRate: '',
    settlementRuleCode: '',
    channelFeeMode: 'none',
    channelFeeRate: '',
    taxMode: 'none',
    validationTolerance: ''
  }
}

export function sanitizeGeneratedHistoryRules(record) {
  return {
    ...(record || {}),
    items: (Array.isArray(record?.items) ? record.items : []).map((line) =>
      String(line?.gameName || '').trim() ? clearInheritedRuleFields(line) : line
    )
  }
}

export function applyContractRecommendation(record, recommendation, { generated = false } = {}) {
  const source = generated ? sanitizeGeneratedHistoryRules(record) : { ...(record || {}) }
  const recommendationLines = Array.isArray(recommendation?.lines) ? recommendation.lines : []
  let matched = 0
  let needsConfirmation = 0

  const nextItems = (Array.isArray(source?.items) ? source.items : []).map((line, index) => {
    if (!String(line?.gameName || '').trim()) return line
    const result = recommendationLines.find((item) => Number(item?.line_index) === index)
    const recommended = result?.recommended
    if (!result?.auto_apply || !recommended) {
      if (result?.match) needsConfirmation += 1
      return line
    }
    matched += 1
    return {
      ...line,
      shareRate: hasValue(recommended.share_rate) ? recommended.share_rate : '',
      taxRate: hasValue(recommended.tax_rate) ? recommended.tax_rate : '',
      settlementRuleCode: recommended.settlement_rule_code || '',
      channelFeeMode: recommended.channel_fee_mode || 'none',
      channelFeeRate: hasValue(recommended.channel_fee_rate) ? recommended.channel_fee_rate : '',
      taxMode: recommended.tax_mode || 'none',
      validationTolerance: hasValue(recommended.validation_tolerance) ? recommended.validation_tolerance : ''
    }
  })

  const total = nextItems.filter((line) => String(line?.gameName || '').trim()).length
  return {
    record: { ...source, items: nextItems },
    summary: {
      total,
      matched,
      unmatched: Math.max(0, total - matched),
      needsConfirmation,
      recommendationMessage: String(recommendation?.message || ''),
      version: String(recommendation?.version || '')
    }
  }
}

export async function resolveChannelContractAuthority(record, { generated = false } = {}) {
  const partnerName = String(record?.partnerName || '').trim()
  const channelName = String(record?.channelName || '').trim()
  const lines = (Array.isArray(record?.items) ? record.items : [])
    .map((line, originalIndex) => ({
      originalIndex,
      game_name: String(line?.gameName || '').trim(),
      settlement_cycle: String(line?.settlementCycle || record?.settlementMonth || '').trim()
    }))
    .filter((line) => line.game_name)

  if (!partnerName || !lines.length) {
    return {
      record: generated ? sanitizeGeneratedHistoryRules(record) : record,
      summary: { total: lines.length, matched: 0, unmatched: lines.length, needsConfirmation: 0, skipped: true }
    }
  }

  const recommendation = await recommendChannelContractRules({
    partner_name: partnerName,
    channel_name: channelName,
    lines: lines.map(({ game_name, settlement_cycle }) => ({ game_name, settlement_cycle }))
  })

  // The backend indexes the compact named-line array. Translate back to the record item index.
  const remapped = {
    ...recommendation,
    lines: (recommendation?.lines || []).map((item) => ({
      ...item,
      line_index: lines[Number(item?.line_index)]?.originalIndex ?? Number(item?.line_index)
    }))
  }
  return applyContractRecommendation(record, remapped, { generated })
}
