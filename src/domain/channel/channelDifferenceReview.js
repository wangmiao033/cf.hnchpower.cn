/**
 * Explain channel/platform reconciliation gaps without changing payment totals.
 * A platform amount entered on each line is already used by the settlement engine.
 */
const NOTE_MARKER = '【渠道差异核对】'

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function hasPlatformAmount(value) {
  return value !== null && value !== undefined && String(value).trim() !== '' &&
    Number.isFinite(Number(value))
}

function monthText(value) {
  const matched = String(value || '').match(/^(20\d{2})-(\d{2})$/)
  return matched ? `${matched[1]}年${Number(matched[2])}月` : String(value || '未指定账期')
}

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`
}

export function describeChannelDifference(record = {}) {
  const items = (Array.isArray(record.items) ? record.items : [])
    .filter((row) => String(row.gameName || '').trim())
  const supplied = items.filter((row) => hasPlatformAmount(row.platformSettlementAmount))
  const system = roundMoney(record.systemSettlementAmount || 0)
  const platform = supplied.length ? roundMoney(record.platformSettlementAmount || 0) : null
  const delta = platform == null ? null : roundMoney(platform - system)
  const base = { system, platform, delta, absoluteDifference: Math.abs(delta || 0), games: [], complete: false }

  if (!supplied.length) return { ...base, kind: 'unvalidated' }
  if (supplied.length < items.length) return { ...base, kind: 'partial' }

  const tolerance = Math.max(0, Number(record.validationTolerance ?? 0.05) || 0)
  const divergent = items.filter((row) => row.validationStatus === 'fail' ||
    Math.abs(Number(row.systemSettlementAmount || 0) - Number(row.platformSettlementAmount || 0)) >
      Math.max(0, Number(row.validationTolerance ?? tolerance) || 0))
  const complete = { ...base, complete: true, games: divergent.map((row) => row.gameName) }
  if (Math.abs(delta) <= tolerance && !divergent.length) return { ...complete, kind: 'matched' }
  if (Math.abs(delta) <= tolerance) return { ...complete, kind: 'offsetting' }
  return { ...complete, kind: delta > 0 ? 'higher' : 'lower' }
}

export function channelDifferenceLabel(review) {
  if (review.kind === 'higher') return `渠道比系统多结 ${money(review.absoluteDifference)}`
  if (review.kind === 'lower') return `渠道比系统少结 ${money(review.absoluteDifference)}`
  if (review.kind === 'offsetting') return '明细金额存在差异，合计相互抵消'
  if (review.kind === 'partial') return '部分游戏尚未录入平台结算金额'
  if (review.kind === 'matched') return '系统与渠道金额一致'
  return '尚未录入渠道结算金额'
}

export function potentialDoubleAdjustment(review, adjustmentAmount) {
  if (!review.complete || !['higher', 'lower'].includes(review.kind)) return false
  const amount = Number(adjustmentAmount || 0)
  return Math.abs(amount) >= 0.005 && Math.abs(amount - review.delta) < 0.005
}

export function createChannelDifferenceNote(record, review, { status = 'pending', reason = '' } = {}) {
  if (!review.complete || !['higher', 'lower', 'offsetting'].includes(review.kind)) {
    throw new Error('只有录齐平台结算金额并存在差异时才能记录核对说明')
  }
  const detail = String(reason || '').trim()
  if (status === 'platform_confirmed' && !detail) {
    throw new Error('标记为渠道金额已确认时，请填写核对依据')
  }
  const reviewStatus = status === 'platform_confirmed' ? '渠道金额已核实' : '待核实'
  const gameNames = review.games.length ? `；差异游戏：${review.games.join('、')}` : ''
  const explanation = detail || '待渠道提供订单明细并核对'
  return `${NOTE_MARKER}${monthText(record.settlementMonth)}：系统核算${money(review.system)}，渠道账单${money(review.platform)}；${channelDifferenceLabel(review)}${gameNames}；处理状态：${reviewStatus}；核对依据：${explanation}。本条仅记录差异，不额外调整金额；平台金额已包含在明细业务结算中。`
}

export function upsertChannelDifferenceNote(remark, note) {
  if (!String(note || '').startsWith(NOTE_MARKER)) {
    throw new Error('差异说明必须带标准标记')
  }
  const otherLines = String(remark || '').split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(NOTE_MARKER))
  return [...otherLines.filter((line, index) => line.trim() || index < otherLines.length - 1), note]
    .join('\n').trim()
}

export const CHANNEL_DIFFERENCE_NOTE_MARKER = NOTE_MARKER
