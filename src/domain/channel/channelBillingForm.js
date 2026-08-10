/** 渠道账单表单计算与规则校验。 */
import { getChannelLineItems } from '@/domain/channel/channelAggregates.js'

export const CHANNEL_RULE_PRESETS = {
  legacy_fixed_fee_tax: { label: '固定通道费 + 分成税（旧规则）', feeMode: 'fixed', taxMode: 'share' },
  xiaomi_percent_fee: { label: '百分比渠道费，税率仅记录（小米类）', feeMode: 'percent', taxMode: 'none', feeRate: 5 },
  percent_fee_after_tax: { label: '百分比渠道费后再扣税', feeMode: 'percent', taxMode: 'after_fee' },
  share_only: { label: '仅按可分成金额 × 分成比例', feeMode: 'none', taxMode: 'none' },
  custom: { label: '自定义规则', feeMode: 'fixed', taxMode: 'share' }
}

export const initialHeaderForm = {
  channelName: '', partnerName: '', settlementMonth: '', invoiceStatus: 'pending_invoice', startDate: '', endDate: '', remark: '', status: 'pending',
  serverCost: '', discountType: '', channelFeeRate: '', devShareRate: '', profitRate: '',
  settlementRuleCode: 'legacy_fixed_fee_tax', channelFeeMode: 'fixed', taxMode: 'share', validationTolerance: '0.05'
}

export function initialLineItem() {
  return {
    id: '', settlementCycle: '', gameName: '', flow: '', discountFactor: '1', voucherCost: '', noWorryCost: '', refundCost: '', testCost: '', welfareCost: '', coinCost: '',
    shareRate: '30', taxRate: '5', gatewayCost: '', platformSettlementAmount: '', systemSettlementAmount: '', settlementDifference: '', validationStatus: 'unvalidated', settlementAmount: ''
  }
}

function round2(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100 }
function optionalNumber(value) { if (value === '' || value == null) return null; const n = Number(value); return Number.isFinite(n) ? n : null }

export function detectChannelRulePreset(name) {
  const text = String(name || '').replace(/\s/g, '').toLowerCase()
  return text.includes('小米') || text.includes('xiaomi') ? 'xiaomi_percent_fee' : ''
}

export function applyChannelRulePreset(header, code) {
  const preset = CHANNEL_RULE_PRESETS[code] || CHANNEL_RULE_PRESETS.custom
  return {
    ...header,
    settlementRuleCode: code,
    channelFeeMode: preset.feeMode,
    taxMode: preset.taxMode,
    channelFeeRate: preset.feeRate != null ? String(preset.feeRate) : header.channelFeeRate
  }
}

