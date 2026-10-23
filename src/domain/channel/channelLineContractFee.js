/**
 * Persist per-line settlement rule fields so mixed-fee channel bills do not
 * fall back to the bill header (e.g. 5% gateway) after save/confirm.
 */
import {
  ANJIU_PRE_DISCOUNT_DEDUCTION_RULE,
  applyTargetedChannelRule,
  calculateSettlement,
  initialHeaderForm,
  resolveChannelLineRuleHeader
} from '@/domain/channel/channelBillingForm.js'

import { isSamsungRule } from './samsungSettlement.js'

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function hasLineRuleValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function ruleSignature(rule) {
  return [
    rule.settlementRuleCode || '',
    rule.channelFeeMode || '',
    rule.channelFeeRate ?? '',
    rule.taxMode || ''
  ].join('|')
}

function stampRowWithResolvedRule(row, resolved) {
  return {
    ...row,
    settlementRuleCode: resolved.settlementRuleCode || '',
    channelFeeMode: resolved.channelFeeMode || '',
    channelFeeRate: resolved.channelFeeRate != null && String(resolved.channelFeeRate).trim() !== ''
      ? String(resolved.channelFeeRate)
      : '',
    taxMode: resolved.taxMode || '',
    validationTolerance: resolved.validationTolerance != null
      ? String(resolved.validationTolerance)
      : (row.validationTolerance ?? '')
  }
}

/**
 * When platform settlement is filled, infer zero channel fee if amounts only
 * align under share_only while the header rule would apply a gateway percent.
 */
export function inferLineContractFeeFromPlatform(row, header = initialHeaderForm) {
  if (isSamsungRule(row, header)) return row
  // A verified chosen cooperation item is authority; an amount coincidence is not.
  if (row?.contractAccessItemId) return row
  const platformRaw = row?.platformSettlementAmount
  if (platformRaw === '' || platformRaw == null) return row

  const platform = Number(platformRaw)
  if (!Number.isFinite(platform)) return row

  const targetedHeader = applyTargetedChannelRule(header)
  const baseline = resolveChannelLineRuleHeader(row, targetedHeader)
  const tolerance = Math.max(0, Number(baseline.validationTolerance || 0.05))

  const withBaseline = round2(calculateSettlement(row, targetedHeader))
  if (Math.abs(withBaseline - platform) <= tolerance) return row

  const zeroFeeRow = {
    ...row,
    channelFeeMode: 'none',
    channelFeeRate: '0',
    taxMode: hasLineRuleValue(row.taxMode) ? row.taxMode : 'none',
    ...(targetedHeader.settlementRuleCode === ANJIU_PRE_DISCOUNT_DEDUCTION_RULE
      ? {}
      : { settlementRuleCode: 'share_only' })
  }
  const zeroResolved = resolveChannelLineRuleHeader(zeroFeeRow, targetedHeader)
  const withZeroFee = round2(calculateSettlement(row, zeroResolved))
  if (Math.abs(withZeroFee - platform) <= tolerance) {
    return stampRowWithResolvedRule(row, zeroResolved)
  }

  return row
}

/**
 * Stamp hidden line rule columns whenever this row resolves differently from
 * the bill header alone (mixed 5% / 0% lines on one Anjiu bill).
 */
export function materializeLineContractRuleFields(row, header = initialHeaderForm) {
  const targetedHeader = applyTargetedChannelRule(header)
  const headerOnly = resolveChannelLineRuleHeader({}, targetedHeader)
  const resolved = resolveChannelLineRuleHeader(row, targetedHeader)
  if (ruleSignature(resolved) === ruleSignature(headerOnly)) return row
  return stampRowWithResolvedRule(row, resolved)
}

/** Apply platform inference then persist per-line contract fee fields. */
export function linesWithChannelLineContractFees(lines, header = initialHeaderForm) {
  const targetedHeader = applyTargetedChannelRule(header)
  const inferred = (lines || []).map((row) => inferLineContractFeeFromPlatform(row, targetedHeader))
  const resolvedList = inferred.map((row) => resolveChannelLineRuleHeader(row, targetedHeader))
  const signatures = new Set(resolvedList.map((rule) => ruleSignature(rule)))
  if (signatures.size <= 1) {
    return inferred.map((row) => materializeLineContractRuleFields(row, targetedHeader))
  }
  return inferred.map((row, index) => stampRowWithResolvedRule(row, resolvedList[index]))
}
