/** 渠道账单表单计算与规则校验。 */
import { is233Incomplete, incomplete233Fields, incomplete233Line } from './channel233Incomplete.js'
import { SAMSUNG_STATEMENT_FEE_RULE, isSamsungIdentity, isSamsungRule, samsungRuleFields } from './samsungSettlement.js'
import { getChannelLineItems } from '@/domain/channel/channelAggregates.js'
import {
  applyCommercialDiscountFromGameName,
  commercialDiscountFactorFromGameName
} from '@/domain/channel/channelLineDefaults.js'

export const XIAN_WEIZHEN_9917_RULE = 'xian_weizhen_9917'
export const HONOR_UPFRONT_PERCENT_FEE_RULE = 'honor_upfront_percent_fee'
export const ANJIU_PRE_DISCOUNT_DEDUCTION_RULE = 'anjiu_pre_discount_deduction'
export const DAXIONG_NET_RECEIPT_RULE = 'daxiong_net_receipt'

export const CHANNEL_RULE_PRESETS = {
  [SAMSUNG_STATEMENT_FEE_RULE]: { label: '三星：原账单通道费金额先扣后分成', feeMode: 'fixed', taxMode: 'none', feeRate: 4 },
  legacy_fixed_fee_tax: { label: '固定通道费 + 分成税（旧规则）', feeMode: 'fixed', taxMode: 'share' },
  five_percent_gateway_share: { label: '5%支付通道费后分成（不扣税）', feeMode: 'percent', taxMode: 'none', feeRate: 5 },
  [HONOR_UPFRONT_PERCENT_FEE_RULE]: { label: '荣耀：流水先扣通道费后分成', feeMode: 'percent', taxMode: 'none', feeRate: 5 },
  xiaomi_percent_fee: { label: '百分比渠道费，税率仅记录（小米类）', feeMode: 'percent', taxMode: 'none', feeRate: 5 },
  [XIAN_WEIZHEN_9917_RULE]: { label: '西安维真（9917）专属规则', feeMode: 'percent', taxMode: 'none', feeRate: 5 },
  [ANJIU_PRE_DISCOUNT_DEDUCTION_RULE]: { label: '广东安久 / 游戏fan：扣减后再折扣', feeMode: 'percent', taxMode: 'share' },
  [DAXIONG_NET_RECEIPT_RULE]: { label: '大熊游戏：实收直接结算', feeMode: 'none', taxMode: 'none', feeRate: 0 },
  percent_fee_after_tax: { label: '百分比渠道费后再扣税', feeMode: 'percent', taxMode: 'after_fee' },
  share_only: { label: '仅按可分成金额 × 分成比例', feeMode: 'none', taxMode: 'none' },
  custom: { label: '自定义规则', feeMode: 'fixed', taxMode: 'share' }
}

export const initialHeaderForm = {
  channelName: '', partnerName: '', settlementMonth: '', invoiceStatus: 'pending_invoice', startDate: '', endDate: '', remark: '', status: 'pending',
  serverCost: '', discountType: '', channelFeeRate: '', devShareRate: '', profitRate: '',
  settlementRuleCode: 'legacy_fixed_fee_tax', channelFeeMode: 'fixed', taxMode: 'share', validationTolerance: '0.05',
  settlementAdjustmentType: '', settlementAdjustmentSourceMonth: '', settlementAdjustmentAmount: '', settlementAdjustmentReason: '', settlementFinalOverride: ''
}

export function initialLineItem() {
  return {
    id: '', settlementCycle: '', gameName: '', flow: '', discountFactor: '1', voucherCost: '', voucherFaceValue: null, voucherDirectCost: null, noWorryCost: '', refundCost: '', testCost: '', welfareCost: '', coinCost: '',
    shareRate: '30', taxRate: '5', gatewayCost: '', platformSettlementAmount: '', systemSettlementAmount: '', settlementDifference: '', validationStatus: 'unvalidated', settlementAmount: '',
    settlementRuleCode: '', channelFeeMode: '', channelFeeRate: '', taxMode: '', validationTolerance: ''
  }
}

function round2(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return +(Math.round(+(n + 'e+2')) + 'e-2')
}
function cents(value) { return Math.round(Number(value || 0) * 100) }
function optionalNumber(value) { if (value === '' || value == null) return null; const n = Number(value); return Number.isFinite(n) ? n : null }
function hasLineRuleValue(value) { return value !== undefined && value !== null && String(value).trim() !== '' }