export function ruleFormulaText(header) {
  const feeMode = header.channelFeeMode || 'fixed'
  const taxMode = header.taxMode || 'share'
  const fee = feeMode === 'percent' ? ` × (1 - ${Number(header.channelFeeRate || 0)}%)` : feeMode === 'fixed' ? ' - 固定通道费' : ''
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

export function resolveDiscountFactor(data) { const n = Number(data.discountFactor); return Number.isFinite(n) && n > 0 ? n : 1 }
export function effectiveLineFlowFromFormData(data) { return round2(Number(data.flow || 0) * resolveDiscountFactor(data)) }

export function calculateBillingAmount(data) {
  return effectiveLineFlowFromFormData(data) - ['voucherCost','noWorryCost','refundCost','testCost','welfareCost','coinCost'].reduce((sum, key) => sum + Number(data[key] || 0), 0)
}
export function calculateShareAmount(data) { return calculateBillingAmount(data) * Number(data.shareRate || 0) / 100 }

export function calculateSettlementDetails(data, header = initialHeaderForm) {
  const shareAmount = calculateShareAmount(data)
  const feeMode = header.channelFeeMode || 'fixed'; const taxMode = header.taxMode || 'share'
  let afterFee = shareAmount
  if (feeMode === 'percent') afterFee = shareAmount * (1 - Number(header.channelFeeRate || 0) / 100)
  else if (feeMode === 'fixed') afterFee = shareAmount - Number(data.gatewayCost || 0)
  const taxRate = Number(data.taxRate || 0) / 100
  let system = afterFee
  if (taxMode === 'share') system = afterFee - shareAmount * taxRate
  else if (taxMode === 'after_fee') system = afterFee * (1 - taxRate)
  system = round2(system)
  const platform = optionalNumber(data.platformSettlementAmount)
  const difference = platform == null ? null : round2(system - platform)
  const tolerance = Math.max(0, Number(header.validationTolerance || 0.05))
  const validationStatus = platform == null ? 'unvalidated' : Math.abs(difference) <= tolerance ? 'pass' : 'fail'
  return { systemSettlementAmount: system, platformSettlementAmount: platform, settlementDifference: difference, validationStatus, settlementAmount: platform == null ? system : round2(platform) }
}
export function calculateSettlement(data, header = initialHeaderForm) { return calculateSettlementDetails(data, header).systemSettlementAmount }

export function buildLineRecordFromForm(fd, headerForm = initialHeaderForm) {
  const details = calculateSettlementDetails(fd, headerForm)
  return {
    settlementCycle: normalizeChannelSettlementCycle(fd.settlementCycle || fd.settlementMonth), gameName: fd.gameName != null ? String(fd.gameName) : '',
    flow: Number(fd.flow || 0), discountFactor: resolveDiscountFactor(fd), effectiveFlow: effectiveLineFlowFromFormData(fd),
    voucherCost: Number(fd.voucherCost || 0), noWorryCost: Number(fd.noWorryCost || 0), refundCost: Number(fd.refundCost || 0), testCost: Number(fd.testCost || 0), welfareCost: Number(fd.welfareCost || 0), coinCost: Number(fd.coinCost || 0),
    billingAmount: round2(calculateBillingAmount(fd)), shareRate: Number(fd.shareRate || 0), shareAmount: round2(calculateShareAmount(fd)), taxRate: Number(fd.taxRate || 0), gatewayCost: Number(fd.gatewayCost || 0),
    ...details
  }
}

function parseOptionalNum(v) { return optionalNumber(v) }

export function buildFullChannelRecord(headerForm, lineFormList) {
  const items = lineFormList.map((row) => buildLineRecordFromForm(row, headerForm)); const sum = (key) => round2(items.reduce((s, it) => s + Number(it[key] || 0), 0))
  const period = channelSettlementPeriodFromLines(items, headerForm.settlementMonth)
  const platformRows = items.filter((i) => i.platformSettlementAmount != null)
  const validationStatus = items.some((i) => i.validationStatus === 'fail') ? 'fail' : items.length && items.every((i) => i.validationStatus === 'pass') ? 'pass' : platformRows.length ? 'partial' : 'unvalidated'
  return {
    channelName: headerForm.channelName, partnerName: headerForm.partnerName || '', settlementMonth: period.settlementMonth || normalizeChannelSettlementCycle(headerForm.settlementMonth), invoiceStatus: headerForm.invoiceStatus || 'pending_invoice', invoice_status: headerForm.invoiceStatus || 'pending_invoice',
    startDate: period.startDate || headerForm.startDate || '', endDate: period.endDate || headerForm.endDate || '', remark: headerForm.remark || '', status: headerForm.status || 'pending', serverCost: parseOptionalNum(headerForm.serverCost), discountType: headerForm.discountType || null,
    channelFeeRate: parseOptionalNum(headerForm.channelFeeRate), devShareRate: parseOptionalNum(headerForm.devShareRate), profitRate: parseOptionalNum(headerForm.profitRate),
    settlementRuleCode: headerForm.settlementRuleCode || 'legacy_fixed_fee_tax', channelFeeMode: headerForm.channelFeeMode || 'fixed', taxMode: headerForm.taxMode || 'share', validationTolerance: Math.max(0, Number(headerForm.validationTolerance || 0.05)),
    items, gameName: items.map((i) => i.gameName).filter(Boolean).join('、'), rawFlowTotal: sum('flow'), flow: sum('effectiveFlow'), voucherCost: sum('voucherCost'), noWorryCost: sum('noWorryCost'), refundCost: sum('refundCost'), testCost: sum('testCost'), welfareCost: sum('welfareCost'), coinCost: sum('coinCost'), billingAmount: sum('billingAmount'), shareAmount: sum('shareAmount'),
    taxRate: items[0]?.taxRate || 0, shareRate: items[0]?.shareRate || 0, gatewayCost: sum('gatewayCost'), systemSettlementAmount: sum('systemSettlementAmount'), platformSettlementAmount: platformRows.length ? round2(platformRows.reduce((s, i) => s + i.platformSettlementAmount, 0)) : null, settlementDifference: platformRows.length ? round2(platformRows.reduce((s, i) => s + Number(i.settlementDifference || 0), 0)) : null, validationStatus, settlementAmount: sum('settlementAmount')
  }
}

export function buildChannelBillFromSingleGameForm(fd) {
  const cycle = normalizeChannelSettlementCycle(fd.settlementCycle || fd.settlementMonth)
  return buildFullChannelRecord({ ...initialHeaderForm, channelName: fd.channelName, partnerName: fd.partnerName || '', settlementMonth: cycle, invoiceStatus: fd.invoiceStatus || 'pending_invoice', startDate: fd.startDate || '', endDate: fd.endDate || '', remark: fd.remark || '', status: 'pending' }, [{ ...fd, settlementCycle: cycle }])
}
export function buildRecordFromForm(fd) { const line = buildLineRecordFromForm(fd, fd); return { ...fd, ...line, channelName: fd.channelName, startDate: fd.startDate, endDate: fd.endDate, remark: fd.remark } }

export function recordToHeaderForm(record) {
  return {
    channelName: record.channelName || '', partnerName: record.partnerName || '', settlementMonth: record.settlementMonth || '', invoiceStatus: record.invoiceStatus || record.invoice_status || 'pending_invoice', startDate: record.startDate || '', endDate: record.endDate || '', remark: record.remark || '', status: record.status || 'pending', serverCost: record.serverCost != null ? String(record.serverCost) : '', discountType: record.discountType || '', channelFeeRate: record.channelFeeRate != null ? String(record.channelFeeRate) : '', devShareRate: record.devShareRate != null ? String(record.devShareRate) : '', profitRate: record.profitRate != null ? String(record.profitRate) : '',
    settlementRuleCode: record.settlementRuleCode || 'legacy_fixed_fee_tax', channelFeeMode: record.channelFeeMode || 'fixed', taxMode: record.taxMode || 'share', validationTolerance: record.validationTolerance != null ? String(record.validationTolerance) : '0.05'
  }
}

export function recordToLineForms(record) {
  return getChannelLineItems(record).map((line) => ({
    id: line.id != null ? String(line.id) : '', settlementCycle: normalizeChannelSettlementCycle(line.settlementCycle || record.settlementMonth), gameName: line.gameName || '', flow: String(line.flow ?? ''), discountFactor: line.discountFactor != null ? String(line.discountFactor) : '1', voucherCost: String(line.voucherCost ?? ''), noWorryCost: String(line.noWorryCost ?? ''), refundCost: String(line.refundCost ?? ''), testCost: String(line.testCost ?? ''), welfareCost: String(line.welfareCost ?? ''), coinCost: String(line.coinCost ?? ''), shareRate: String(line.shareRate ?? '30'), taxRate: String(line.taxRate ?? '5'), gatewayCost: String(line.gatewayCost ?? ''), platformSettlementAmount: line.platformSettlementAmount != null ? String(line.platformSettlementAmount) : '', systemSettlementAmount: String(line.systemSettlementAmount ?? ''), settlementDifference: line.settlementDifference != null ? String(line.settlementDifference) : '', validationStatus: line.validationStatus || 'unvalidated', settlementAmount: String(line.settlementAmount ?? '')
  }))
}
export function recordToFormData(record) { const h = recordToHeaderForm(record); const first = recordToLineForms(record)[0] || initialLineItem(); return { ...h, ...first } }
