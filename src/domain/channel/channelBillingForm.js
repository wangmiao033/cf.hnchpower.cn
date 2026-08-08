/**
 * 渠道对账表单：单行计算（calculate*）与多行汇总（buildFullChannelRecord）
 */

import { getChannelLineItems } from '@/domain/channel/channelAggregates.js'

export const initialHeaderForm = {
  channelName: '',
  partnerName: '',
  settlementMonth: '',
  invoiceStatus: 'pending_invoice',
  startDate: '',
  endDate: '',
  remark: '',
  status: 'pending',
  serverCost: '',
  discountType: '',
  channelFeeRate: '',
  devShareRate: '',
  profitRate: ''
}

export function initialLineItem() {
  return {
    id: '',
    settlementCycle: '',
    gameName: '',
    flow: '',
    discountFactor: '1',
    voucherCost: '',
    noWorryCost: '',
    refundCost: '',
    testCost: '',
    welfareCost: '',
    coinCost: '',
    shareRate: '30',
    taxRate: '5',
    channelFeeRate: '',
    gatewayCost: '',
    calculationMode: '',
    settlementAmount: ''
  }
}

export function normalizeChannelSettlementCycle(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  let match = raw.match(/^(20\d{2})[-/.](0?[1-9]|1[0-2])$/)
  if (!match) match = raw.match(/^(20\d{2})年\s*(0?[1-9]|1[0-2])月?$/)
  if (!match) return raw
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
}

