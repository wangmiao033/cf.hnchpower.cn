/** A safe, opt-in helper: filling the form does NOT change settlement policy.
 * Scope remains the exact legal partner, which must map to one Xiaomi payout
 * account if the developer's ¥1,000 payout rule is used.
 */
export function isXiaomiPlatform(platformName = '', partnerName = '') {
  return /小米|xiaomi/i.test(String(platformName || '') + ' ' + String(partnerName || ''))
}

export function xiaomiThousandYuanPreset(previous = {}) {
  return {
    ...previous,
    enabled: true,
    settlement_mode: 'threshold',
    threshold_basis: 'settlement_amount',
    threshold_amount: '1000',
    note: '小米开发者平台分成结算：同一结算主体累计分成达到1000元后申请结算。月度账单先核对，未达标只累计应收，不记为已收款。'
  }
}