export function detectChannelRulePreset(name) {
  const text = String(name || '').replace(/\s/g, '').toLowerCase()
  if (text.includes('西安维真') || text.includes('维真视界')) return XIAN_WEIZHEN_9917_RULE
  if (text === '荣耀' || /^荣耀(渠道|软件|游戏|应用|商店|公司)/.test(text) || text.includes('深圳市荣耀软件技术') || text === 'honor' || text.startsWith('honor(') || text.startsWith('honor（')) return HONOR_UPFRONT_PERCENT_FEE_RULE
  if (text.includes('广东安久科技有限公司') || text.includes('游戏fan（安久）') || text.includes('游戏fan(安久)')) return ANJIU_PRE_DISCOUNT_DEDUCTION_RULE
  if (text.includes('大熊游戏') || text.includes('大熊') || text.includes('daxiong')) return DAXIONG_NET_RECEIPT_RULE
  return text.includes('小米') || text.includes('xiaomi') || text.includes('瓦力') ? 'xiaomi_percent_fee' : ''
}

export function applyChannelRulePreset(header, code) {
  if (code === SAMSUNG_STATEMENT_FEE_RULE && !isSamsungIdentity(header)) throw new Error('此规则仅限三星指定法人渠道')
  const preset = CHANNEL_RULE_PRESETS[code] || CHANNEL_RULE_PRESETS.custom
  return {
    ...header,
    settlementRuleCode: code,
    channelFeeMode: preset.feeMode,
    taxMode: preset.taxMode,
    channelFeeRate: preset.feeRate != null ? String(preset.feeRate) : header.channelFeeRate
  }
}

export function applyTargetedChannelRule(header = initialHeaderForm) {
  // Keep legacy recognition unchanged for all non-Honor channels.
  const preset = detectChannelRulePreset(header.partnerName || header.channelName)
  if ([XIAN_WEIZHEN_9917_RULE, ANJIU_PRE_DISCOUNT_DEDUCTION_RULE, DAXIONG_NET_RECEIPT_RULE].includes(preset)) {
    return applyChannelRulePreset(header, preset)
  }
  // A channel explicitly named 荣耀 must match even if partnerName is a different legal entity.
  if (preset === HONOR_UPFRONT_PERCENT_FEE_RULE || detectChannelRulePreset(header.channelName) === HONOR_UPFRONT_PERCENT_FEE_RULE) {
    return applyChannelRulePreset(header, HONOR_UPFRONT_PERCENT_FEE_RULE)
  }
  return header
}

export function resolveChannelLineRuleHeader(data = {}, header = initialHeaderForm) {
  const effectiveHeader = applyTargetedChannelRule(header)
  if (is233Incomplete(data, effectiveHeader)) return { ...effectiveHeader, ...incomplete233Fields() }
  if (isSamsungRule(data, effectiveHeader)) {
    if (!isSamsungIdentity(effectiveHeader)) throw new Error('此规则仅限三星指定法人渠道')
    return { ...effectiveHeader, ...samsungRuleFields() }
  }
  if (effectiveHeader.settlementRuleCode === XIAN_WEIZHEN_9917_RULE) return effectiveHeader

  const hasLineRule = ['settlementRuleCode', 'channelFeeMode', 'channelFeeRate', 'taxMode', 'validationTolerance']
    .some((key) => hasLineRuleValue(data?.[key]))
  if (!hasLineRule) return effectiveHeader

  if (effectiveHeader.settlementRuleCode === ANJIU_PRE_DISCOUNT_DEDUCTION_RULE) {
    return {
      ...effectiveHeader,
      settlementRuleCode: ANJIU_PRE_DISCOUNT_DEDUCTION_RULE,
      channelFeeMode: hasLineRuleValue(data.channelFeeMode) ? data.channelFeeMode : effectiveHeader.channelFeeMode,
      channelFeeRate: hasLineRuleValue(data.channelFeeRate) ? data.channelFeeRate : effectiveHeader.channelFeeRate,
      taxMode: 'share',
      validationTolerance: hasLineRuleValue(data.validationTolerance) ? data.validationTolerance : effectiveHeader.validationTolerance
    }
  }

  if (hasLineRuleValue(data.channelFeeMode) && String(data.channelFeeMode).trim() === 'none') {
    return {
      ...effectiveHeader,
      settlementRuleCode: hasLineRuleValue(data.settlementRuleCode) ? data.settlementRuleCode : effectiveHeader.settlementRuleCode,
      channelFeeMode: 'none',
      channelFeeRate: hasLineRuleValue(data.channelFeeRate) ? data.channelFeeRate : '0',
      taxMode: hasLineRuleValue(data.taxMode) ? data.taxMode : effectiveHeader.taxMode,
      validationTolerance: hasLineRuleValue(data.validationTolerance) ? data.validationTolerance : effectiveHeader.validationTolerance
    }
  }

  return {
    ...effectiveHeader,
    settlementRuleCode: hasLineRuleValue(data.settlementRuleCode) ? data.settlementRuleCode : effectiveHeader.settlementRuleCode,
    channelFeeMode: hasLineRuleValue(data.channelFeeMode) ? data.channelFeeMode : effectiveHeader.channelFeeMode,
    channelFeeRate: hasLineRuleValue(data.channelFeeRate) ? data.channelFeeRate : effectiveHeader.channelFeeRate,
    taxMode: hasLineRuleValue(data.taxMode) ? data.taxMode : effectiveHeader.taxMode,
    validationTolerance: hasLineRuleValue(data.validationTolerance) ? data.validationTolerance : effectiveHeader.validationTolerance
  }
}

