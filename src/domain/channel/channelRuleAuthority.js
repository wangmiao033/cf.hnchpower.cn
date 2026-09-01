import { recommendChannelContractRules } from '@/lib/api/contractTerms.ts'

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function normalizeGameText(value = '') {
  return String(value ?? '').normalize('NFKC').trim()
}

function compactGameText(value = '') {
  return normalizeGameText(value).replace(/[\s\u3000\-_/\\·•・—–－，,。.（）()\[\]【】{}<>《》:：;；'"“”‘’]/g, '')
}

function decimalDiscountToCompact(value = '') {
  return value.replace(/0\.(\d{1,3})折/g, (_, fraction) => `0${fraction}折`)
}

function compactDiscountToDecimal(value = '') {
  return value.replace(/(^|[^0-9.])(0\d{1,3})折/g, (full, prefix, digits) => {
    const decimal = Number(`0.${digits.slice(1)}`)
    return Number.isFinite(decimal) ? `${prefix}${decimal}折` : full
  })
}

function buildGameNameAliases(value = '') {
  const original = normalizeGameText(value)
  if (!original) return []

  const candidates = [
    original,
    compactGameText(original),
    decimalDiscountToCompact(original),
    compactDiscountToDecimal(original),
    decimalDiscountToCompact(compactGameText(original)),
    compactDiscountToDecimal(compactGameText(original))
  ]

  return Array.from(new Set(candidates.map((item) => normalizeGameText(item)).filter(Boolean)))
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

async function retryUnmatchedGameAliases({ partnerName, channelName, lines, recommendation }) {
  const initialLines = Array.isArray(recommendation?.lines) ? recommendation.lines : []
  const initialByIndex = new Map(initialLines.map((item) => [Number(item?.line_index), item]))
  const retryRows = []

  lines.forEach((line, lineIndex) => {
    const current = initialByIndex.get(lineIndex)
    if (current?.auto_apply && current?.recommended) return

    const aliases = buildGameNameAliases(line.game_name)
    aliases.slice(1).forEach((alias) => {
      retryRows.push({
        originalLineIndex: lineIndex,
        game_name: alias,
        settlement_cycle: line.settlement_cycle
      })
    })
  })

  if (!retryRows.length) return recommendation

  try {
    const retryRecommendation = await recommendChannelContractRules({
      partner_name: partnerName,
      channel_name: channelName,
      lines: retryRows.map(({ game_name, settlement_cycle }) => ({ game_name, settlement_cycle }))
    })

    const replacements = new Map()
    ;(retryRecommendation?.lines || []).forEach((result) => {
      const retryRow = retryRows[Number(result?.line_index)]
      if (!retryRow || !result?.auto_apply || !result?.recommended) return

      const existing = replacements.get(retryRow.originalLineIndex)
      if (existing && Number(existing?.score || 0) >= Number(result?.score || 0)) return
      replacements.set(retryRow.originalLineIndex, result)
    })

    if (!replacements.size) return recommendation

    const mergedLines = initialLines.filter((item) => !replacements.has(Number(item?.line_index)))
    replacements.forEach((result, originalLineIndex) => {
      mergedLines.push({
        ...result,
        line_index: originalLineIndex,
        game_name: lines[originalLineIndex]?.game_name || result?.game_name || '',
        message: `${String(result?.message || '已匹配合作规则')}（已兼容游戏名称格式）`
      })
    })

    return {
      ...recommendation,
      matched_lines: lines.filter((_, index) => {
        const result = mergedLines.find((item) => Number(item?.line_index) === index)
        return Boolean(result?.auto_apply && result?.recommended)
      }).length,
      lines: mergedLines
    }
  } catch (error) {
    console.warn('渠道合作规则别名重试失败，保留原匹配结果', error)
    return recommendation
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

  const initialRecommendation = await recommendChannelContractRules({
    partner_name: partnerName,
    channel_name: channelName,
    lines: lines.map(({ game_name, settlement_cycle }) => ({ game_name, settlement_cycle }))
  })

  const recommendation = await retryUnmatchedGameAliases({
    partnerName,
    channelName,
    lines,
    recommendation: initialRecommendation
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
