const DRAFT_PREFIX = 'caiwu:bill-draft:v1'

function text(value) {
  return value == null ? '' : String(value).trim()
}

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 1000000) / 1000000 : fallback
}

function normalizeRdLine(line = {}) {
  return {
    settlementCycle: text(line.settlementCycle),
    gameName: text(line.gameName),
    revenue: number(line.revenue),
    discountRate: number(line.discountRate, 1),
    couponAmount: number(line.couponAmount),
    testFee: number(line.testFee),
    extraFee: number(line.extraFee),
    shareRatio: number(line.shareRatio, 15),
    taxRate: number(line.taxRate),
    sortOrder: Number.isFinite(Number(line.sortOrder)) ? Number(line.sortOrder) : 0
  }
}

function normalizeChannelLine(line = {}) {
  return {
    settlementCycle: text(line.settlementCycle),
    gameName: text(line.gameName),
    flow: number(line.flow),
    discountFactor: number(line.discountFactor, 1),
    voucherCost: number(line.voucherCost),
    noWorryCost: number(line.noWorryCost),
    refundCost: number(line.refundCost),
    testCost: number(line.testCost),
    welfareCost: number(line.welfareCost),
    shareRate: number(line.shareRate),
    taxRate: number(line.taxRate),
    gatewayCost: number(line.gatewayCost),
    settlementAmount: number(line.settlementAmount)
  }
}

export function normalizeRdDraft(record = {}) {
  return {
    settlementMonth: text(record.settlementMonth),
    settlementNumber: text(record.settlementNumber),
    partnerId: text(record.partnerId),
    partner: text(record.partner),
    channelFeeRate: number(record.channelFeeRate),
    memo: text(record.memo),
    status: text(record.status) || 'pending',
    items: Array.isArray(record.items) ? record.items.map(normalizeRdLine) : []
  }
}

export function normalizeChannelDraft(record = {}) {
  return {
    settlementMonth: text(record.settlementMonth),
    channelName: text(record.channelName),
    partnerName: text(record.partnerName),
    remark: text(record.remark),
    status: text(record.status) || 'pending',
    items: Array.isArray(record.items) ? record.items.map(normalizeChannelLine) : []
  }
}

export function isMeaningfulRdDraft(record = {}) {
  const normalized = normalizeRdDraft(record)
  if (
    normalized.settlementNumber ||
    normalized.partnerId ||
    normalized.partner ||
    normalized.memo ||
    normalized.channelFeeRate !== 0
  ) {
    return true
  }
  return normalized.items.some(
    (line) =>
      line.gameName ||
      line.revenue !== 0 ||
      line.couponAmount !== 0 ||
      line.testFee !== 0 ||
      line.extraFee !== 0 ||
      line.shareRatio !== 15 ||
      line.taxRate !== 0 ||
      line.discountRate !== 1
  )
}

export function isMeaningfulChannelDraft(record = {}) {
  const normalized = normalizeChannelDraft(record)
  if (
    normalized.settlementMonth ||
    normalized.channelName ||
    normalized.partnerName ||
    normalized.remark
  ) {
    return true
  }
  return normalized.items.some(
    (line) =>
      line.gameName ||
      line.flow !== 0 ||
      line.voucherCost !== 0 ||
      line.noWorryCost !== 0 ||
      line.refundCost !== 0 ||
      line.testCost !== 0 ||
      line.welfareCost !== 0 ||
      line.shareRate !== 0 ||
      line.taxRate !== 0 ||
      line.gatewayCost !== 0 ||
      line.discountFactor !== 1 ||
      line.settlementAmount !== 0
  )
}

export function areNormalizedDraftsEqual(left, right, normalize) {
  return JSON.stringify(normalize(left || {})) === JSON.stringify(normalize(right || {}))
}

export function billDraftKey(type, mode, recordId = '') {
  const suffix = mode === 'edit' ? `edit:${text(recordId)}` : 'create'
  return `${DRAFT_PREFIX}:${type}:${suffix}`
}

export function readBillDraft(key) {
  if (typeof window === 'undefined' || !key) return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || 'null')
    if (!parsed || typeof parsed !== 'object' || !parsed.record) return null
    return {
      record: parsed.record,
      savedAt: Number(parsed.savedAt) || 0,
      baseVersion: text(parsed.baseVersion)
    }
  } catch {
    return null
  }
}

export function writeBillDraft(key, record, baseVersion = '') {
  if (typeof window === 'undefined' || !key) return 0
  const savedAt = Date.now()
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ record, savedAt, baseVersion: text(baseVersion) })
    )
    return savedAt
  } catch {
    return 0
  }
}

export function clearBillDraft(key) {
  if (typeof window === 'undefined' || !key) return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}
