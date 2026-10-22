export const HONOR_OFFICIAL_STATEMENT_POLICY = 'honor_official_statement_v1'
export const SINGLE_BILL_MANUAL_EXCEPTION = '4399_july_2026_single_bill_v1'

export function isSingleBillManualReviewCandidate(row) {
  return row?.statement_no === 'QD-20261015-041F2B'
    && row?.partner_name === '四三九九网络股份有限公司' && row?.channel_name === '4399'
    && row?.settlement_month === '2026-07'
}

/** Client-side *advisory* eligibility for a saved platform discrepancy.
 * Backend will independently recompute all line amounts under a row lock.
 */
const cents = (value) => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

function assess(row, allowDocumented = false, policy = null) {
  const official = allowDocumented && policy?.code === HONOR_OFFICIAL_STATEMENT_POLICY
    && Boolean(policy.partner_id) && row?.partner_name === '荣耀'
    && (!row?.channel_name || row.channel_name === '荣耀')
  const fail = (error = '') => ({
    eligible: false, error, systemAmount: 0, platformAmount: 0,
    settlementAmount: 0, differenceCents: 0, lineIds: [],
    reviewKind: '', absoluteLineDifferenceCents: 0
  })
  if (row?.status !== 'pending' || row?.validation_status !== 'fail') {
    return fail('不是待核对的平台金额差异账单')
  }
  const system = cents(row.system_settlement_amount)
  const platform = cents(row.platform_settlement_amount)
  const settlement = cents(row.settlement_amount)
  if (system === null || platform === null || settlement === null || platform !== settlement || settlement < 0) {
    return fail('账单最终金额与平台结算金额不一致')
  }
  if (cents(row.settlement_adjustment_amount || 0) !== 0 || row.settlement_final_override != null) {
    return fail('本单存在独立的结算调整，应单独核对')
  }
  const items = Array.isArray(row.items) ? row.items : []
  if (!items.length || items.length > 100) return fail('逐游戏明细缺失')
  const lineIds = []
  let totalAbsCents = 0
  let lineSystem = 0
  let linePlatform = 0
  for (const item of items) {
    const a = cents(item.system_settlement_amount)
    const b = cents(item.platform_settlement_amount)
    if (!String(item.id || '').trim() || a === null || b === null) {
      return fail('存在无法核对的游戏金额或明细编号')
    }
    totalAbsCents += Math.abs(a - b)
    lineSystem += a
    linePlatform += b
    lineIds.push(String(item.id))
  }
  if (linePlatform !== platform || lineSystem !== system || new Set(lineIds).size !== lineIds.length) {
    return fail('逐游戏金额与账单合计不一致')
  }
  if (totalAbsCents <= 0 || (system === platform && !official)) {
    return fail('系统与平台不存在待核对差异')
  }
  if (allowDocumented && !official && totalAbsCents > 50 && totalAbsCents - Math.abs(system - platform) > 2) {
    return fail('游戏明细存在相互抵消的较大差异，请逐行核对原始平台明细')
  }
  if (!allowDocumented && (totalAbsCents > 50 || Math.abs(system - platform) > 50)) {
    return fail('逐游戏平台差异合计不属于¥0.50以内尾差')
  }
  return {
    eligible: true, error: '',
    reviewKind: official || totalAbsCents > 50 || Math.abs(system - platform) > 50 ? 'documented' : 'small',
    ...(official ? { policyCode: policy.code, partnerId: policy.partner_id, officialLines: items.map(item => ({
      line_id: String(item.id), game_name: String(item.game_name || ''), settlement_cycle: String(item.settlement_cycle || ''),
      system_amount: Number(item.system_settlement_amount), platform_amount: Number(item.platform_settlement_amount)
    })) } : {}),
    absoluteLineDifferenceCents: totalAbsCents,
    systemAmount: system / 100,
    platformAmount: platform / 100,
    settlementAmount: settlement / 100,
    differenceCents: system - platform,
    lineIds: lineIds.sort()
  }
}


/** Keep the legacy tiny-tail evaluator restrictive. */
export function assessSavedChannelPlatformVariance(row) {
  return assess(row, false)
}

/** Substantive discrepancies require attachments unless the server grants the exact single-bill exception. */
export function assessSavedChannelPlatformDifference(row, policy = null, manualException = null) {
  const review = assess(row, true, policy)
  // Advisory only: the server independently checks the exact bill, customer,
  // amounts and complete original-field revision under locks on confirmation.
  if (review.eligible && isSingleBillManualReviewCandidate(row)
    && manualException?.code === SINGLE_BILL_MANUAL_EXCEPTION
    && manualException.bill_id === String(row.id)
    && manualException.statement_no === row.statement_no
    && manualException.settlement_month === row.settlement_month
    && manualException.partner_name === row.partner_name && manualException.partner_id
    && /^[a-f0-9]{64}$/.test(manualException.review_revision || '')
    && review.systemAmount === 135.85 && review.platformAmount === 144.4
    && review.settlementAmount === 144.4 && review.differenceCents === -855
    && row.items.every(line => line.settlement_cycle === '2026-07')) {
    return { ...review, manualException }
  }
  return review
}


/**
 * A real administrator's explicit confirmation can use a complete audit note
 * derived from the already-saved amounts and selected source document.
 * No invented coupon/fee corrections, no automatic confirmation.
 */
export function buildChannelPlatformApprovalNote(review, optionalNote = '', evidenceFilename = '') {
  if (!review) return ''
  const validMoney = value => {
    const n = Number(value)
    return Number.isFinite(n) ? n.toFixed(2) : '0.00'
  }
  const source = review.manualException?.code === SINGLE_BILL_MANUAL_EXCEPTION
    ? '本单经授权以真实文字依据人工核对（单笔免附件例外）'
    : review.reviewKind === 'documented'
    ? '已按所选平台原始结算凭证' + (evidenceFilename ? '《' + String(evidenceFilename).slice(0, 85) + '》' : '')
    : '已核对渠道平台账单'
  const base = `管理员在已保存账单上执行人工确认：${source}，同意本期按平台实际结算¥${validMoney(review.platformAmount)}入账；系统原计算¥${validMoney(review.systemAmount)}，系统与平台差额¥${validMoney(Math.abs(Number(review.differenceCents || 0) / 100))}保留备查。原合同、分成、流水及实际收款不作修改。`
  const supplement = String(optionalNote || '').trim()
  return (base + (supplement ? ' 补充说明：' + supplement : '')).slice(0, 500)
}
