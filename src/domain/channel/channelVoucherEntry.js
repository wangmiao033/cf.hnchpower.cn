/** Presentation-only adapter. Money/rule math stays in channelBillingForm and backend. */
import {
  ANJIU_PRE_DISCOUNT_DEDUCTION_RULE,
  XIAN_WEIZHEN_9917_RULE,
  resolveDiscountFactor
} from './channelBillingForm.js'

const nonzero = (v) => Number.isFinite(Number(v)) && Math.abs(Number(v)) > 0.000001
const asText = (v) => v == null || String(v).trim() === '' ? '0' : String(v)
const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100

/**
 * Historical records have two NULL columns. Never infer that their old
 * voucher_cost should be multiplied by the game discount a second time.
 * Both populated nonzero columns remain in the expanded two-input mode.
 */
export function getVoucherEntry(row = {}) {
  const face = row.voucherFaceValue
  const direct = row.voucherDirectCost
  if (face == null && direct == null) {
    const amount = asText(row.voucherCost)
    return { mode: nonzero(amount) ? 'legacy' : 'discount', amount, isLegacy: true }
  }
  if (nonzero(face) && nonzero(direct)) {
    return { mode: 'both', amount: '', isLegacy: false }
  }
  if (nonzero(direct) || (direct != null && face == null)) {
    return { mode: 'direct', amount: asText(direct), isLegacy: false }
  }
  return { mode: 'discount', amount: asText(face), isLegacy: false }
}

/** Reuse the ONE on-screen amount, changing only which persisted field it uses. */
export function setVoucherEntryMode(row = {}, mode, rule = {}) {
  if (!['discount', 'direct', 'both'].includes(mode)) return row
  const view = getVoucherEntry(row)
  if (mode === 'both') {
    if (view.isLegacy) {
      const isPreDiscount = rule.settlementRuleCode === ANJIU_PRE_DISCOUNT_DEDUCTION_RULE
      return {
        ...row,
        voucherFaceValue: isPreDiscount ? view.amount : '0',
        voucherDirectCost: isPreDiscount ? '0' : view.amount
      }
    }
    return { ...row, voucherFaceValue: asText(row.voucherFaceValue), voucherDirectCost: asText(row.voucherDirectCost) }
  }
  if (!view.isLegacy && view.mode === mode) return row
  const amount = view.mode === 'both'
    ? asText(mode === 'discount' ? row.voucherFaceValue : row.voucherDirectCost)
    : view.amount
  return {
    ...row,
    voucherFaceValue: mode === 'discount' ? amount : null,
    voucherDirectCost: mode === 'direct' ? amount : null
  }
}

/** An unconverted legacy row retains its old voucher_cost formula on edit. */
export function setVoucherEntryAmount(row = {}, value) {
  const view = getVoucherEntry(row)
  if (view.mode === 'legacy') return { ...row, voucherCost: value }
  if (view.mode === 'direct') return { ...row, voucherFaceValue: null, voucherDirectCost: value }
  if (view.mode === 'discount') return { ...row, voucherFaceValue: value, voucherDirectCost: null }
  // "both" is edited with the two explicit persisted fields.
  return row
}

/** Amount shown below each field; the back end is still the settlement authority. */
export function getVoucherEntryPreview(row = {}, rule = {}) {
  const mode = getVoucherEntry(row)
  if (rule.settlementRuleCode === XIAN_WEIZHEN_9917_RULE) {
    return { label: '仅记录（不扣减）', amount: 0 }
  }
  if (mode.mode === 'legacy') {
    return { label: '历史原口径 · 不自动换算', amount: null }
  }
  const discount = resolveDiscountFactor(row)
  const effective = mode.isLegacy
    ? Number(row.voucherCost || 0) * (
      rule.settlementRuleCode === ANJIU_PRE_DISCOUNT_DEDUCTION_RULE ? discount : 1
    )
    : Number(row.voucherFaceValue || 0) * discount + Number(row.voucherDirectCost || 0)
  const amount = round2(effective)
  return {
    label: nonzero(amount) ? '实际抵扣 ¥' + amount.toFixed(2) : '实际抵扣 ¥0.00',
    amount
  }
}