export function ruleFormulaText(header) {
  if (is233Incomplete(header)) return '233资料未齐：仅暂存真实平台结算，原始充值与分成待补，不进行公式校验'
  if (isSamsungRule(header)) return '三星：（流水折算后金额 - 代金券等扣减 - 原账单完整通道费金额）× 分成比例；4%仅记录，含税拆分不再扣税'
  const effectiveHeader = applyTargetedChannelRule(header)
  if (effectiveHeader.settlementRuleCode === XIAN_WEIZHEN_9917_RULE) {
    return '西安维真9917：代金券/福利币仅记录；其余原扣减项参与 × 分成比例 × (1 - 5%通道费)，税率仅记录'
  }
  if (effectiveHeader.settlementRuleCode === ANJIU_PRE_DISCOUNT_DEDUCTION_RULE) {
    return '广东安久 / 游戏fan：（后台流水 - 代金券/退款/测试费等扣减）× 折扣系数 × 分成比例 ×（1 - 渠道费率 - 税费率）'
  }
  if (effectiveHeader.settlementRuleCode === DAXIONG_NET_RECEIPT_RULE) {
    return '大熊游戏：系统结算 = 实收合计；分成比例仅台账记录，不参与计算；竹B/月卡等实收=0行不参与结算汇总'
  }
  if (effectiveHeader.settlementRuleCode === HONOR_UPFRONT_PERCENT_FEE_RULE) {
    return `荣耀： (总流水 - 总流水 × ${Number(effectiveHeader.channelFeeRate || 0)}%通道费 - 代金券/退款等扣减) × 分成比例；税率按合同记录`
  }
  const feeMode = effectiveHeader.channelFeeMode || 'fixed'
  const taxMode = effectiveHeader.taxMode || 'share'
  const fee = feeMode === 'percent' ? ` × (1 - ${Number(effectiveHeader.channelFeeRate || 0)}%)` : feeMode === 'fixed' ? ' - 固定通道费' : ''
  const tax = taxMode === 'share' ? ' - 分成额 × 税率' : taxMode === 'after_fee' ? ' × (1 - 税率)' : ''
  return `可分成金额 × 分成比例${fee}${tax}`
}

export function normalizeChannelSettlementCycle(value) {
  const raw = String(value || '').trim(); if (!raw) return ''
  let match = raw.match(/^(20\d{2})[-/.](0?[1-9]|1[0-2])$/); if (!match) match = raw.match(/^(20\d{2})年\s*(0?[1-9]|1[0-2])月?$/)
  return match ? `${match[1]}-${String(Number(match[2])).padStart(2, '0')}` : raw
}