function monthDateRange(month) {
  const normalized = normalizeChannelSettlementCycle(month)
  const match = normalized.match(/^(20\d{2})-(\d{2})$/)
  if (!match) return { startDate: '', endDate: '' }
  const year = Number(match[1])
  const monthNumber = Number(match[2])
  const lastDay = new Date(year, monthNumber, 0).getDate()
  return {
    startDate: `${match[1]}-${match[2]}-01`,
    endDate: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`
  }
}

export function channelSettlementPeriodFromLines(lines, fallbackMonth = '') {
  const months = [...new Set(
    (lines || [])
      .map((line) => normalizeChannelSettlementCycle(line?.settlementCycle))
      .filter((value) => /^(20\d{2})-(\d{2})$/.test(value))
  )].sort()
  const fallback = normalizeChannelSettlementCycle(fallbackMonth)
  if (months.length === 0 && /^(20\d{2})-(\d{2})$/.test(fallback)) months.push(fallback)
  if (months.length === 0) {
    return { months: [], firstMonth: '', lastMonth: '', settlementMonth: '', startDate: '', endDate: '' }
  }
  const firstMonth = months[0]
  const lastMonth = months[months.length - 1]
  return {
    months,
    firstMonth,
    lastMonth,
    settlementMonth: lastMonth,
    startDate: monthDateRange(firstMonth).startDate,
    endDate: monthDateRange(lastMonth).endDate
  }
}

export function channelStatusForSubmit(currentStatus, intent) {
  if (intent === 'confirm') return 'confirmed'
  return currentStatus || 'pending'
}

export const initialForm = {
  ...initialHeaderForm,
  ...initialLineItem()
}

export function resolveDiscountFactor(data) {
  const raw = data.discountFactor
  if (raw === '' || raw === undefined || raw === null) return 1
  const n = parseFloat(String(raw))
  if (!Number.isFinite(n) || n <= 0) return 1
  return n
}

export function effectiveLineFlowFromFormData(data) {
  const raw = parseFloat(data.flow || 0)
  const fac = resolveDiscountFactor(data)
  return Math.round(raw * fac * 100) / 100
}

export function calculateBillingAmount(data) {
  const flow = effectiveLineFlowFromFormData(data)
  const voucher = parseFloat(data.voucherCost || 0)
  const noWorry = parseFloat(data.noWorryCost || 0)
  const refund = parseFloat(data.refundCost || 0)
  const test = parseFloat(data.testCost || 0)
  const welfare = parseFloat(data.welfareCost || 0)
  const coin = parseFloat(data.coinCost || 0)
  return flow - voucher - noWorry - refund - test - welfare - coin
}

export function calculateShareAmount(data) {
  const billingAmount = calculateBillingAmount(data)
  const shareRate = parseFloat(data.shareRate || 0) / 100
  return billingAmount * shareRate
}

export function calculateSettlement(data) {
  const shareAmount = calculateShareAmount(data)
  if (data.calculationMode === 'channel_statement') {
    const channelFeeRate = parseFloat(data.channelFeeRate || 0) / 100
    const coin = parseFloat(data.coinCost || 0)
    const taxRate = parseFloat(data.taxRate || 0) / 100
    return (shareAmount * (1 - channelFeeRate) + coin * 0.2) * (1 - taxRate)
  }
  const gatewayCost = parseFloat(data.gatewayCost || 0)
  const taxRate = parseFloat(data.taxRate || 0) / 100
  const taxAmount = shareAmount * taxRate
  return shareAmount - gatewayCost - taxAmount
}

function resolveSettlementAmount(fd) {
  const auto = calculateSettlement(fd)
  const raw = fd.settlementAmount
  if (raw === '' || raw === undefined || raw === null) return Math.round(auto * 100) / 100
  const parsed = parseFloat(raw)
  if (!Number.isFinite(parsed)) return Math.round(auto * 100) / 100
  return Math.round(parsed * 100) / 100
}

export function buildLineRecordFromForm(fd) {
  const discountFactor = resolveDiscountFactor(fd)
  const effectiveFlow = effectiveLineFlowFromFormData(fd)
  const billingAmount = calculateBillingAmount(fd)
  const shareAmount = calculateShareAmount(fd)
  const settlementAmount = resolveSettlementAmount(fd)
  return {
    settlementCycle: normalizeChannelSettlementCycle(fd.settlementCycle || fd.settlementMonth),
    gameName: fd.gameName != null ? String(fd.gameName) : '',
    flow: parseFloat(fd.flow || 0),
    discountFactor,
    effectiveFlow,
    voucherCost: parseFloat(fd.voucherCost || 0),
    noWorryCost: parseFloat(fd.noWorryCost || 0),
    refundCost: parseFloat(fd.refundCost || 0),
    testCost: parseFloat(fd.testCost || 0),
    welfareCost: parseFloat(fd.welfareCost || 0),
    coinCost: parseFloat(fd.coinCost || 0),
    billingAmount: Math.round(billingAmount * 100) / 100,
    shareRate: parseFloat(fd.shareRate || 0),
    shareAmount: Math.round(shareAmount * 100) / 100,
    taxRate: parseFloat(fd.taxRate || 0),
    channelFeeRate: parseFloat(fd.channelFeeRate || 0),
    gatewayCost: parseFloat(fd.gatewayCost || 0),
    calculationMode: fd.calculationMode || '',
    settlementAmount
  }
}

function parseOptionalNum(v) {
  if (v === '' || v === undefined || v === null) return null
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

export function buildFullChannelRecord(headerForm, lineFormList) {
  const items = lineFormList.map((row) => buildLineRecordFromForm(row))
  const sum = (getter) => items.reduce((s, it) => s + (getter(it) || 0), 0)
  const period = channelSettlementPeriodFromLines(items, headerForm.settlementMonth)
  return {
    channelName: headerForm.channelName,
    partnerName: headerForm.partnerName || '',
    settlementMonth: period.settlementMonth || normalizeChannelSettlementCycle(headerForm.settlementMonth),
    invoiceStatus: headerForm.invoiceStatus || 'pending_invoice',
    invoice_status: headerForm.invoiceStatus || 'pending_invoice',
    startDate: period.startDate || headerForm.startDate || '',
    endDate: period.endDate || headerForm.endDate || '',
    remark: headerForm.remark || '',
    status: headerForm.status || 'pending',
    serverCost: parseOptionalNum(headerForm.serverCost),
    discountType: headerForm.discountType || null,
    channelFeeRate: parseOptionalNum(headerForm.channelFeeRate),
    devShareRate: parseOptionalNum(headerForm.devShareRate),
    profitRate: parseOptionalNum(headerForm.profitRate),
    items,
    gameName: items.map((i) => i.gameName).filter(Boolean).join('、'),
    rawFlowTotal: sum((i) => i.flow),
    flow: sum((i) => i.effectiveFlow),
    voucherCost: sum((i) => i.voucherCost),
    noWorryCost: sum((i) => i.noWorryCost),
    refundCost: sum((i) => i.refundCost),
    testCost: sum((i) => i.testCost),
    welfareCost: sum((i) => i.welfareCost),
    coinCost: sum((i) => i.coinCost),
    billingAmount: sum((i) => i.billingAmount),
    shareAmount: sum((i) => i.shareAmount),
    taxRate: items.length ? items[0].taxRate : 0,
    shareRate: items.length ? items[0].shareRate : 0,
    gatewayCost: sum((i) => i.gatewayCost),
    settlementAmount: sum((i) => i.settlementAmount)
  }
}

export function buildChannelBillFromSingleGameForm(fd) {
  const cycle = normalizeChannelSettlementCycle(fd.settlementCycle || fd.settlementMonth)
  return buildFullChannelRecord(
    {
      channelName: fd.channelName,
      partnerName: fd.partnerName || '',
      settlementMonth: cycle,
      invoiceStatus: fd.invoiceStatus || 'pending_invoice',
      startDate: fd.startDate || '',
      endDate: fd.endDate || '',
      remark: fd.remark || '',
      status: 'pending',
      serverCost: '',
      discountType: '',
      channelFeeRate: '',
      devShareRate: '',
      profitRate: ''
    },
    [{ ...fd, settlementCycle: cycle }]
  )
}

export function buildRecordFromForm(fd) {
  const line = buildLineRecordFromForm(fd)
  return {
    ...fd,
    ...line,
    channelName: fd.channelName,
    startDate: fd.startDate,
    endDate: fd.endDate,
    remark: fd.remark
  }
}

export function recordToHeaderForm(record) {
  return {
    channelName: record.channelName || '',
    partnerName: record.partnerName || '',
    settlementMonth: record.settlementMonth || '',
    invoiceStatus: record.invoiceStatus || record.invoice_status || 'pending_invoice',
    startDate: record.startDate || '',
    endDate: record.endDate || '',
    remark: record.remark || '',
    status: record.status || 'pending',
    serverCost: record.serverCost != null && record.serverCost !== '' ? String(record.serverCost) : '',
    discountType: record.discountType != null ? String(record.discountType) : '',
    channelFeeRate: record.channelFeeRate != null && record.channelFeeRate !== '' ? String(record.channelFeeRate) : '',
    devShareRate: record.devShareRate != null && record.devShareRate !== '' ? String(record.devShareRate) : '',
    profitRate: record.profitRate != null && record.profitRate !== '' ? String(record.profitRate) : ''
  }
}

export function recordToLineForms(record) {
  return getChannelLineItems(record).map((line) => ({
    id: line.id != null ? String(line.id) : '',
    settlementCycle: normalizeChannelSettlementCycle(line.settlementCycle || record.settlementMonth),
    gameName: line.gameName || '',
    flow: String(line.flow ?? ''),
    discountFactor: line.discountFactor !== undefined && line.discountFactor !== null ? String(line.discountFactor) : '1',
    voucherCost: String(line.voucherCost ?? ''),
    noWorryCost: String(line.noWorryCost ?? ''),
    refundCost: String(line.refundCost ?? ''),
    testCost: String(line.testCost ?? ''),
    welfareCost: String(line.welfareCost ?? ''),
    coinCost: String(line.coinCost ?? ''),
    shareRate: String(line.shareRate ?? '30'),
    taxRate: String(line.taxRate ?? '5'),
    channelFeeRate: String(line.channelFeeRate ?? ''),
    gatewayCost: String(line.gatewayCost ?? ''),
    calculationMode: line.calculationMode || '',
    settlementAmount: String(line.settlementAmount ?? '')
  }))
}

export function recordToFormData(record) {
  const h = recordToHeaderForm(record)
  const lines = recordToLineForms(record)
  const first = lines[0] || initialLineItem()
  return { ...h, ...first }
}
