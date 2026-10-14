/** Client-side *advisory* eligibility for a saved platform penny variance.
 * Backend will independently recompute all line amounts under a row lock.
 */
const cents = (value) => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

export function assessSavedChannelPlatformVariance(row) {
  const fail = (error = '') => ({
    eligible: false, error, systemAmount: 0, platformAmount: 0,
    settlementAmount: 0, differenceCents: 0, lineIds: []
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
  if (totalAbsCents <= 0 || totalAbsCents > 50 || Math.abs(system - platform) > 50) {
    return fail('逐游戏平台差异合计不属于¥0.50以内尾差')
  }
  return {
    eligible: true, error: '',
    systemAmount: system / 100,
    platformAmount: platform / 100,
    settlementAmount: settlement / 100,
    differenceCents: system - platform,
    lineIds: lineIds.sort()
  }
}