function monthDateRange(month) {
  const normalized = normalizeChannelSettlementCycle(month); const match = normalized.match(/^(20\d{2})-(\d{2})$/)
  if (!match) return { startDate: '', endDate: '' }
  const lastDay = new Date(Number(match[1]), Number(match[2]), 0).getDate()
  return { startDate: `${match[1]}-${match[2]}-01`, endDate: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}` }
}

export function channelSettlementPeriodFromLines(lines, fallbackMonth = '') {
  const months = [...new Set((lines || []).map((line) => normalizeChannelSettlementCycle(line?.settlementCycle)).filter((v) => /^(20\d{2})-(\d{2})$/.test(v)))].sort()
  const fallback = normalizeChannelSettlementCycle(fallbackMonth); if (!months.length && /^(20\d{2})-(\d{2})$/.test(fallback)) months.push(fallback)
  if (!months.length) return { months: [], firstMonth: '', lastMonth: '', settlementMonth: '', startDate: '', endDate: '' }
  const firstMonth = months[0], lastMonth = months[months.length - 1]
  return { months, firstMonth, lastMonth, settlementMonth: lastMonth, startDate: monthDateRange(firstMonth).startDate, endDate: monthDateRange(lastMonth).endDate }
}

export function channelStatusForSubmit(currentStatus, intent) { return intent === 'confirm' ? 'confirmed' : currentStatus || 'pending' }
export const initialForm = { ...initialHeaderForm, ...initialLineItem() }

export function resolveDiscountFactor(data) {
  const n = Number(data.discountFactor)
  if (Number.isFinite(n) && n > 0) return n
  const fromName = commercialDiscountFactorFromGameName(data?.gameName)
  return fromName != null && fromName > 0 ? fromName : 1
}

/**
 * When Anjiu platform settlement is known but voucher is blank/zero, back-solve
 * the pre-discount voucher deduction that makes the dedicated formula match.
 */
export function inferAnjiuVoucherFromPlatform(data, header = initialHeaderForm) {
  const rule = resolveChannelLineRuleHeader(data, header)
  if (rule.settlementRuleCode !== ANJIU_PRE_DISCOUNT_DEDUCTION_RULE) return null
  const platform = optionalNumber(data.platformSettlementAmount)
  if (platform == null || platform <= 0) return null
  const voucherStored = Number(data.voucherCost || 0)
  if (voucherStored > 0 || hasSplitVoucherFields(data)) return null

  const flow = Number(data.flow || 0)
  if (!Number.isFinite(flow) || flow <= 0) return null
  const discount = resolveDiscountFactor(data)
  const share = Number(data.shareRate || 0) / 100
  if (!Number.isFinite(share) || share <= 0) return null
  const fee = rule.channelFeeMode === 'percent' ? Number(rule.channelFeeRate || 0) / 100 : 0
  const tax = rule.taxMode === 'share' ? Number(data.taxRate || 0) / 100 : 0
  const multiplier = share * (1 - fee - tax)
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null

  let low = 0
  let high = Math.floor(flow)
  let best = null
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const trial = { ...data, voucherCost: String(mid) }
    const system = calculateSettlementDetails(trial, header).systemSettlementAmount
    if (system === platform) return mid
    if (system > platform) low = mid + 1
    else high = mid - 1
    best = mid
  }
  return best
}

export function applyAnjiuVoucherInference(row, header = initialHeaderForm) {
  const inferred = inferAnjiuVoucherFromPlatform(row, header)
  if (inferred == null) return row
  return { ...row, voucherCost: String(inferred) }
}
export function effectiveLineFlowFromFormData(data) { return round2(Number(data.flow || 0) * resolveDiscountFactor(data)) }

/** Both null indicates an untouched historical voucher_cost (never convert it). */
export function hasSplitVoucherFields(data) {
  return data?.voucherFaceValue != null || data?.voucherDirectCost != null
}

/** Keep the legacy amount column while preserving the optional split inputs. */
export function voucherCostForStorage(data, header = initialHeaderForm) {
  if (!hasSplitVoucherFields(data)) return Number(data.voucherCost || 0)
  const face = Number(data.voucherFaceValue || 0)
  const direct = Number(data.voucherDirectCost || 0)
  const discount = resolveDiscountFactor(data)
  const rule = resolveChannelLineRuleHeader(data, header)
  // Anjiu deducts vouchers BEFORE discount: store the corresponding original
  // value so the old ledger field remains meaningful on rollback.
  if (rule.settlementRuleCode === ANJIU_PRE_DISCOUNT_DEDUCTION_RULE) {
    return round2(face + direct / discount)
  }
  return round2(face * discount + direct)
}

function deductionFieldsForHeader(header = initialHeaderForm) {
  const effectiveHeader = applyTargetedChannelRule(header)
  if (effectiveHeader.settlementRuleCode === XIAN_WEIZHEN_9917_RULE) {
    return ['noWorryCost', 'refundCost', 'testCost', 'coinCost']
  }
  return ['voucherCost', 'noWorryCost', 'refundCost', 'testCost', 'welfareCost', 'coinCost']
}

export function calculateBillingAmount(data, header = initialHeaderForm) {
  if (is233Incomplete(data, header)) return 0
  const effectiveHeader = resolveChannelLineRuleHeader(data, header)
  const effectiveFlow = effectiveLineFlowFromFormData(data)
  const split = hasSplitVoucherFields(data)
  const deductions = deductionFieldsForHeader(effectiveHeader).reduce(
    (sum, key) => sum + (split && key === 'voucherCost' ? 0 : Number(data[key] || 0)), 0
  )
  const face = split ? Number(data.voucherFaceValue || 0) : 0
  const direct = split ? Number(data.voucherDirectCost || 0) : 0
  const splitDeduction = face * resolveDiscountFactor(data) + direct
  if (effectiveHeader.settlementRuleCode === ANJIU_PRE_DISCOUNT_DEDUCTION_RULE) {
    return split
      ? (Number(data.flow || 0) - deductions - face) * resolveDiscountFactor(data) - direct
      : (Number(data.flow || 0) - deductions) * resolveDiscountFactor(data)
  }
  if (effectiveHeader.settlementRuleCode === HONOR_UPFRONT_PERCENT_FEE_RULE) {
    const upfrontChannelFee = effectiveFlow * Number(effectiveHeader.channelFeeRate || 0) / 100
    return effectiveFlow - upfrontChannelFee - deductions - splitDeduction
  }
  if (isSamsungRule(effectiveHeader)) return effectiveFlow - deductions - splitDeduction - Number(data.gatewayCost || 0)
  // This targeted contract records vouchers without deducting them.
  return effectiveFlow - deductions - (effectiveHeader.settlementRuleCode === XIAN_WEIZHEN_9917_RULE ? 0 : splitDeduction)
}
export function calculateShareAmount(data, header = initialHeaderForm) { return calculateBillingAmount(data, header) * Number(data.shareRate || 0) / 100 }

function calculateSettlementRaw(data, header = initialHeaderForm) {
  if (is233Incomplete(data, header)) return 0
  const effectiveHeader = resolveChannelLineRuleHeader(data, header)
  const shareAmount = calculateShareAmount(data, effectiveHeader)
  const feeMode = effectiveHeader.channelFeeMode || 'fixed'; const taxMode = effectiveHeader.taxMode || 'share'
  let afterFee = shareAmount
  if (feeMode === 'percent' && effectiveHeader.settlementRuleCode !== HONOR_UPFRONT_PERCENT_FEE_RULE) afterFee = shareAmount * (1 - Number(effectiveHeader.channelFeeRate || 0) / 100)
  else if (feeMode === 'fixed' && !isSamsungRule(effectiveHeader)) afterFee = shareAmount - Number(data.gatewayCost || 0)
  const taxRate = Number(data.taxRate || 0) / 100
  if (taxMode === 'share') return afterFee - shareAmount * taxRate
  if (taxMode === 'after_fee') return afterFee * (1 - taxRate)
  return afterFee
}

export function calculateSettlementDetails(data, header = initialHeaderForm) {
  const effectiveHeader = resolveChannelLineRuleHeader(data, header)
  const system = round2(calculateSettlementRaw(data, effectiveHeader))
  const platform = optionalNumber(data.platformSettlementAmount)
  if (is233Incomplete(data, header)) return { systemSettlementAmount: 0, platformSettlementAmount: platform, settlementDifference: null, validationStatus: 'incomplete', settlementAmount: round2(platform ?? 0) }
  // 大熊游戏：系统结算 = 实收合计（net receipt），非公式计算
  if (effectiveHeader.settlementRuleCode === DAXIONG_NET_RECEIPT_RULE) {
    if (platform != null) {
      return { systemSettlementAmount: platform, platformSettlementAmount: platform, settlementDifference: 0, validationStatus: 'pass', settlementAmount: round2(platform) }
    }
    return { systemSettlementAmount: 0, platformSettlementAmount: null, settlementDifference: null, validationStatus: 'unvalidated', settlementAmount: 0 }
  }
  const difference = platform == null ? null : round2(system - platform)
  const tolerance = Math.max(0, Number(effectiveHeader.validationTolerance || 0.05))
  const validationStatus = platform == null ? 'unvalidated' : Math.abs(difference) <= tolerance ? 'pass' : 'fail'
  return { systemSettlementAmount: system, platformSettlementAmount: platform, settlementDifference: difference, validationStatus, settlementAmount: platform == null ? system : round2(platform) }
}
export function calculateSettlement(data, header = initialHeaderForm) { return calculateSettlementRaw(data, header) }

export function buildLineRecordFromForm(fd, headerForm = initialHeaderForm) {
  if (is233Incomplete(fd, headerForm)) fd = incomplete233Line(fd)
  const effectiveHeader = resolveChannelLineRuleHeader(fd, headerForm)
  const details = calculateSettlementDetails(fd, effectiveHeader)
  return {
    ...(fd.id ? { id: String(fd.id) } : {}),
    ...(Object.prototype.hasOwnProperty.call(fd, 'contractAccessItemId') ? { contractAccessItemId: fd.contractAccessItemId } : {}),
    settlementCycle: normalizeChannelSettlementCycle(fd.settlementCycle || fd.settlementMonth), gameName: fd.gameName != null ? String(fd.gameName) : '',
    flow: Number(fd.flow || 0), discountFactor: resolveDiscountFactor(fd), effectiveFlow: effectiveLineFlowFromFormData(fd),
    voucherCost: voucherCostForStorage(fd, effectiveHeader),
    // Keep NULL in the inactive mode: persisting it as 0 would lose the
    // operator's radio selection when a saved zero-value voucher is reopened.
    voucherFaceValue: parseOptionalNum(fd.voucherFaceValue),
    voucherDirectCost: parseOptionalNum(fd.voucherDirectCost),
    noWorryCost: Number(fd.noWorryCost || 0), refundCost: Number(fd.refundCost || 0), testCost: Number(fd.testCost || 0), welfareCost: Number(fd.welfareCost || 0), coinCost: Number(fd.coinCost || 0),
    billingAmount: round2(calculateBillingAmount(fd, effectiveHeader)), shareRate: Number(fd.shareRate || 0), shareAmount: round2(calculateShareAmount(fd, effectiveHeader)), taxRate: Number(fd.taxRate || 0), gatewayCost: Number(fd.gatewayCost || 0),
    settlementRuleCode: effectiveHeader.settlementRuleCode || '', channelFeeMode: effectiveHeader.channelFeeMode || '', channelFeeRate: parseOptionalNum(effectiveHeader.channelFeeRate), taxMode: effectiveHeader.taxMode || '', validationTolerance: Math.max(0, Number(effectiveHeader.validationTolerance || 0.05)),
    ...details
  }
}

function parseOptionalNum(v) { return optionalNumber(v) }

export function buildFullChannelRecord(headerForm, lineFormList) {
  const effectiveHeader = applyTargetedChannelRule(headerForm)
  const items = lineFormList.map((row) => buildLineRecordFromForm(row, effectiveHeader)); const sum = (key) => round2(items.reduce((s, it) => s + Number(it[key] || 0), 0))
  const period = channelSettlementPeriodFromLines(items, effectiveHeader.settlementMonth)
  const platformRows = items.filter((i) => i.platformSettlementAmount != null)
  const roundedLineSystemTotal = sum('systemSettlementAmount')
  const precisionSystemTotal = round2(lineFormList.reduce((total, row) => total + calculateSettlementRaw(row, resolveChannelLineRuleHeader(row, effectiveHeader)), 0))
  const platformTotal = platformRows.length ? round2(platformRows.reduce((s, i) => s + i.platformSettlementAmount, 0)) : null
  const everyLineMatchesRoundedPlatform = items.length > 0 && platformRows.length === items.length && items.every((item) => item.settlementDifference != null && cents(item.settlementDifference) === 0)
  const roundingTailApplied = everyLineMatchesRoundedPlatform && platformTotal != null && cents(platformTotal) === cents(roundedLineSystemTotal) && Math.abs(cents(precisionSystemTotal) - cents(roundedLineSystemTotal)) === 1
  const systemTotal = roundingTailApplied ? precisionSystemTotal : roundedLineSystemTotal
  const differenceTotal = is233Incomplete(effectiveHeader) || platformTotal == null ? null : round2(systemTotal - platformTotal)
  const validationStatus = is233Incomplete(effectiveHeader) ? 'incomplete' : items.some((i) => i.validationStatus === 'fail') ? 'fail' : items.length && items.every((i) => i.validationStatus === 'pass') ? 'pass' : platformRows.length ? 'partial' : 'unvalidated'
  const settlementTotal = roundingTailApplied ? precisionSystemTotal : sum('settlementAmount')
  const businessSettlementAmount = settlementTotal
  const settlementAdjustmentAmount = round2(Number(effectiveHeader.settlementAdjustmentAmount || 0))
  const settlementCalculatedAfterAdjustment = round2(businessSettlementAmount + settlementAdjustmentAmount)
  const finalOverride = optionalNumber(effectiveHeader.settlementFinalOverride)
  const finalSettlementAmount = finalOverride == null ? settlementCalculatedAfterAdjustment : round2(finalOverride)
  const settlementAdjustmentTail = round2(finalSettlementAmount - settlementCalculatedAfterAdjustment)
  return {
    ...(effectiveHeader.completeIncompleteDraft ? { completeIncompleteDraft: true, incompleteCompletionReason: effectiveHeader.incompleteCompletionReason || '' } : {}),
    channelName: effectiveHeader.channelName, partnerName: effectiveHeader.partnerName || '', settlementMonth: period.settlementMonth || normalizeChannelSettlementCycle(effectiveHeader.settlementMonth), invoiceStatus: effectiveHeader.invoiceStatus || 'pending_invoice', invoice_status: effectiveHeader.invoiceStatus || 'pending_invoice',
    startDate: period.startDate || effectiveHeader.startDate || '', endDate: period.endDate || effectiveHeader.endDate || '', remark: effectiveHeader.remark || '', status: effectiveHeader.status || 'pending', serverCost: parseOptionalNum(effectiveHeader.serverCost), discountType: effectiveHeader.discountType || null,
    settlementAdjustmentType: effectiveHeader.settlementAdjustmentType || '', settlementAdjustmentSourceMonth: normalizeChannelSettlementCycle(effectiveHeader.settlementAdjustmentSourceMonth), settlementAdjustmentAmount, settlementAdjustmentReason: effectiveHeader.settlementAdjustmentReason || '', settlementFinalOverride: finalOverride, businessSettlementAmount, settlementCalculatedAfterAdjustment, settlementAdjustmentTail,
    channelFeeRate: parseOptionalNum(effectiveHeader.channelFeeRate), devShareRate: parseOptionalNum(effectiveHeader.devShareRate), profitRate: parseOptionalNum(effectiveHeader.profitRate),
    settlementRuleCode: effectiveHeader.settlementRuleCode || 'legacy_fixed_fee_tax', channelFeeMode: effectiveHeader.channelFeeMode || 'fixed', taxMode: effectiveHeader.taxMode || 'share', validationTolerance: Math.max(0, Number(effectiveHeader.validationTolerance || 0.05)),
    items, gameName: items.map((i) => i.gameName).filter(Boolean).join('、'), rawFlowTotal: sum('flow'), flow: sum('effectiveFlow'), voucherCost: sum('voucherCost'), noWorryCost: sum('noWorryCost'), refundCost: sum('refundCost'), testCost: sum('testCost'), welfareCost: sum('welfareCost'), coinCost: sum('coinCost'), billingAmount: sum('billingAmount'), shareAmount: sum('shareAmount'),
    taxRate: items[0]?.taxRate || 0, shareRate: items[0]?.shareRate || 0, gatewayCost: sum('gatewayCost'), systemSettlementAmount: systemTotal, platformSettlementAmount: platformTotal, settlementDifference: differenceTotal, validationStatus, settlementAmount: finalSettlementAmount
  }
}

export function buildChannelBillFromSingleGameForm(fd) {
  const cycle = normalizeChannelSettlementCycle(fd.settlementCycle || fd.settlementMonth)
  return buildFullChannelRecord({ ...initialHeaderForm, channelName: fd.channelName, partnerName: fd.partnerName || '', settlementMonth: cycle, invoiceStatus: fd.invoiceStatus || 'pending_invoice', startDate: fd.startDate || '', endDate: fd.endDate || '', remark: fd.remark || '', status: 'pending' }, [{ ...fd, settlementCycle: cycle }])
}
export function buildRecordFromForm(fd) { const line = buildLineRecordFromForm(fd, fd); return { ...fd, ...line, channelName: fd.channelName, startDate: fd.startDate, endDate: fd.endDate, remark: fd.remark } }

export function recordToHeaderForm(record) {
  const base = {
    ...(record.completeIncompleteDraft ? { completeIncompleteDraft: true, incompleteCompletionReason: record.incompleteCompletionReason || '' } : {}),
    channelName: record.channelName || '', partnerName: record.partnerName || '', settlementMonth: record.settlementMonth || '', invoiceStatus: record.invoiceStatus || record.invoice_status || 'pending_invoice', startDate: record.startDate || '', endDate: record.endDate || '', remark: record.remark || '', status: record.status || 'pending', serverCost: record.serverCost != null ? String(record.serverCost) : '', discountType: record.discountType || '', channelFeeRate: record.channelFeeRate != null ? String(record.channelFeeRate) : '', devShareRate: record.devShareRate != null ? String(record.devShareRate) : '', profitRate: record.profitRate != null ? String(record.profitRate) : '',
    settlementRuleCode: record.completeIncompleteDraft ? record.settlementRuleCode || '' : record.settlementRuleCode || 'legacy_fixed_fee_tax', channelFeeMode: record.channelFeeMode || 'fixed', taxMode: record.taxMode || 'share', validationTolerance: record.validationTolerance != null ? String(record.validationTolerance) : '0.05', settlementAdjustmentType: record.settlementAdjustmentType || '', settlementAdjustmentSourceMonth: normalizeChannelSettlementCycle(record.settlementAdjustmentSourceMonth), settlementAdjustmentAmount: record.settlementAdjustmentAmount != null && Number(record.settlementAdjustmentAmount) !== 0 ? String(record.settlementAdjustmentAmount) : '', settlementAdjustmentReason: record.settlementAdjustmentReason || '', settlementFinalOverride: record.settlementFinalOverride != null ? String(record.settlementFinalOverride) : ''
  }
  return applyTargetedChannelRule(base)
}

export function recordToLineForms(record) {
  const header = recordToHeaderForm(record)
  return getChannelLineItems(record).map((line) => {
    const base = {
      ...(Object.prototype.hasOwnProperty.call(line, 'contractAccessItemId') ? { contractAccessItemId: line.contractAccessItemId } : {}),
      id: line.id != null ? String(line.id) : '', settlementCycle: normalizeChannelSettlementCycle(line.settlementCycle || record.settlementMonth), gameName: line.gameName || '', flow: String(line.flow ?? ''), discountFactor: line.discountFactor != null ? String(line.discountFactor) : '1', voucherCost: String(line.voucherCost ?? ''), voucherFaceValue: line.voucherFaceValue == null ? null : String(line.voucherFaceValue), voucherDirectCost: line.voucherDirectCost == null ? null : String(line.voucherDirectCost), noWorryCost: String(line.noWorryCost ?? ''), refundCost: String(line.refundCost ?? ''), testCost: String(line.testCost ?? ''), welfareCost: String(line.welfareCost ?? ''), coinCost: String(line.coinCost ?? ''), shareRate: String(line.shareRate ?? '30'), taxRate: String(line.taxRate ?? '5'), gatewayCost: String(line.gatewayCost ?? ''), platformSettlementAmount: line.platformSettlementAmount != null ? String(line.platformSettlementAmount) : '', systemSettlementAmount: String(line.systemSettlementAmount ?? ''), settlementDifference: line.settlementDifference != null ? String(line.settlementDifference) : '', validationStatus: line.validationStatus || 'unvalidated', settlementAmount: String(line.settlementAmount ?? ''),
      settlementRuleCode: line.settlementRuleCode || '', channelFeeMode: line.channelFeeMode || '', channelFeeRate: line.channelFeeRate != null ? String(line.channelFeeRate) : '', taxMode: line.taxMode || '', validationTolerance: line.validationTolerance != null ? String(line.validationTolerance) : ''
    }
    if (is233Incomplete(base, header)) return incomplete233Line(base)
    return applyAnjiuVoucherInference(applyCommercialDiscountFromGameName(base), header)
  })
}
export function recordToFormData(record) { const h = recordToHeaderForm(record); const first = recordToLineForms(record)[0] || initialLineItem(); return { ...h, ...first } }
