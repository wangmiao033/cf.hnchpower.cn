/**
 * Client-side preflight before allowing an explicitly approved small-variance
 * accounting confirmation. Backend performs its own independent audit check.
 */
export const MAX_SMALL_VARIANCE_CENTS = 50

const FINANCIAL_CHECKS = new Set([
  'share_rate', 'channel_fee_rate', 'tax_rate',
  'testing_fee', 'contract_standard_settlement'
])

function cents(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null
}

function varianceCents(line) {
  const amount = line?.contract_amount || {}
  const actual = cents(amount.actual_amount)
  const expected = cents(amount.expected_amount)
  if (actual !== null && expected !== null) return Math.abs(actual - expected)
  const explicit = cents(amount.variance_abs)
  return explicit === null ? null : Math.abs(explicit)
}

export function assessChannelSmallVariancePreflight(preflight) {
  const empty = { error: '', affectedLineIds: [], totalCents: 0 }
  if (!preflight || !Array.isArray(preflight.lines)) {
    return { ...empty, error: '合同核对服务尚未返回完整数据，请稍后重试，不能强制确认' }
  }

  if ((preflight.bill_checks || []).some(check => check?.status === 'fail')) {
    return { ...empty, error: '存在账单级合同核验失败，不属于可强制确认的小额金额误差' }
  }

  const failedLines = preflight.lines.filter(line => (
    line.status === 'fail' ||
    line.contract_amount?.status === 'fail' ||
    (line.checks || []).some(check => check?.status === 'fail')
  ))
  const affectedLineIds = []
  let totalCents = 0
  for (const line of failedLines) {
    const hard = (line.checks || []).find(check =>
      check.status === 'fail' && !FINANCIAL_CHECKS.has(check.key)
    )
    if (hard) {
      return {
        ...empty,
        error: (line.game_name || '游戏') + '存在不可豁免的合同核验失败（' +
          (hard.label || hard.key || '未知原因') + '），不能强制确认'
      }
    }

    const diff = varianceCents(line)
    if (diff === null || diff > MAX_SMALL_VARIANCE_CENTS) {
      return { ...empty, error: '合同金额差异无法核实或超过0.50元，请走常规差异处理' }
    }
    totalCents += diff
    if (totalCents > MAX_SMALL_VARIANCE_CENTS) {
      return { ...empty, error: '本期多项合同差异合计超过0.50元，不能使用小额强制确认' }
    }
    const id = String(line.line_id || '')
    if (!id) return { ...empty, error: '合同差异缺少游戏明细编号，无法安全关联确认记录' }
    affectedLineIds.push(id)
  }
  return { error: '', affectedLineIds: [...new Set(affectedLineIds)], totalCents }
}
