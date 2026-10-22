import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  CHANNEL_RULE_PRESETS,
  XIAN_WEIZHEN_9917_RULE,
  ANJIU_PRE_DISCOUNT_DEDUCTION_RULE,
  applyAnjiuVoucherInference,
  initialHeaderForm,
  initialLineItem,
  calculateBillingAmount,
  calculateShareAmount,
  calculateSettlementDetails,
  effectiveLineFlowFromFormData,
  buildFullChannelRecord,
  channelSettlementPeriodFromLines,
  channelStatusForSubmit,
  normalizeChannelSettlementCycle,
  recordToHeaderForm,
  recordToLineForms,
  applyChannelRulePreset,
  applyTargetedChannelRule,
  resolveChannelLineRuleHeader,
  detectChannelRulePreset,
  ruleFormulaText
} from '@/domain/channel/channelBillingForm.js'
import { applyCommercialDiscountFromGameName } from '@/domain/channel/channelLineDefaults.js'
import {
  isAiquChannel,
  resolveRevenueBasis,
  previewRevenueBasisChange,
  applyRevenueBasisChange
} from '@/domain/channel/channelRevenueBasis.js'
import { isBillLockedStatus } from '@/domain/reconciliation/billLifecycle.js'
import { linesWithChannelLineContractFees } from '@/domain/channel/channelLineContractFee.js'
import { isSameCustomerRestoration } from '@/domain/channel/channelContractInlineReview.js'
import { recommendChannelContractRules } from '@/lib/api/contractTerms.ts'
import {
  channelDifferenceLabel,
  createChannelDifferenceNote,
  describeChannelDifference,
  potentialDoubleAdjustment,
  upsertChannelDifferenceNote
} from '@/domain/channel/channelDifferenceReview.js'
import {
  getVoucherEntry,
  getVoucherEntryPreview,
  setVoucherEntryAmount,
  setVoucherEntryMode
} from '@/domain/channel/channelVoucherEntry.js'
import '@/components/ChannelBilling.css'
import './ChannelSettlementRule.css'
import './ChannelOptionalSections.css'
import './ChannelVoucherCompact.css'
import LineItemsTable from '@/components/shared/LineItemsTable.jsx'
import PartnerPicker, { findExactPartner } from '@/components/shared/PartnerPicker.jsx'
import ChannelContractIssueEditor from '@/components/channel/ChannelContractIssueEditor.jsx'

function formatMoney(amount) {
  const value = Number(amount || 0)
  if (Math.abs(value) >= 100000000) return `¥${(value / 100000000).toFixed(2)}亿`
  if (Math.abs(value) >= 10000) return `¥${(value / 10000).toFixed(2)}万`
  return `¥${value.toFixed(2)}`
}

