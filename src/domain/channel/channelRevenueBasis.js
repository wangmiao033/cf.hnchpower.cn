/** Monetary input basis is independent of the game's commercial discount/version. */
export const PRE_DISCOUNT = 'pre_discount'
export const POST_DISCOUNT = 'post_discount'
export function isAiquChannel(header = {}) {
  return ['爱趣', '爱趣（爱趣聚合）'].includes(String(header.channelName || '').trim())
    && String(header.partnerName || '').trim() === '昆山爱趣网络科技有限公司'
}
export function resolveRevenueBasis(row = {}) {
  const basis = row.revenueBasis ?? PRE_DISCOUNT
  if (![PRE_DISCOUNT, POST_DISCOUNT].includes(basis)) throw new Error('未知流水口径，请重新选择')
  return basis
}
export function validateRevenueBasis(row, header) {
  const basis = resolveRevenueBasis(row)
  if (basis === POST_DISCOUNT && !isAiquChannel(header)) throw new Error('已折后流水口径仅适用于爱趣及其指定合作主体')
  if (basis === POST_DISCOUNT && [row.settlementRuleCode, header?.settlementRuleCode].some((code) => ['anjiu_pre_discount_deduction', 'xian_weizhen_9917', 'honor_upfront_percent_fee'].includes(code))) throw new Error('爱趣流水口径不能混用其他渠道专属规则')
  return basis
}
export function revenueMultiplier(row = {}) {
  if (resolveRevenueBasis(row) === POST_DISCOUNT) return 1
  const factor = Number(row.discountFactor ?? 1)
  return Number.isFinite(factor) && factor > 0 ? factor : 1
}
const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
export function previewRevenueBasisChange(row, nextBasis, header) {
  const changed = { ...row, revenueBasis: nextBasis }
  validateRevenueBasis(changed, header)
  return {
    fromBasis: resolveRevenueBasis(row), toBasis: nextBasis,
    inputFlow: Number(row.flow || 0), discountFactor: Number(row.discountFactor ?? 1),
    beforeEffectiveFlow: money(Number(row.flow || 0) * revenueMultiplier(row)),
    afterEffectiveFlow: money(Number(row.flow || 0) * revenueMultiplier(changed)),
    requiresVoucherReview: Number(row.voucherFaceValue || 0) !== 0,
    preservesInput: true
  }
}
export function applyRevenueBasisChange(row, nextBasis, header) {
  previewRevenueBasisChange(row, nextBasis, header)
  return { ...row, revenueBasis: nextBasis }
}