function periodSummary(lines) {
  const period = channelSettlementPeriodFromLines(lines)
  if (!period.months.length) return '每行选择自己的结算月份'
  const label = (value) => String(value || '').replace('-', '.')
  if (period.months.length === 1) return `${label(period.firstMonth)} · 1个月`
  return `${label(period.firstMonth)} – ${label(period.lastMonth)} · ${period.months.length}个月`
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthDistance(olderMonth, newerMonth) {
  const older = String(olderMonth || '').match(/^(20\d{2})-(\d{2})$/)
  const newer = String(newerMonth || '').match(/^(20\d{2})-(\d{2})$/)
  if (!older || !newer) return 0
  return (Number(newer[1]) - Number(older[1])) * 12 + Number(newer[2]) - Number(older[2])
}

function settlementMonthRisk(value, current = currentMonth()) {
  const month = normalizeChannelSettlementCycle(value)
  if (!/^(20\d{2})-(\d{2})$/.test(month)) return 'normal'
  if (month > current) return 'future'
  return monthDistance(month, current) >= 12 ? 'history' : 'normal'
}

function recordMonths(record) {
  const values = (Array.isArray(record?.items) ? record.items : [])
    .map((item) => normalizeChannelSettlementCycle(item?.settlementCycle))
    .filter((value) => /^(20\d{2})-(\d{2})$/.test(value))
  if (!values.length) {
    const fallback = normalizeChannelSettlementCycle(record?.settlementMonth)
    if (/^(20\d{2})-(\d{2})$/.test(fallback)) values.push(fallback)
  }
  return [...new Set(values)].sort()
}

function monthListLabel(values) {
  return (values || []).map((value) => {
    const match = String(value || '').match(/^(20\d{2})-(\d{2})$/)
    return match ? `${match[1]}年${Number(match[2])}月` : value
  }).join('、') || '未填写'
}

function validationText(status) {
  return { pass: '一致', fail: '差异', partial: '部分校验', unvalidated: '未校验' }[status] || '未校验'
}

function contractRuleLabel(state) {
  if (state.loading) return '正在读取合同清单…'
  if (state.tone === 'applied') return '合同规则已应用'
  if (state.tone === 'review') return '合同规则待确认'
  if (state.tone === 'error') return '技术异常 · 合同规则读取失败'
  return '合同规则自动匹配'
}

function emptyContractRuleState() {
  return { loading: false, tone: 'idle', message: '', contracts: [], recommendation: null, fingerprint: '' }
}

function sameNumber(left, right, tolerance = 0.0001) {
  if (left == null || right == null || String(left).trim() === '' || String(right).trim() === '') return false
  const a = Number(left)
  const b = Number(right)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance
}

function canAutoApplyContractRules(mode, status) {
  if (mode === 'add') return true
  if (mode !== 'edit') return false
  return String(status || 'pending').trim().toLowerCase() !== 'confirmed'
}

function identityRows(lines) {
  return (lines || []).map((row, index) => ({
    line_index: index,
    ...(row.contractAccessItemId ? { access_item_id: row.contractAccessItemId } : {}),
    game_name: String(row.gameName || '').trim(),
    settlement_cycle: normalizeChannelSettlementCycle(row.settlementCycle)
  })).filter((row) => row.game_name && row.settlement_cycle)
}

function recommendationFingerprint(partnerName, channelName, lines, partnerId = '') {
  return JSON.stringify({
    partnerId: String(partnerId || '').trim(),
    partnerName: String(partnerName || '').trim(),
    channelName: String(channelName || '').trim(),
    lines: identityRows(lines).map((row) => [row.line_index, row.game_name, row.settlement_cycle, row.access_item_id || null])
  })
}

function fallbackHeader(base) {
  const preset = detectChannelRulePreset(base.channelName || base.partnerName)
  if (preset) return applyChannelRulePreset(base, preset)
  return {
    ...base,
    settlementRuleCode: 'legacy_fixed_fee_tax',
    channelFeeMode: 'fixed',
    channelFeeRate: '',
    taxMode: 'share'
  }
}

function clearLineContractRule(row) {
  return {
    ...row,
    settlementRuleCode: '',
    channelFeeMode: '',
    channelFeeRate: '',
    taxMode: '',
    validationTolerance: ''
  }
}

function applyContractRecommendationToLine(row, recommendation) {
  if (!recommendation) return clearLineContractRule(row)
  return {
    ...row,
    shareRate: recommendation.share_rate != null ? String(recommendation.share_rate) : row.shareRate,
    taxRate: recommendation.tax_rate != null ? String(recommendation.tax_rate) : row.taxRate,
    discountFactor: recommendation.discount_factor != null ? String(recommendation.discount_factor) : row.discountFactor,
    settlementRuleCode: recommendation.settlement_rule_code || '',
    channelFeeMode: recommendation.channel_fee_mode || '',
    channelFeeRate: recommendation.channel_fee_rate != null ? String(recommendation.channel_fee_rate) : '',
    taxMode: recommendation.tax_mode || '',
    validationTolerance: recommendation.validation_tolerance != null ? String(recommendation.validation_tolerance) : '',
    gatewayCost: recommendation.channel_fee_mode === 'fixed' ? row.gatewayCost : ''
  }
}

function clearHeaderChannelFeeForMixedLines(header) {
  const targeted = applyTargetedChannelRule(header)
  if (targeted.settlementRuleCode === XIAN_WEIZHEN_9917_RULE) return header
  return {
    ...header,
    channelFeeMode: 'none',
    channelFeeRate: '',
    settlementRuleCode: targeted.settlementRuleCode === ANJIU_PRE_DISCOUNT_DEDUCTION_RULE
      ? ANJIU_PRE_DISCOUNT_DEDUCTION_RULE
      : 'custom'
  }
}

// Use immutable loaded records, never the editable header status, to decide
// whether an existing financial record may change its monetary input basis.
export function isRevenueBasisChangeLocked({ mode = 'add', sourceRecord, draftRecord, recordId } = {}) {
  if (!['add', 'edit'].includes(mode)) return true
  if (mode === 'edit' && recordId && !sourceRecord) return true
  return [sourceRecord, draftRecord].filter(Boolean).some((record) => (
    isBillLockedStatus(record.status)
    || Number(record.receivedAmount ?? record.received_amount ?? 0) > 0
    // A zero receivable may be labelled paid without any cash receipt.
    // Display-only receiptStatus is not evidence of received/核销 funds.
    || (Array.isArray(record.receipts) && record.receipts.length > 0)
    || (Array.isArray(record.bankMatches) && record.bankMatches.some(match => match.status === 'confirmed'))
  ))
}

export function ChannelRevenueBasisSelector({ row, header, index, locked, onRequest }) {
  if (!isAiquChannel(header)) return null
  const basis = resolveRevenueBasis(row)
  return (
    <div style={{ display: 'grid', gap: 3, marginTop: 4 }}>
      <select
        value={basis}
        disabled={locked}
        aria-label={`第${index + 1}行流水口径`}
        title={locked ? '已确认、已收款或已核销账单不能转换流水口径' : '选择后先预览，点击应用才更改本行口径；不换算录入数字'}
        style={{ width: '100%', minWidth: 118, fontSize: 11 }}
        onChange={(event) => onRequest(event.target.value)}
      >
        <option value="pre_discount">折前原始流水</option>
        <option value="post_discount">已折后流水</option>
      </select>
      <small style={{ fontSize: 10, color: '#596579', whiteSpace: 'normal' }}>
        {basis === 'post_discount' ? '不再乘游戏折扣' : '录入流水 × 游戏折扣'}
      </small>
    </div>
  )
}

export function ChannelRevenueBasisPreview({ row, header, index, nextBasis, voucherFaceReviewed = false, locked = false, onVoucherReview, onApply, onCancel }) {
  if (!row || !isAiquChannel(header)) return null
  const preview = previewRevenueBasisChange(row, nextBasis, header)
  const changed = applyRevenueBasisChange(row, nextBasis, header)
  const before = calculateSettlementDetails(row, header)
  const after = calculateSettlementDetails(changed, header)
  const needsVoucherReview = nextBasis === 'post_discount' && preview.requiresVoucherReview
  const money = (value) => `¥${Number(value || 0).toFixed(2)}`
  const label = (basis) => basis === 'post_discount' ? '已折后流水' : '折前原始流水'
  return (
    <section className="channel-rule-panel" aria-label={`第${index + 1}行流水口径变更预览`}>
      <div style={{ display: 'grid', gap: 8, padding: 12 }}>
        <strong>第{index + 1}行 · {row.gameName || '未填写游戏'}：{label(preview.fromBasis)} → {label(preview.toBasis)}（尚未应用）</strong>
        <span>录入流水保持 {money(preview.inputFlow)}；游戏折扣保留 {row.discountFactor || '1'}，不改成 1，也不自动换算录入数字。</span>
        <span>参与结算流水：{money(preview.beforeEffectiveFlow)} → {money(preview.afterEffectiveFlow)}</span>
        <span>系统结算：{money(before.systemSettlementAmount)} → {money(after.systemSettlementAmount)}</span>
        <small>{nextBasis === 'post_discount' ? '输入已折后流水，游戏折扣仅版本参考；代金券若已折后请选择直扣；其他扣减均实际金额。' : '输入折前原始流水，参与结算流水将按保留的游戏折扣换算；代金券口径不随流水口径自动改变。'}</small>
        {needsVoucherReview ? (
          <div style={{ display: 'grid', gap: 6, padding: 10, background: '#fff8e6', color: '#775517' }}>
            <span>本行仍有折算券原始面额 {money(row.voucherFaceValue)}。若这笔券已经折后，请先在本行「代金券口径」单独选择「直扣」，再应用流水口径。</span>
            <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={voucherFaceReviewed} disabled={locked} onChange={(event) => onVoucherReview(event.target.checked)} />
              <span>我确认现有折算券是原始面额，继续按游戏折扣换算，不改为直扣。</span>
            </label>
          </div>
        ) : null}
        {locked ? <span role="alert">已确认、已收款或已核销账单不能转换流水口径，原值保持不变。</span> : null}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="rec-btn rec-btn--primary rec-btn--small" disabled={locked || (needsVoucherReview && !voucherFaceReviewed)} onClick={onApply}>应用本行流水口径</button>
          <button type="button" className="rec-btn rec-btn--ghost rec-btn--small" onClick={onCancel}>取消，保留原口径</button>
        </div>
      </div>
    </section>
  )
}

function ChannelBillingForm({
  formId,
  mode = 'add',
  recordId = null,
  sourceRecord = null,
  draftRecord = null,
  onAddRecord,
  onUpdateRecord,
  submitIntentRef,
  onAfterSubmit,
  onPreviewChange,
  onFormStateChange,
  onError,
  partners = [],
  onAddPartner,
  createPrefillPartner = null,
  className = ''
}) {
  const [header, setHeader] = useState(initialHeaderForm)
  const [lines, setLines] = useState([initialLineItem()])
  // Expanded editor is ephemeral UI state; the persisted two voucher fields
  // remain the source of truth, and existing mixed rows always show both.
  const [expandedVoucherRows, setExpandedVoucherRows] = useState({})
  const [revenueBasisChange, setRevenueBasisChange] = useState(null)
  const revenueBasisPreviewRef = useRef(null)
  const [adjustmentExpanded, setAdjustmentExpanded] = useState(false)
  const [remarksExpanded, setRemarksExpanded] = useState(false)
  const [partnerId, setPartnerId] = useState('')
  const [contractRuleState, setContractRuleState] = useState(emptyContractRuleState)
  const [contractRuleRevision, setContractRuleRevision] = useState(0)
  const [lastContractRuleKey, setLastContractRuleKey] = useState('')
  const [contractOverrideReason, setContractOverrideReason] = useState('')
  const [contractIssueTarget, setContractIssueTarget] = useState(null)
  const [differenceReviewStatus, setDifferenceReviewStatus] = useState('pending')
  const [differenceReviewReason, setDifferenceReviewReason] = useState('')
  const [differenceNoteWritten, setDifferenceNoteWritten] = useState(false)
  const currentMonthKey = currentMonth()
  const liveContractForm = useRef(null)
  liveContractForm.current = { header, lines, partnerId }

  const linesForSettlement = useMemo(
    () => linesWithChannelLineContractFees(lines, header),
    [lines, header]
  )
  const fullRecord = useMemo(
    () => buildFullChannelRecord({ ...header, status: header.status || 'pending' }, linesForSettlement),
    [header, linesForSettlement]
  )
  const previewSettlement = Number(fullRecord.settlementAmount || 0)
  const totals = useMemo(() => ({
    rawFlow: Number(fullRecord.rawFlowTotal || 0),
    effectiveFlow: Number(fullRecord.flow || 0),
    voucher: Number(fullRecord.voucherCost || 0),
    refund: Number(fullRecord.refundCost || 0),
    system: Number(fullRecord.systemSettlementAmount || 0),
    platform: fullRecord.platformSettlementAmount,
    difference: fullRecord.settlementDifference,
    businessSettlement: Number(fullRecord.businessSettlementAmount ?? previewSettlement),
    adjustment: Number(fullRecord.settlementAdjustmentAmount || 0),
    afterAdjustment: Number(fullRecord.settlementCalculatedAfterAdjustment ?? previewSettlement),
    adjustmentTail: Number(fullRecord.settlementAdjustmentTail || 0),
    settlement: previewSettlement,
    validationStatus: fullRecord.validationStatus || 'unvalidated'
  }), [fullRecord, previewSettlement])

  const adjustmentActive = Math.abs(Number(header.settlementAdjustmentAmount || 0)) > 0.0001 || String(header.settlementFinalOverride ?? '').trim() !== ''
  const differenceReview = useMemo(() => describeChannelDifference(fullRecord), [fullRecord])
  const hasDifferenceToReview = ['higher', 'lower', 'offsetting'].includes(differenceReview.kind)
  const repeatedDifferenceAdjustment = potentialDoubleAdjustment(differenceReview, header.settlementAdjustmentAmount)
  const hasAdjustmentTypeWithoutAmount = Boolean(header.settlementAdjustmentType) && !adjustmentActive

  const selectedPartner = useMemo(() => {
    if (partnerId) {
      const byId = (partners || []).find((partner) => String(partner?.id || '') === String(partnerId))
      if (byId) return byId
    }
    // Existing records predate stable partner IDs. Restore their link by exact name only
    // in edit mode; a new bill must be explicitly selected from PartnerPicker.
    if (mode === 'edit') return findExactPartner(partners, header.partnerName || header.channelName)
    return null
  }, [partners, partnerId, header.partnerName, header.channelName, mode])

  const effectiveRuleHeader = applyTargetedChannelRule(header)
  const aiquChannel = isAiquChannel(header)
  const revenueBasisLocked = isRevenueBasisChangeLocked({ mode, sourceRecord, draftRecord, recordId })
  const feeMode = effectiveRuleHeader.channelFeeMode || 'fixed'
  const targetedRuleLocked = effectiveRuleHeader.settlementRuleCode === XIAN_WEIZHEN_9917_RULE
  const contractAwareMode = mode === 'add' || mode === 'edit'
  const autoApplyContractRules = canAutoApplyContractRules(mode, header.status)
  const lineRuleSignatures = useMemo(() => new Set(
    linesForSettlement
      .filter((row) => String(row.channelFeeMode || row.taxMode || row.settlementRuleCode || '').trim())
      .map((row) => {
        const rule = resolveChannelLineRuleHeader(row, effectiveRuleHeader)
        return `${rule.settlementRuleCode || ''}|${rule.channelFeeMode || ''}|${rule.channelFeeRate ?? ''}|${rule.taxMode || ''}`
      })
  ), [linesForSettlement, effectiveRuleHeader])
  const mixedLineContractRules = lineRuleSignatures.size > 1

  const contractRuleNeedsOverride = useMemo(() => {
    if (!contractAwareMode || targetedRuleLocked) return false
    const result = contractRuleState.recommendation
    if (!result) return false
    if (result.partner_rule_status === 'none') return false
    for (let index = 0; index < lines.length; index += 1) {
      const row = lines[index]
      if (!String(row.gameName || '').trim() || !normalizeChannelSettlementCycle(row.settlementCycle)) continue
      const item = (result.lines || []).find((candidate) => candidate.line_index === index)
      // 未匹配到具体游戏合作清单时，只做“待确认”提示，不视为人工覆盖合同。
      if (!item?.match) continue
      const rec = item.auto_apply && item.recommended ? item.recommended : null
      if (!rec) continue
      const rowRule = resolveChannelLineRuleHeader(row, effectiveRuleHeader)
      if (rec.share_rate != null && !sameNumber(row.shareRate, rec.share_rate)) return true
      if (rec.tax_rate != null && !sameNumber(row.taxRate, rec.tax_rate)) return true
      if (rec.channel_fee_mode && rowRule.channelFeeMode !== rec.channel_fee_mode) return true
      if (rec.channel_fee_rate != null && !sameNumber(rowRule.channelFeeRate, rec.channel_fee_rate)) return true
      if (rec.tax_mode && rowRule.taxMode !== rec.tax_mode) return true
    }
    return false
  }, [contractAwareMode, contractRuleState.recommendation, effectiveRuleHeader, lines, targetedRuleLocked])

  useEffect(() => { onPreviewChange?.(previewSettlement) }, [previewSettlement, onPreviewChange])

  useEffect(() => {
    setRevenueBasisChange(null)
    const stateRecord = draftRecord || (mode === 'edit' ? sourceRecord : null)
    if (stateRecord) {
      // Restoring from a filtered channel list is an explicit customer choice,
      // not an unverified string copied from an old bill. Link its stable ID
      // only when the exact saved legal name still belongs to that customer.
      const linked = mode === 'add' && createPrefillPartner?.partnerId
        ? findExactPartner(partners, stateRecord.partnerName || stateRecord.channelName)
        : null
      setPartnerId(linked && String(linked.id) === String(createPrefillPartner.partnerId) ? String(linked.id) : '')
      setHeader(recordToHeaderForm(stateRecord))
      const lineForms = recordToLineForms(stateRecord)
      setLines(lineForms.length ? lineForms : [initialLineItem()])
      setContractRuleState(emptyContractRuleState())
      setLastContractRuleKey('')
      setContractOverrideReason('')
      setDifferenceReviewStatus('pending')
      setDifferenceReviewReason('')
      setDifferenceNoteWritten(false)
      return
    }
    setHeader({ ...initialHeaderForm })
    setPartnerId('')
    setLines([{ ...initialLineItem() }])
    setContractRuleState(emptyContractRuleState())
    setLastContractRuleKey('')
    setContractOverrideReason('')
    setDifferenceReviewStatus('pending')
    setDifferenceReviewReason('')
    setDifferenceNoteWritten(false)
  }, [mode, sourceRecord?.id, draftRecord, createPrefillPartner?.partnerId])

  useEffect(() => {
    if (revenueBasisChange) {
      revenueBasisPreviewRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
      revenueBasisPreviewRef.current?.focus?.({ preventScroll: true })
    }
  }, [revenueBasisChange?.index, revenueBasisChange?.nextBasis])

  useEffect(() => {
    // Legacy/edit records only: recover their stable customer link from the persisted
    // exact name. New bills are intentionally excluded so typing cannot impersonate
    // an explicit selection.
    if (mode === 'add' || partnerId) return
    const matched = findExactPartner(partners, header.partnerName || header.channelName)
    if (!matched) return
    setPartnerId(String(matched.id || ''))
    setHeader((current) => applyTargetedChannelRule({ ...current, partnerName: current.partnerName || matched.name, channelName: current.channelName || matched.shortName || matched.name }))
  }, [partners, header.partnerName, header.channelName, partnerId, mode])

  useEffect(() => {
    if (!contractAwareMode) return undefined
    const partnerName = String(header.partnerName || '').trim()
    if (!partnerName) return undefined
    if (mode === 'add' && !partnerId) {
      setContractRuleState({
        ...emptyContractRuleState(),
        tone: 'review',
        message: '待选择合作方：请从客户库结果中明确选中后再读取合同规则。'
      })
      return undefined
    }

    const preciseLines = identityRows(lines)
    const fingerprint = recommendationFingerprint(partnerName, header.channelName, lines, partnerId)
    const requestKey = `${partnerId || 'legacy-edit'}:${fingerprint}:${contractRuleRevision}`
    if (requestKey === lastContractRuleKey) return undefined

    setContractRuleState((current) => ({
      ...current,
      loading: true,
      tone: 'idle',
      message: preciseLines.length ? '正在按合作方、游戏和账期匹配合同合作清单…' : '正在读取合作方合同清单默认结算规则…'
    }))

    let cancelled = false
    const timer = window.setTimeout(() => {
      recommendChannelContractRules({
        partner_name: partnerName,
        partner_id: partnerId || undefined,
        channel_name: String(header.channelName || '').trim(),
        lines: preciseLines.length ? preciseLines : [{ line_index: -1, game_name: '', settlement_cycle: '' }]
      })
        .then((result) => {
          if (cancelled) return
          const contractNames = [...new Set([
            ...(result.partner_contracts || []),
            ...(result.lines || []).map((item) => item.match?.contract_name).filter(Boolean)
          ])]
          setLastContractRuleKey(requestKey)

          const targeted = detectChannelRulePreset(header.partnerName || header.channelName) === XIAN_WEIZHEN_9917_RULE
          const preciseHeader = result.auto_apply && result.header_recommendation ? result.header_recommendation : null
          // A uniform partner-level rate is not evidence that an unmatched
          // game's rate is the same. Only use a baseline before a game is set.
          const baseline = !preciseLines.length && result.partner_auto_apply && result.partner_recommendation
            ? result.partner_recommendation
            : null
          const chosenHeader = preciseHeader || baseline
          const lineRecommendations = new Map(
            (result.lines || [])
              .filter((item) => item.match && item.auto_apply && item.recommended)
              .map((item) => [item.line_index, item.recommended])
          )
          const unmatchedPreciseLines = preciseLines.filter((line) => {
            const item = (result.lines || []).find((candidate) => candidate.line_index === line.line_index)
            return !item?.match
          })
          const hasUnmatchedPreciseLines = unmatchedPreciseLines.length > 0
          const allPreciseLinesApplied = preciseLines.length > 0 && preciseLines.every((line) => lineRecommendations.has(line.line_index))

          // 新增账单：可使用合作方默认规则兜底。
          // 待核对/未确认的编辑账单：只有精确匹配到“游戏 + 账期”时才自动套用，避免通用规则误套。
          // 已确认账单：仍保持历史快照，只做比较，不自动覆盖。
          if (autoApplyContractRules) {
            const appliedSignatures = new Set()
            setLines((current) => current.map((row, index) => {
              const preciseRec = lineRecommendations.get(index)
              let next = row
              if (preciseRec) next = applyContractRecommendationToLine(row, preciseRec)
              else if (mode === 'add' && baseline && !String(row.gameName || '').trim()) next = applyContractRecommendationToLine(row, baseline)
              next = applyCommercialDiscountFromGameName(next)
              const rule = resolveChannelLineRuleHeader(next, applyTargetedChannelRule(header))
              appliedSignatures.add(`${rule.settlementRuleCode || ''}|${rule.channelFeeMode || ''}|${rule.channelFeeRate ?? ''}`)
              return next
            }))
            if (appliedSignatures.size > 1) {
              setHeader((current) => clearHeaderChannelFeeForMixedLines(current))
            }
          }

          if (chosenHeader) {
            if (mode === 'add') {
              setHeader((current) => targeted ? applyTargetedChannelRule(current) : ({
                ...current,
                settlementRuleCode: chosenHeader.settlement_rule_code,
                channelFeeMode: chosenHeader.channel_fee_mode,
                channelFeeRate: String(chosenHeader.channel_fee_rate ?? ''),
                taxMode: chosenHeader.tax_mode,
                validationTolerance: String(chosenHeader.validation_tolerance ?? 0.05)
              }))
            }
            setContractRuleState({
              loading: false,
              tone: mode === 'edit'
                ? autoApplyContractRules && allPreciseLinesApplied ? 'applied' : 'review'
                : 'applied',
              message: mode === 'edit'
                ? !autoApplyContractRules
                  ? '已匹配当前最新合同规则；已确认账单原值保持不变，仅做核验。如需改成新口径，请人工修改并填写覆盖原因。'
                  : hasUnmatchedPreciseLines
                    ? '部分游戏未匹配到具体合作清单；未匹配行暂不视为业务差异，请先核对游戏名称或合同合作清单。已精确匹配的行已自动套用规则。'
                    : '已按当前游戏和账期自动套用合同规则并重新计算。'
                : preciseHeader
                  ? `${result.message}；当前明细已按具体合同合作清单填充并重新计算。`
                  : `${result.partner_rule_message}；选择游戏和账期后还会再次精确核对。`,
              contracts: contractNames,
              recommendation: result,
              fingerprint
            })
            return
          }

          if (result.partner_rule_status === 'none') {
            const linkedCatalog = result.contract_catalog
            const knownContracts = Number(linkedCatalog?.contract_count || 0)
            const knownItems = Number(linkedCatalog?.access_item_count || 0)
            const catalogNotice = knownContracts
              ? knownItems === 0
                ? `已找到 ${knownContracts} 份已录入合同，但尚未登记合作游戏清单。请到原合同下补入游戏及真实结算费率，无需重复新建合同。`
                : `已关联 ${knownContracts} 份合同及 ${knownItems} 条合作清单，但当前游戏或折扣版本未能匹配。请核对原合同下的游戏、渠道及授权期。`
              : ''
            if (mode === 'add') {
              setHeader((current) => targeted ? applyTargetedChannelRule(current) : ({
                ...current,
                settlementRuleCode: 'custom',
                channelFeeMode: 'none',
                channelFeeRate: '',
                taxMode: 'none'
              }))
              setLines((current) => current.map((row) => ({
                ...clearLineContractRule(row),
                shareRate: '',
                taxRate: ''
              })))
            }
            setContractRuleState({
              loading: false,
              tone: 'review',
              message: catalogNotice || (mode === 'edit'
                ? '未找到该合作方合同清单，已保留当前账单原有规则；这类“未匹配”不直接判为业务差异。'
                : '待补规则：未找到该合作方合同清单；新增账单的分成/税率/通道费保持空白，不使用历史值或30%/5%默认值。'),
              contracts: contractNames,
              recommendation: result,
              fingerprint
            })
            return
          }

          if (mode === 'add') {
            setHeader((current) => targeted ? applyTargetedChannelRule(current) : ({
              ...current,
              settlementRuleCode: 'custom',
              channelFeeMode: 'none',
              channelFeeRate: '',
              taxMode: 'none'
            }))
          }
          setContractRuleState({
            loading: false,
            tone: mode === 'edit'
              ? autoApplyContractRules && allPreciseLinesApplied ? 'applied' : 'review'
              : allPreciseLinesApplied ? 'applied' : 'review',
            message: mode === 'edit'
              ? !autoApplyContractRules
                ? '已读取最新合同清单用于核验；已确认账单规则不会自动覆盖。'
                : hasUnmatchedPreciseLines
                  ? '部分游戏未匹配到具体合作清单；未匹配行暂不视为业务差异，请先核对游戏名称或合同合作清单。已精确匹配的行已自动套用规则。'
                  : '已按当前游戏和账期自动套用合同规则并重新计算。'
              : allPreciseLinesApplied
                ? '本账单存在多套合同结算规则，已按每个游戏明细对应的合同分别计算；不会再把账单头部的统一通道费套到所有游戏。'
                : result.message || result.partner_rule_message || '待补规则：合同规则存在歧义，请按具体游戏和账期确认。',
            contracts: contractNames,
            recommendation: result,
            fingerprint
          })
        })
        .catch((error) => {
          if (cancelled) return
          setContractRuleState({
            loading: false,
            tone: 'error',
            message: error instanceof Error ? error.message : '技术异常：合同规则读取失败，请重新匹配后再保存。',
            contracts: [],
            recommendation: null,
            fingerprint: ''
          })
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [contractAwareMode, mode, partnerId, header.partnerName, header.channelName, header.status, lines, contractRuleRevision, lastContractRuleKey, autoApplyContractRules])

  const handleHeaderChange = (field, value) => setHeader((current) => ({ ...current, [field]: value }))
  const clearAllLineContractRules = () => setLines((current) => current.map(clearLineContractRule))
  const handleRuleFieldChange = (field, value) => {
    clearAllLineContractRules()
    setHeader((current) => ({ ...current, settlementRuleCode: 'custom', [field]: value }))
  }
  const handleRulePresetChange = (code) => {
    clearAllLineContractRules()
    setHeader((current) => applyChannelRulePreset(current, code))
  }

  const handlePartnerChange = (partnerName, nextPartnerId = '', selected = null) => {
    // PartnerPicker restores the exact customer ID after edit hydration. This
    // is not a customer change and must not erase saved contract evidence.
    const restoringSameCustomer = isSameCustomerRestoration({
      mode, currentName: header.partnerName, nextName: partnerName,
      currentId: partnerId, nextId: nextPartnerId,
      resolvedCurrentId: selectedPartner?.id, selected
    })
    const nextChannelName = restoringSameCustomer ? header.channelName : selected && nextPartnerId ? selected.shortName || selected.name : partnerName
    if (!isAiquChannel({ partnerName, channelName: nextChannelName }) && lines.some(row => resolveRevenueBasis(row) === 'post_discount')) {
      const message = '已折后流水仅适用于爱趣指定主体。请先逐行预览并切回折前原始流水，再更换合作方；当前账单未改变。'
      if (onError) onError(message)
      else window.alert(message)
      return
    }
    setRevenueBasisChange(null)
    setPartnerId(nextPartnerId)
    setLastContractRuleKey('')
    setContractRuleState(emptyContractRuleState())
    setContractOverrideReason('')
    if (!restoringSameCustomer) {
      setLines((current) => current.map(row => ({ ...clearLineContractRule(row), contractAccessItemId: null })))
    }
    const channelName = restoringSameCustomer ? header.channelName : selected && nextPartnerId ? selected.shortName || selected.name : partnerName
    const preset = detectChannelRulePreset(channelName || partnerName)
    if (mode === 'add' && preset !== XIAN_WEIZHEN_9917_RULE) {
      setLines((current) => current.map((row) => ({ ...clearLineContractRule(row), shareRate: '', taxRate: '' })))
    }
    setHeader((current) => {
      if (restoringSameCustomer) return current
      const base = { ...current, partnerName, channelName }
      if (mode !== 'add') return applyTargetedChannelRule(base)
      if (preset === XIAN_WEIZHEN_9917_RULE) return applyChannelRulePreset(base, preset)
      return {
        ...base,
        settlementRuleCode: 'custom',
        channelFeeMode: 'none',
        channelFeeRate: '',
        taxMode: 'none'
      }
    })
  }

  const handleLineChange = (index, field, value) => {
    setDifferenceNoteWritten(false)
    // A changed voucher amount/mode needs a fresh acknowledgement. An old
    // checkbox must never approve a different monetary value.
    if (field.startsWith('voucher')) setRevenueBasisChange(current => current?.index === index ? { ...current, voucherFaceReviewed: false } : current)
    setLines((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) return row
      const identityChanged = field === 'gameName' || field === 'settlementCycle'
      const next = identityChanged ? { ...clearLineContractRule(row), contractAccessItemId: null } : row
      if (field === 'voucherAmount') return setVoucherEntryAmount(next, value)
      if (field === 'voucherMode') {
        return setVoucherEntryMode(next, value, resolveChannelLineRuleHeader(next, effectiveRuleHeader))
      }
      if (field === 'voucherModeBoth') return setVoucherEntryMode(next, 'both', value)
      if (field === 'voucherFaceValue' || field === 'voucherDirectCost') {
        // Only the expanded dual-voucher editor changes individual fields.
        return { ...next, [field]: value }
      }
      let updated = {
        ...next,
        ...(identityChanged && mode === 'add' ? { shareRate: '', taxRate: '' } : {}),
        [field]: value
      }
      if (field === 'gameName') updated = applyCommercialDiscountFromGameName(updated, { force: identityChanged })
      if (field === 'platformSettlementAmount' || field === 'gameName' || field === 'shareRate' || field === 'flow') {
        updated = applyAnjiuVoucherInference(updated, effectiveRuleHeader)
      }
      return updated
    }))
  }

  const voucherUiKey = (row, index) => row?.id ? 'saved:' + row.id : 'new:' + index

  const requestRevenueBasisChange = (index, nextBasis) => {
    if (revenueBasisLocked || !aiquChannel || !lines[index]) return
    if (resolveRevenueBasis(lines[index]) === nextBasis) return
    setRevenueBasisChange({ index, nextBasis, voucherFaceReviewed: false })
  }

  const applyPendingRevenueBasisChange = () => {
    if (!revenueBasisChange || revenueBasisLocked || !aiquChannel) return
    const { index, nextBasis, voucherFaceReviewed } = revenueBasisChange
    const row = lines[index]
    if (!row) return
    const preview = previewRevenueBasisChange(row, nextBasis, header)
    if (nextBasis === 'post_discount' && preview.requiresVoucherReview && !voucherFaceReviewed) return
    setLines(current => current.map((line, rowIndex) => rowIndex === index ? applyRevenueBasisChange(line, nextBasis, header) : line))
    setDifferenceNoteWritten(false)
    setRevenueBasisChange(null)
  }

  const handleVoucherModeChange = (index, newMode) => {
    const row = lines[index]
    if (!row) return
    const view = getVoucherEntry(row)
    if (view.isLegacy && Number(row.voucherCost || 0) !== 0) {
      if (!window.confirm('这是历史代金券，原计算口径尚未转换。\n确认改为「' + (newMode === 'discount' ? '按折扣换算' : '直接抵扣') + '」吗？此操作可能改变本行结算金额。')) return
    }
    if (view.mode === 'both') {
      const other = newMode === 'discount' ? Number(row.voucherDirectCost || 0) : Number(row.voucherFaceValue || 0)
      if (Math.abs(other) > 0.000001 && !window.confirm('本行同时录入了两种代金券，选择单一口径将清除另一类券的金额。确认继续吗？')) return
    }
    handleLineChange(index, 'voucherMode', newMode)
    const key = voucherUiKey(row, index)
    setExpandedVoucherRows((current) => ({ ...current, [key]: false }))
  }

  const handleVoucherDualToggle = (index, lineRule) => {
    const row = lines[index]
    if (!row) return
    const key = voucherUiKey(row, index)
    const view = getVoucherEntry(row)
    const opened = Boolean(expandedVoucherRows[key]) || view.mode === 'both'
    // A nonzero mixed record never collapses into one input without an
    // explicit radio choice and confirmation that a value will be cleared.
    if (opened) {
      if (view.mode !== 'both') setExpandedVoucherRows((current) => ({ ...current, [key]: false }))
      return
    }
    handleLineChange(index, 'voucherModeBoth', lineRule)
    setExpandedVoucherRows((current) => ({ ...current, [key]: true }))
  }

  const addLine = () => {
    setDifferenceNoteWritten(false)
    const last = lines[lines.length - 1] || {}
    const lastCycle = normalizeChannelSettlementCycle(last.settlementCycle)
    const recommendation = contractRuleState.recommendation
    const baseline = recommendation?.partner_recommendation && (recommendation.partner_auto_apply || mode === 'add')
      ? recommendation.partner_recommendation
      : null
    let next = { ...initialLineItem(), settlementCycle: lastCycle }
    if (!targetedRuleLocked) {
      if (mode === 'add' && baseline) next = applyContractRecommendationToLine(next, baseline)
      else if (mode !== 'add') {
        next.shareRate = String(last.shareRate ?? '')
        next.taxRate = String(last.taxRate ?? '')
      } else {
        next.shareRate = ''
        next.taxRate = ''
      }
    }
    setLines((current) => [...current, next])
  }
  const removeLine = (index) => {
    setDifferenceNoteWritten(false)
    setRevenueBasisChange(null)
    setLines((current) => current.length <= 1 ? current : current.filter((_, rowIndex) => rowIndex !== index))
  }

  const writeDifferenceNote = () => {
    try {
      const note = createChannelDifferenceNote(fullRecord, differenceReview, {
        status: differenceReviewStatus,
        reason: differenceReviewReason
      })
      setHeader((current) => ({
        ...current,
        remark: upsertChannelDifferenceNote(current.remark, note)
      }))
      setDifferenceNoteWritten(true)
      setRemarksExpanded(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成差异说明失败'
      if (onError) onError(message)
      else window.alert(message)
    }
  }

  const formStateRecord = useMemo(() => ({ ...fullRecord, ...(recordId != null ? { id: recordId } : {}) }), [fullRecord, recordId])
  useEffect(() => { onFormStateChange?.(formStateRecord) }, [formStateRecord, onFormStateChange])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (revenueBasisChange) {
      const message = '流水口径变更仍在预览中，请先应用本行口径或取消，再保存账单。'
      if (onError) onError(message)
      else window.alert(message)
      return
    }
    if (!(header.partnerName || header.channelName)?.trim()) {
      const msg = '请填写合作方'; onError?.(msg) ?? window.alert(msg); return
    }
    if (mode === 'add' && !partnerId) {
      const msg = '请从客户库搜索结果中明确选择合作方后再保存；仅输入名称不会触发合同智能匹配。'
      onError?.(msg) ?? window.alert(msg); return
    }
    for (let i = 0; i < lines.length; i += 1) {
      const row = lines[i]
      const cycle = normalizeChannelSettlementCycle(row.settlementCycle)
      if (!cycle) { const msg = `第 ${i + 1} 行：请选择结算月份`; onError?.(msg) ?? window.alert(msg); return }
      if (cycle > currentMonthKey) { const msg = `第 ${i + 1} 行：结算月份 ${monthListLabel([cycle])} 晚于当前月份 ${monthListLabel([currentMonthKey])}，未来账期不能保存`; onError?.(msg) ?? window.alert(msg); return }
      if (!row.gameName?.trim()) { const msg = `第 ${i + 1} 行：请填写游戏名称`; onError?.(msg) ?? window.alert(msg); return }
      if (mode === 'add' && !targetedRuleLocked && String(row.shareRate ?? '').trim() === '') { const msg = `第 ${i + 1} 行：分成比例尚未由合同确定，请等待合同匹配或人工填写`; onError?.(msg) ?? window.alert(msg); return }
      if (mode === 'add' && !targetedRuleLocked && String(row.taxRate ?? '').trim() === '') { const msg = `第 ${i + 1} 行：税率尚未由合同确定，请等待合同匹配或人工填写 0`; onError?.(msg) ?? window.alert(msg); return }
    }

    if (adjustmentActive && !String(header.settlementAdjustmentReason || '').trim()) {
      setAdjustmentExpanded(true)
      const msg = '使用结算调整时必须填写调整原因，避免账单金额被无依据修改。'
      onError?.(msg) ?? window.alert(msg); return
    }
    if (repeatedDifferenceAdjustment) {
      const proceed = window.confirm(
        `渠道平台金额已经包含差异 ${differenceReview.delta > 0 ? '+' : ''}${differenceReview.delta.toFixed(2)} 元。\\n` +
        '本次又填入与这笔差异同额的结算调整，可能重复计入应收。\\n\\n' +
        '如确实是另一笔独立商务调整，请确认有依据并继续；否则请取消并清空调整金额。'
      )
      if (!proceed) return
    }

    const nextMonths = recordMonths({ settlementMonth: fullRecord.settlementMonth, items: lines })
    if (mode === 'edit') {
      const originalMonths = recordMonths(sourceRecord)
      if (JSON.stringify(originalMonths) !== JSON.stringify(nextMonths)) {
        const confirmedMonthChange = window.confirm(
          `你正在修改账单结算周期。\n\n原：${monthListLabel(originalMonths)}\n新：${monthListLabel(nextMonths)}\n\n账期变化会影响对账、收款、发票和统计归属。确认修改吗？`
        )
        if (!confirmedMonthChange) return
      }
    } else {
      const historicalMonths = nextMonths.filter((month) => settlementMonthRisk(month, currentMonthKey) === 'history')
      if (historicalMonths.length) {
        const confirmedHistory = window.confirm(
          `当前录入的是历史账期：${monthListLabel(historicalMonths)}。\n\n历史账单允许保存，请再确认年份和月份是否正确。`
        )
        if (!confirmedHistory) return
      }
    }

    if (contractAwareMode && !targetedRuleLocked) {
      // Save validation must use the same customer-scoped identity as the contract lookup.
      const currentFingerprint = recommendationFingerprint(header.partnerName, header.channelName, lines, partnerId)
      if (contractRuleState.loading || contractRuleState.fingerprint !== currentFingerprint) {
        const msg = '合同清单正在按当前合作方、游戏和账期重新匹配，请完成本轮匹配后再保存。'
        onError?.(msg) ?? window.alert(msg); return
      }
      if (contractRuleState.tone === 'error') {
        const msg = '技术异常：合同规则读取失败，不能直接用旧默认值保存；请重新匹配合同。'
        onError?.(msg) ?? window.alert(msg); return
      }
      if (contractRuleNeedsOverride && !contractOverrideReason.trim()) {
        const msg = '当前结算规则与合同清单不完全一致；如需人工覆盖，请先填写“人工覆盖合同原因”。'
        onError?.(msg) ?? window.alert(msg); return
      }
    }

    const intent = submitIntentRef?.current ?? 'back'
    const overrideNote = contractRuleNeedsOverride && contractOverrideReason.trim()
      ? `合同人工覆盖：${contractOverrideReason.trim()}`
      : ''
    const recordHeader = {
      ...header,
      status: channelStatusForSubmit(header.status, intent),
      remark: [String(header.remark || '').trim(), overrideNote].filter(Boolean).join('；')
    }
    const submissionLines = linesWithChannelLineContractFees(lines, header).map(line => {
      if (mode === 'edit') return line
      const { id, ...newLine } = line
      return newLine
    })
    const record = buildFullChannelRecord(recordHeader, submissionLines)
    try {
      if (mode === 'edit' && recordId != null) {
        const pendingResult = onUpdateRecord?.(recordId, { ...record, id: recordId })
        const result = pendingResult && typeof pendingResult.then === 'function' ? await pendingResult : pendingResult
        if (result === false) return
        onAfterSubmit?.(intent)
      } else {
        const result = onAddRecord?.(record); if (result && typeof result.then === 'function') await result
        if (intent === 'continue') {
          setHeader({ ...initialHeaderForm })
          setPartnerId('')
          setLines([{ ...initialLineItem() }])
          setLastContractRuleKey('')
          setContractRuleState(emptyContractRuleState())
          setContractOverrideReason('')
        }
        onAfterSubmit?.(intent)
      }
    } catch { return }
    if (submitIntentRef) submitIntentRef.current = 'back'
  }

  const validationTone = totals.validationStatus === 'fail'
    ? differenceReview.kind === 'higher' ? 'is-advisory' : 'is-danger'
    : totals.validationStatus === 'pass' ? 'is-good' : ''

  return (
    <form id={formId} onSubmit={handleSubmit} className={`channel-form channel-form--page ${className}`}>
      <div className="channel-form-section channel-bill-meta-section">
        <div className="form-section-title">1）账单信息</div>
        <div className="channel-bill-meta-grid">
          <div className="form-group channel-bill-meta-grid__partner">
            <label>合作方 *</label>
            <PartnerPicker value={header.partnerName || header.channelName} partnerId={partnerId} partners={partners} onChange={handlePartnerChange} onAddPartner={onAddPartner} required linkedText={selectedPartner ? `已关联客户库 · 简称：${selectedPartner.shortName || selectedPartner.name}` : '已关联客户库'} unlinkedText="输入简称或公司全称，并从客户库结果中选择" />
          </div>
        </div>

        <section className="channel-rule-panel">
          <div className="channel-rule-panel__head">
            <div><span>结算规则引擎</span><strong>{targetedRuleLocked ? '渠道专属规则已锁定' : mixedLineContractRules ? '已按游戏明细分别套用合同规则' : '合同清单优先，人工覆盖需留痕'}</strong></div>
            <small>{targetedRuleLocked ? '西安维真（客户 9917）：代金券、福利币仅记录；其余原扣减项保持现有规则，分成后扣 5% 通道费，税率仅记录。' : mixedLineContractRules ? '同一张账单可以包含不同分成/通道费口径；系统按每行对应合同独立计算，上方规则只作为未匹配明细的兜底。' : '明确选择合作方后先读取合同清单统一规则；填写游戏和账期后再锁定具体合作清单。旧 30%/5% 默认值不会再冒充合同值。'}</small>
          </div>
          {contractAwareMode && (contractRuleState.loading || contractRuleState.message) ? (
            <div className={`channel-contract-rule-status is-${contractRuleState.tone || 'idle'}`}>
              <div>
                <strong>{contractRuleLabel(contractRuleState)}</strong>
                <span>{contractRuleState.message}</span>
                {contractRuleState.contracts?.length ? <small>{contractRuleState.contracts.join(' · ')}</small> : null}
              </div>
              <button type="button" onClick={() => { setLastContractRuleKey(''); setContractRuleRevision((value) => value + 1) }} disabled={contractRuleState.loading || (mode === 'add' && !partnerId)}>重新匹配</button>
            </div>
          ) : null}
          {contractAwareMode && !contractRuleState.loading && contractRuleState.fingerprint === recommendationFingerprint(header.partnerName, header.channelName, lines, partnerId) && (
            (contractRuleState.recommendation?.lines || []).some(item => !item.auto_apply)
          ) ? (
            <ul className="channel-contract-rule-issues" aria-label="未自动带入的合同规则">
              {contractRuleState.recommendation.lines.filter(item => !item.auto_apply).map(item => (
                <li key={item.line_index}>
                  <strong>第 {Number(item.line_index) + 1} 行 · {item.game_name} · {item.settlement_cycle}</strong>
                  <p>{item.message || (item.match ? '已找到合同，自动套用条件尚未满足，请核对具体合同与账期。' : '未找到匹配的合同合作项，请核对游戏、渠道名称与账期。')}</p>
                  {item.match ? <small>
                    合同：{item.match.contract_no || item.match.contract_name || '已匹配合作项'}
                    {' · 分成：'}{item.recommended?.share_rate == null ? '未填写' : `${item.recommended.share_rate}%`}
                    {' · 通道费：'}{item.recommended?.channel_fee_rate == null ? '未填写' : `${item.recommended.channel_fee_rate}%`}
                    {' · 授权期：'}{item.match.authorization_start || '未注明'} 至 {item.match.authorization_end || '未注明'}
                  </small> : null}
                  {item.match?.contract_id && item.match?.access_item_id ? (
                    <div><button type="button" className="channel-contract-rule-issue__action" onClick={() => setContractIssueTarget(item)}>
                      本页核对合同
                    </button></div>
                  ) : !item.match && partnerId ? (
                    <div><button type="button" className="channel-contract-rule-issue__action" onClick={() => setContractIssueTarget(item)}>
                      本页选择已录入的合作游戏清单
                    </button></div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {contractAwareMode && contractRuleNeedsOverride && !targetedRuleLocked ? (
            <div className="channel-contract-rule-override">
              <div><strong>业务差异 · 当前值未完全按合同清单</strong><span>如确需人工覆盖，必须填写原因；该原因会随账单备注保存。</span></div>
              <input type="text" value={contractOverrideReason} onChange={(event) => setContractOverrideReason(event.target.value)} placeholder="例如：商务临时约定、历史口径、合同清单待补录" />
            </div>
          ) : null}
          <div className="channel-rule-grid">
            <label><span>规则模板</span><select value={effectiveRuleHeader.settlementRuleCode} disabled={targetedRuleLocked} onChange={(e) => handleRulePresetChange(e.target.value)}>{Object.entries(CHANNEL_RULE_PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}</select></label>
            <label><span>渠道费模式</span><select value={effectiveRuleHeader.channelFeeMode} disabled={targetedRuleLocked || mixedLineContractRules} onChange={(e) => handleRuleFieldChange('channelFeeMode', e.target.value)}><option value="none">不扣渠道费</option><option value="percent">百分比</option><option value="fixed">固定金额/行</option></select></label>
            <label><span>渠道费率%</span><input type="number" step="0.01" min="0" max="100" value={effectiveRuleHeader.channelFeeRate} disabled={targetedRuleLocked || mixedLineContractRules || feeMode !== 'percent'} onChange={(e) => handleRuleFieldChange('channelFeeRate', e.target.value)} placeholder={feeMode === 'percent' ? '如 5' : '当前不使用'} /></label>
            <label><span>税处理</span><select value={effectiveRuleHeader.taxMode} disabled={targetedRuleLocked || mixedLineContractRules} onChange={(e) => handleRuleFieldChange('taxMode', e.target.value)}><option value="none">仅记录，不参与</option><option value="share">按分成额扣税</option><option value="after_fee">渠道费后再扣税</option></select></label>
            <label><span>差异容差（元）</span><input type="number" step="0.01" min="0" value={header.validationTolerance} onChange={(e) => handleRuleFieldChange('validationTolerance', e.target.value)} /></label>
          </div>
          <div className="channel-rule-formula"><span>当前公式</span><strong>{mixedLineContractRules ? '按每行合同规则分别计算（分成、通道费、税处理均以明细匹配结果为准）' : ruleFormulaText(effectiveRuleHeader)}</strong></div>
        </section>
      </div>

      <div className="channel-form-section">
        <div className="form-section-title channel-bill-detail-title"><span>2）游戏明细</span><span className="channel-bill-period-badge">{periodSummary(lines)}</span></div>
        {aiquChannel ? (
          <div className="channel-rule-formula" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
            <strong>爱趣独立流水口径</strong>
            <span>每行单独选择并预览应用，历史数据不自动转换。折后流水不再乘游戏折扣；折算券填原始面额，直扣券填实际金额，其他扣减均填实际金额。</span>
            {revenueBasisLocked ? <span>已确认、已收款或已核销记录：流水口径只读。</span> : null}
          </div>
        ) : null}
        <LineItemsTable onAddRow={addLine} showAddButton={false} hint="结算月份只能选择本月或过去月份；历史账期允许保存但会提醒核对，未来账期会被前后端同时拦截。">
          <table className="channel-line-items-table">
            <thead><tr><th>结算月份</th><th>游戏名称</th><th>{aiquChannel ? '录入流水 / 口径' : '后台流水'}</th><th>{aiquChannel ? '游戏折扣' : '折扣系数'}</th><th>{aiquChannel ? '参与结算流水' : '总流水'}</th><th className="channel-voucher-heading" title="折算券录入原始面额，直扣券录入实际金额；代金券口径独立选择，不随流水口径自动改变。">代金券</th><th>无忧试</th><th>玩家退款</th><th>测试费</th><th>福利币</th><th>其他扣减</th><th>分成%</th><th>税率%</th><th>通道费</th><th>计费额</th><th>分成额</th><th>系统结算</th><th>平台结算</th><th>差异</th><th>校验</th><th>操作</th></tr></thead>
            <tbody>{linesForSettlement.map((row, index) => {
              const rowRuleHeader = resolveChannelLineRuleHeader(row, effectiveRuleHeader)
              const rowFeeMode = rowRuleHeader.channelFeeMode || 'fixed'
              const details = calculateSettlementDetails(row, rowRuleHeader)
              const monthRisk = settlementMonthRisk(row.settlementCycle, currentMonthKey)
              const voucher = getVoucherEntry(row)
              const voucherPreview = getVoucherEntryPreview(row, rowRuleHeader)
              const dualVoucherEditing = voucher.mode === 'both' || Boolean(expandedVoucherRows[voucherUiKey(row, index)])
              return (
                <tr key={row.id || `line-${index}`}>
                  <td style={{ minWidth: 132 }}>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <input type="month" max={currentMonthKey} className="admin-input" value={normalizeChannelSettlementCycle(row.settlementCycle)} onChange={(e) => handleLineChange(index, 'settlementCycle', e.target.value)} required aria-invalid={monthRisk === 'future'} />
                      {monthRisk === 'future' ? <small style={{ color: '#b42318', fontSize: 10 }}>未来账期不能保存</small> : null}
                      {monthRisk === 'history' ? <small style={{ color: '#9a6700', fontSize: 10 }}>历史账期 · 请核对年份</small> : null}
                    </div>
                  </td>
                  <td><input type="text" className="admin-input" value={row.gameName} onChange={(e) => handleLineChange(index, 'gameName', e.target.value)} placeholder="必填" /></td>
                  <td>
                    <input type="number" step="0.01" className="admin-input" value={row.flow} onChange={(e) => handleLineChange(index, 'flow', e.target.value)} aria-label={`第${index + 1}行录入流水`} />
                    <ChannelRevenueBasisSelector row={row} header={header} index={index} locked={revenueBasisLocked} onRequest={(basis) => requestRevenueBasisChange(index, basis)} />
                  </td>
                  <td>
                    <input type="number" step="0.000001" min="0" className="admin-input" value={row.discountFactor} onChange={(e) => handleLineChange(index, 'discountFactor', e.target.value)} placeholder="默认1" aria-label={`第${index + 1}行游戏折扣`} />
                    {aiquChannel && resolveRevenueBasis(row) === 'post_discount' ? <small style={{ display: 'block', fontSize: 10, color: '#596579', whiteSpace: 'normal' }}>版本参考，不再乘流水</small> : null}
                  </td>
                  <td className="channel-line-num">{effectiveLineFlowFromFormData(row).toFixed(2)}</td>
                  <td className="channel-voucher-cell">
                    <div className="channel-voucher-editor" title={voucherPreview.label}>
                      <div className={'channel-voucher-editor__inline' + (dualVoucherEditing ? ' is-dual' : '')}>
                        {dualVoucherEditing ? (
                          <div className="channel-voucher-editor__dual-inputs">
                            <label title="折算券原始面额"><span aria-hidden="true">折</span><input type="number" step="0.01" className="admin-input" value={row.voucherFaceValue ?? '0'} onChange={(e) => handleLineChange(index, 'voucherFaceValue', e.target.value)} aria-label={`第${index + 1}行折算券原始面额`} placeholder="0" /></label>
                            <label title="直扣券实际金额"><span aria-hidden="true">直</span><input type="number" step="0.01" className="admin-input" value={row.voucherDirectCost ?? '0'} onChange={(e) => handleLineChange(index, 'voucherDirectCost', e.target.value)} aria-label={`第${index + 1}行直扣券实际金额`} placeholder="0" /></label>
                          </div>
                        ) : (
                          <input type="number" step="0.01" className="admin-input channel-voucher-editor__amount" value={voucher.amount} onChange={(e) => handleLineChange(index, 'voucherAmount', e.target.value)} aria-label={`第${index + 1}行代金券金额`} title={voucher.isLegacy ? '历史账单：未转换口径时仍按原结算规则计算' : voucher.mode === 'direct' ? '直扣券实际金额（已折后）' : '折算券原始面额（按游戏折扣换算）'} placeholder="0" />
                        )}
                        <select
                          className="channel-voucher-editor__mode"
                          value={dualVoucherEditing ? 'both' : voucher.mode}
                          aria-label={`第${index + 1}行代金券口径`}
                          title={`当前代金券口径（切换时使用原有确认和计算规则）：${voucherPreview.label}`}
                          onChange={(event) => {
                            const mode = event.target.value
                            if (mode === 'both') handleVoucherDualToggle(index, rowRuleHeader)
                            else handleVoucherModeChange(index, mode)
                          }}
                        >
                          {voucher.mode === 'legacy' && <option value="legacy" disabled>原口径</option>}
                          <option value="discount">折算</option>
                          <option value="direct">直扣</option>
                          <option value="both">双券</option>
                        </select>
                      </div>
                      <small className={`channel-voucher-editor__preview${voucher.mode === 'legacy' ? ' is-legacy' : ''}`}>{voucherPreview.label}</small>
                    </div>
                  </td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.noWorryCost} onChange={(e) => handleLineChange(index, 'noWorryCost', e.target.value)} /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.refundCost} onChange={(e) => handleLineChange(index, 'refundCost', e.target.value)} /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.testCost} onChange={(e) => handleLineChange(index, 'testCost', e.target.value)} /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.welfareCost} onChange={(e) => handleLineChange(index, 'welfareCost', e.target.value)} /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.coinCost} onChange={(e) => handleLineChange(index, 'coinCost', e.target.value)} /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.shareRate} onChange={(e) => handleLineChange(index, 'shareRate', e.target.value)} placeholder="合同带入/人工填写" /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.taxRate} onChange={(e) => handleLineChange(index, 'taxRate', e.target.value)} placeholder="合同带入/填0" /></td>
                  {rowFeeMode === 'fixed' ? (
                    <td><input type="number" step="0.01" className="admin-input" value={row.gatewayCost} onChange={(e) => handleLineChange(index, 'gatewayCost', e.target.value)} placeholder="元" /></td>
                  ) : (
                    <td className="channel-line-num">{rowFeeMode === 'percent' ? `${Number(rowRuleHeader.channelFeeRate || 0)}%` : '不扣'}</td>
                  )}
                  <td className="channel-line-num">{formatMoney(calculateBillingAmount(row, rowRuleHeader))}</td>
                  <td className="channel-line-num">{formatMoney(calculateShareAmount(row, rowRuleHeader))}</td>
                  <td className="channel-system-amount">{formatMoney(details.systemSettlementAmount)}</td>
                  <td><input type="number" step="0.01" className="admin-input channel-platform-input" value={row.platformSettlementAmount} onChange={(e) => handleLineChange(index, 'platformSettlementAmount', e.target.value)} placeholder="平台账单金额" /></td>
                  <td className={`channel-line-diff is-${details.validationStatus}`}>{details.settlementDifference == null ? '-' : `${details.settlementDifference >= 0 ? '+' : ''}${formatMoney(details.settlementDifference)}`}</td>
                  <td><span className={`channel-validation-badge is-${details.validationStatus}`}>{validationText(details.validationStatus)}</span></td>
                  <td><button type="button" className="rec-btn rec-btn--ghost rec-btn--small" onClick={addLine}>+</button><button type="button" className="rec-btn rec-btn--ghost rec-btn--small" onClick={() => removeLine(index)} disabled={lines.length <= 1}>-</button></td>
                </tr>
              )
            })}</tbody>
          </table>
        </LineItemsTable>
        {revenueBasisChange && linesForSettlement[revenueBasisChange.index] ? (
          <div ref={revenueBasisPreviewRef} tabIndex={-1} style={{ marginTop: 12 }}>
            <ChannelRevenueBasisPreview
              row={linesForSettlement[revenueBasisChange.index]}
              header={resolveChannelLineRuleHeader(linesForSettlement[revenueBasisChange.index], effectiveRuleHeader)}
              index={revenueBasisChange.index}
              nextBasis={revenueBasisChange.nextBasis}
              voucherFaceReviewed={revenueBasisChange.voucherFaceReviewed}
              locked={revenueBasisLocked}
              onVoucherReview={(checked) => setRevenueBasisChange(current => current ? { ...current, voucherFaceReviewed: checked } : null)}
              onApply={applyPendingRevenueBasisChange}
              onCancel={() => setRevenueBasisChange(null)}
            />
          </div>
        ) : null}
      </div>

      <div className="channel-form-section">
        <div className="form-section-title">3）汇总</div>
        <div className="channel-line-items-summary channel-line-items-summary--channel">
          <div className="summary-item summary-item--accent"><div className="label">原始后台流水</div><div className="value">{formatMoney(totals.rawFlow)}</div></div>
          <div className="summary-item summary-item--accent"><div className="label">折算后总流水</div><div className="value">{formatMoney(totals.effectiveFlow)}</div></div>
          <div className="summary-item"><div className="label">总代金券</div><div className="value">{formatMoney(totals.voucher)}</div></div>
          <div className="summary-item"><div className="label">总退款</div><div className="value">{formatMoney(totals.refund)}</div></div>
          <div className="summary-item summary-item--hero"><div className="label">{adjustmentActive ? '最终应收' : '实际结算金额'}</div><div className="value">{formatMoney(totals.settlement)}</div></div>
        </div>
        {differenceReview.kind !== 'unvalidated' && differenceReview.kind !== 'matched' ? (
          <section className={`channel-difference-review is-${differenceReview.kind}`} aria-label="渠道账单差异处理">
            <div className="channel-difference-review__heading">
              <div>
                <strong>渠道账单差异核对</strong>
                <small>独立记录核对结果，不修改后台流水、折扣、分成规则或结算金额。</small>
              </div>
              <span className="channel-difference-review__badge">{channelDifferenceLabel(differenceReview)}</span>
            </div>
            {differenceReview.kind === 'partial' ? (
              <p className="channel-difference-review__note">
                仍有游戏未填写平台结算金额，合计差额可能不准确。请先补齐各游戏的平台账单金额，再判断是否需要核对。
              </p>
            ) : (
              <>
                <div className="channel-difference-review__figures">
                  <span>系统核算 <strong>{formatMoney(differenceReview.system)}</strong></span>
                  <span>渠道账单 <strong>{formatMoney(differenceReview.platform)}</strong></span>
                  <span>业务应收 <strong>{formatMoney(totals.businessSettlement)}</strong></span>
                </div>
                <p className="channel-difference-review__note">
                  各行“平台结算”已纳入业务应收；{differenceReview.kind === 'higher' ? '渠道账单金额高于系统核算，并不需要在下面再做“商务补差”。' : '请核实差额来源，不能通过修改真实流水来消除差异。'}
                </p>
                <div className="channel-difference-review__fields">
                  <label>
                    <span>核对状态</span>
                    <select value={differenceReviewStatus} onChange={(event) => { setDifferenceReviewStatus(event.target.value); setDifferenceNoteWritten(false) }}>
                      <option value="pending">待核实（先保留差异）</option>
                      <option value="platform_confirmed">渠道金额已核实</option>
                    </select>
                  </label>
                  <label>
                    <span>说明 / 核对依据{differenceReviewStatus === 'platform_confirmed' ? ' *' : ''}</span>
                    <input
                      type="text"
                      value={differenceReviewReason}
                      onChange={(event) => { setDifferenceReviewReason(event.target.value); setDifferenceNoteWritten(false) }}
                      placeholder={differenceReviewStatus === 'platform_confirmed' ? '必填：订单明细或对方确认依据' : '可选：例如渠道订单明细待提供'}
                    />
                  </label>
                  <button type="button" onClick={writeDifferenceNote}>写入账单备注</button>
                </div>
                {differenceNoteWritten ? (
                  <small className="channel-difference-review__saved" role="status">差异说明已写入账单末尾备注，并自动展开供你查看；保存账单后才会同步到服务器。此操作不增加应收。</small>
                ) : null}
              </>
            )}
            {repeatedDifferenceAdjustment ? (
              <p className="channel-difference-review__duplicate" role="alert">注意：下面的结算调整与当前平台差异同额，可能重复计入。请检查是否另有独立补款依据。</p>
            ) : null}
          </section>
        ) : null}
        <div className="channel-optional-adjustment" data-testid="channel-optional-adjustment">
          <button
            type="button"
            className="channel-optional-toggle"
            aria-expanded={adjustmentExpanded}
            aria-controls="channel-optional-adjustment-fields"
            onClick={() => setAdjustmentExpanded((value) => !value)}
          >
            <span className="channel-optional-toggle__title">特殊结算调整</span>
            <span className={adjustmentActive ? 'channel-optional-toggle__status is-active' : 'channel-optional-toggle__status'}>
              {adjustmentActive
                ? `已启用 · 调整 ${formatMoney(totals.adjustment)}${String(header.settlementFinalOverride ?? '').trim() !== '' ? ' · 有最终确认金额' : ''}`
                : hasAdjustmentTypeWithoutAmount ? '已选调整类型，待补金额' : '仅跨月冲抵、补差或特殊确认时填写'}
            </span>
            <span className="channel-optional-toggle__action">{adjustmentExpanded ? '收起' : '展开'} <span aria-hidden="true">{adjustmentExpanded ? '⌃' : '⌄'}</span></span>
          </button>
          {adjustmentExpanded ? (
            <div id="channel-optional-adjustment-fields" className="channel-optional-adjustment__fields">
              <p>只调整账单级最终结算金额，不改写游戏明细。已有特殊调整不会因收起而清空。</p>
              <div className="channel-optional-adjustment__grid">
                <label><span>调整类型</span><select className="admin-input" value={header.settlementAdjustmentType || ''} onChange={(e) => handleHeaderChange('settlementAdjustmentType', e.target.value)}><option value="">不调整</option><option value="historical_carryover">历史差额结转</option><option value="business_makeup">商务补差</option><option value="offset">补扣 / 冲抵</option><option value="other">其他</option></select></label>
                <label><span>来源账期</span><input type="month" max={currentMonthKey} className="admin-input" value={normalizeChannelSettlementCycle(header.settlementAdjustmentSourceMonth)} onChange={(e) => handleHeaderChange('settlementAdjustmentSourceMonth', e.target.value)} /></label>
                <label><span>调整金额（可正负）</span><input type="number" step="0.01" className="admin-input" value={header.settlementAdjustmentAmount ?? ''} onChange={(e) => handleHeaderChange('settlementAdjustmentAmount', e.target.value)} placeholder="扣减如 -498.64" /></label>
                <label><span>最终确认金额（选填）</span><input type="number" step="0.01" min="0" className="admin-input" value={header.settlementFinalOverride ?? ''} onChange={(e) => handleHeaderChange('settlementFinalOverride', e.target.value)} placeholder="如双方确认 376.00" /></label>
                <label><span>调整原因 {adjustmentActive ? '*' : ''}</span><input type="text" className="admin-input" value={header.settlementAdjustmentReason || ''} onChange={(e) => handleHeaderChange('settlementAdjustmentReason', e.target.value)} placeholder="例如：10月差额于12月结转，双方确认最终金额" /></label>
              </div>
              {hasAdjustmentTypeWithoutAmount && hasDifferenceToReview ? (
                <div className="channel-difference-review__adjustment-hint">
                  <span>仅选择调整类型并不会增加金额；平台差异已经包含在账单结算中，不需要重复补差。</span>
                  <button
                    type="button"
                    onClick={() => setHeader((current) => ({
                      ...current,
                      settlementAdjustmentType: '',
                      settlementAdjustmentSourceMonth: '',
                      settlementAdjustmentAmount: '',
                      settlementFinalOverride: '',
                      settlementAdjustmentReason: ''
                    }))}
                  >一键改回不调整</button>
                </div>
              ) : null}
              {adjustmentActive ? (
                <div className="channel-optional-adjustment__calculation">
                  <span>业务结算 <strong>{formatMoney(totals.businessSettlement)}</strong></span>
                  <span>+</span>
                  <span>调整 <strong>{totals.adjustment >= 0 ? '+' : ''}{formatMoney(totals.adjustment)}</strong></span>
                  <span>=</span>
                  <span>计算后 <strong>{formatMoney(totals.afterAdjustment)}</strong></span>
                  {String(header.settlementFinalOverride ?? '').trim() !== '' ? <><span>→</span><span>最终确认 <strong>{formatMoney(totals.settlement)}</strong></span></> : null}
                  {Math.abs(totals.adjustmentTail) >= 0.005 ? <span>尾差 {totals.adjustmentTail >= 0 ? '+' : ''}{formatMoney(totals.adjustmentTail)}</span> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="channel-rule-summary">
          <div><span>系统计算合计</span><strong>{formatMoney(totals.system)}</strong></div>
          <div><span>平台结算合计</span><strong>{totals.platform == null ? '未录入' : formatMoney(totals.platform)}</strong></div>
          <div className={validationTone}><span>系统 - 平台（仅用于核对）</span><strong>{totals.difference == null ? '-' : `${totals.difference >= 0 ? '+' : ''}${formatMoney(totals.difference)}`}</strong></div>
          <div className={validationTone}><span>校验状态</span><strong>{validationText(totals.validationStatus)}</strong></div>
          <div><span>允许误差</span><strong>±{formatMoney(header.validationTolerance)}</strong></div>
        </div>
      </div>
      <div className="channel-optional-remarks" data-testid="channel-optional-remarks">
        <button
          type="button"
          className="channel-optional-remarks__toggle"
          aria-expanded={remarksExpanded}
          aria-controls="channel-optional-remarks-textarea"
          onClick={() => setRemarksExpanded((value) => !value)}
        >
          {String(header.remark || '').trim() ? '备注 / 特殊说明 · 已填写' : '＋ 添加备注 / 特殊说明（选填）'}
          <span aria-hidden="true">{remarksExpanded ? '⌃' : '⌄'}</span>
        </button>
        {remarksExpanded ? (
          <div className="channel-optional-remarks__body" id="channel-optional-remarks-textarea">
            <label htmlFor="channel-bill-last-remarks">备注 / 特殊说明</label>
            <textarea
              id="channel-bill-last-remarks"
              rows={3}
              value={header.remark}
              onChange={(e) => handleHeaderChange('remark', e.target.value)}
              className="admin-input channel-bill-remark-textarea"
              placeholder="只有特殊结算、跨月冲抵、双方确认差异等情况才填写；普通账单留空即可。"
            />
            <small>原有备注、合同人工覆盖说明及差异核对记录仍随账单保存，收起不会删除。</small>
          </div>
        ) : null}
      </div>
      {contractIssueTarget ? (
        <ChannelContractIssueEditor
          issue={contractIssueTarget}
          partnerName={header.partnerName || header.channelName}
          partnerId={partnerId}
          onClose={() => setContractIssueTarget(null)}
          onUseExisting={async ({ item }) => {
            if (!partnerId) throw new Error('必须先从客户库选中合作方，才能引用现有合同。')
            const index = Number(contractIssueTarget.line_index)
            const row = lines[index]
            if (!row || row.gameName !== contractIssueTarget.game_name ||
                normalizeChannelSettlementCycle(row.settlementCycle) !== normalizeChannelSettlementCycle(contractIssueTarget.settlement_cycle)) {
              throw new Error('账单游戏或结算月份已经变化，请关闭窗口重新核对当前明细。')
            }
            // Verify the selected ID against the actual bill identity. Never replace
            // its channel with the candidate channel or trust client-side rate data.
            const response = await recommendChannelContractRules({
              partner_id: partnerId,
              partner_name: header.partnerName,
              channel_name: String(header.channelName || '').trim(),
              lines: [{
                line_index: 0,
                access_item_id: String(item.id),
                game_name: row.gameName,
                settlement_cycle: normalizeChannelSettlementCycle(row.settlementCycle)
              }]
            })
            const verified = (response.lines || []).find(candidate => Number(candidate.line_index) === 0)
            const sameAccess = String(verified?.match?.access_item_id || '') === String(item.id)
            if (!verified?.auto_apply || !sameAccess || !verified?.recommended) {
              throw new Error(verified?.message || '所选清单未通过当前客户、渠道、版本与账期校验，未应用或保存。')
            }
            // Object identity also protects new, unsaved duplicate rows. Reject
            // stale responses rather than applying by array position after edits.
            const live = liveContractForm.current
            if (live.partnerId !== partnerId || live.header.partnerName !== header.partnerName ||
                live.header.channelName !== header.channelName || !live.lines.includes(row)) {
              throw new Error('账单或客户已变化，本次引用未应用，请重新选择当前明细。')
            }
            const recommended = verified.recommended
            setLines(current => current.map(line => line === row &&
              line.gameName === row.gameName &&
              normalizeChannelSettlementCycle(line.settlementCycle) === normalizeChannelSettlementCycle(row.settlementCycle)
                ? { ...applyContractRecommendationToLine(line, recommended), contractAccessItemId: String(item.id) }
                : line))
            setLastContractRuleKey('')
            setContractRuleRevision(value => value + 1)
          }}
          onSaved={async () => {
            // Do not replace form rows or amount fields; only refresh the
            // existing contract-first recommendation after the verified write.
            setLastContractRuleKey('')
            setContractRuleRevision((v) => v + 1)
          }}
        />
      ) : null}
    </form>
  )
}

export default ChannelBillingForm
