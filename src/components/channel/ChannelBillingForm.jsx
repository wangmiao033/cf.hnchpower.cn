import React, { useEffect, useMemo, useState } from 'react'
import {
  CHANNEL_RULE_PRESETS,
  XIAN_WEIZHEN_9917_RULE,
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
import { recommendChannelContractRules } from '@/lib/api/contractTerms.ts'
import '@/components/ChannelBilling.css'
import './ChannelSettlementRule.css'
import LineItemsTable from '@/components/shared/LineItemsTable.jsx'
import PartnerPicker, { findExactPartner } from '@/components/shared/PartnerPicker.jsx'

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
  if (state.tone === 'review') return '合同规则已匹配 · 待确认'
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
    game_name: String(row.gameName || '').trim(),
    settlement_cycle: normalizeChannelSettlementCycle(row.settlementCycle)
  })).filter((row) => row.game_name && row.settlement_cycle)
}

function recommendationFingerprint(partnerName, channelName, lines) {
  return JSON.stringify({
    partnerName: String(partnerName || '').trim(),
    channelName: String(channelName || '').trim(),
    lines: identityRows(lines).map((row) => [row.line_index, row.game_name, row.settlement_cycle])
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
    settlementRuleCode: recommendation.settlement_rule_code || '',
    channelFeeMode: recommendation.channel_fee_mode || '',
    channelFeeRate: recommendation.channel_fee_rate != null ? String(recommendation.channel_fee_rate) : '',
    taxMode: recommendation.tax_mode || '',
    validationTolerance: recommendation.validation_tolerance != null ? String(recommendation.validation_tolerance) : '',
    gatewayCost: recommendation.channel_fee_mode === 'fixed' ? row.gatewayCost : ''
  }
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
  className = ''
}) {
  const [header, setHeader] = useState(initialHeaderForm)
  const [lines, setLines] = useState([initialLineItem()])
  const [partnerId, setPartnerId] = useState('')
  const [contractRuleState, setContractRuleState] = useState(emptyContractRuleState)
  const [contractRuleRevision, setContractRuleRevision] = useState(0)
  const [lastContractRuleKey, setLastContractRuleKey] = useState('')
  const [contractOverrideReason, setContractOverrideReason] = useState('')
  const currentMonthKey = currentMonth()

  const fullRecord = useMemo(
    () => buildFullChannelRecord({ ...header, status: header.status || 'pending' }, lines),
    [header, lines]
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
  const feeMode = effectiveRuleHeader.channelFeeMode || 'fixed'
  const targetedRuleLocked = effectiveRuleHeader.settlementRuleCode === XIAN_WEIZHEN_9917_RULE
  const contractAwareMode = mode === 'add' || mode === 'edit'
  const autoApplyContractRules = canAutoApplyContractRules(mode, header.status)
  const lineRuleSignatures = useMemo(() => new Set(
    lines
      .filter((row) => String(row.channelFeeMode || row.taxMode || row.settlementRuleCode || '').trim())
      .map((row) => {
        const rule = resolveChannelLineRuleHeader(row, effectiveRuleHeader)
        return `${rule.settlementRuleCode || ''}|${rule.channelFeeMode || ''}|${rule.channelFeeRate ?? ''}|${rule.taxMode || ''}`
      })
  ), [lines, effectiveRuleHeader])
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
    const stateRecord = draftRecord || (mode === 'edit' ? sourceRecord : null)
    if (stateRecord) {
      setPartnerId('')
      setHeader(recordToHeaderForm(stateRecord))
      const lineForms = recordToLineForms(stateRecord)
      setLines(lineForms.length ? lineForms : [initialLineItem()])
      setContractRuleState(emptyContractRuleState())
      setLastContractRuleKey('')
      setContractOverrideReason('')
      return
    }
    setHeader({ ...initialHeaderForm })
    setPartnerId('')
    setLines([{ ...initialLineItem() }])
    setContractRuleState(emptyContractRuleState())
    setLastContractRuleKey('')
    setContractOverrideReason('')
  }, [mode, sourceRecord?.id, draftRecord])

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
    const fingerprint = recommendationFingerprint(partnerName, header.channelName, lines)
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
          const baseline = result.partner_recommendation && (result.partner_auto_apply || mode === 'add')
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
            setLines((current) => current.map((row, index) => {
              const preciseRec = lineRecommendations.get(index)
              if (preciseRec) return applyContractRecommendationToLine(row, preciseRec)
              if (mode === 'add' && baseline) return applyContractRecommendationToLine(row, baseline)
              return row
            }))
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
              message: mode === 'edit'
                ? '未找到该合作方合同清单，已保留当前账单原有规则；这类“未匹配”不直接判为业务差异。'
                : '待补规则：未找到该合作方合同清单；新增账单的分成/税率/通道费保持空白，不使用历史值或30%/5%默认值。',
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
                : result.partner_rule_message || result.message || '待补规则：合同规则存在歧义，请按具体游戏和账期确认。',
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
    setPartnerId(nextPartnerId)
    setLastContractRuleKey('')
    setContractRuleState(emptyContractRuleState())
    setContractOverrideReason('')
    if (mode === 'add' || (selected && nextPartnerId)) {
      setLines((current) => current.map(clearLineContractRule))
    }
    const channelName = selected && nextPartnerId ? selected.shortName || selected.name : partnerName
    const preset = detectChannelRulePreset(channelName || partnerName)
    if (mode === 'add' && preset !== XIAN_WEIZHEN_9917_RULE) {
      setLines((current) => current.map((row) => ({ ...clearLineContractRule(row), shareRate: '', taxRate: '' })))
    }
    setHeader((current) => {
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
    setLines((current) => current.map((row, rowIndex) => {
      if (rowIndex !== index) return row
      const identityChanged = field === 'gameName' || field === 'settlementCycle'
      const next = identityChanged ? clearLineContractRule(row) : row
      return {
        ...next,
        ...(identityChanged && mode === 'add' ? { shareRate: '', taxRate: '' } : {}),
        [field]: value
      }
    }))
  }

  const addLine = () => {
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
  const removeLine = (index) => setLines((current) => current.length <= 1 ? current : current.filter((_, rowIndex) => rowIndex !== index))

  const formStateRecord = useMemo(() => ({ ...fullRecord, ...(recordId != null ? { id: recordId } : {}) }), [fullRecord, recordId])
  useEffect(() => { onFormStateChange?.(formStateRecord) }, [formStateRecord, onFormStateChange])

  const handleSubmit = async (event) => {
    event.preventDefault()
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
      const msg = '使用结算调整时必须填写调整原因，避免账单金额被无依据修改。'
      onError?.(msg) ?? window.alert(msg); return
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
      const currentFingerprint = recommendationFingerprint(header.partnerName, header.channelName, lines)
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
    const record = buildFullChannelRecord(recordHeader, lines)
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

  const validationTone = totals.validationStatus === 'fail' ? 'is-danger' : totals.validationStatus === 'pass' ? 'is-good' : ''

  return (
    <form id={formId} onSubmit={handleSubmit} className={`channel-form channel-form--page ${className}`}>
      <div className="channel-form-section channel-bill-meta-section">
        <div className="form-section-title">1）账单信息</div>
        <div className="channel-bill-meta-grid">
          <div className="form-group channel-bill-meta-grid__partner">
            <label>合作方 *</label>
            <PartnerPicker value={header.partnerName || header.channelName} partnerId={partnerId} partners={partners} onChange={handlePartnerChange} onAddPartner={onAddPartner} required linkedText={selectedPartner ? `已关联客户库 · 简称：${selectedPartner.shortName || selectedPartner.name}` : '已关联客户库'} unlinkedText="输入简称或公司全称，并从客户库结果中选择" />
          </div>
          <div className="form-group channel-bill-meta-grid__remark">
            <label>备注 / 特殊说明</label>
            <textarea
              rows={3}
              value={header.remark}
              onChange={(e) => handleHeaderChange('remark', e.target.value)}
              className="admin-input channel-bill-remark-textarea"
              placeholder="选填，例如：10月差异结转至12月；特殊扣款；双方确认按实际金额结算；下月冲抵等"
              style={{ height: 'auto', minHeight: 72, padding: '8px 10px', lineHeight: 1.5, resize: 'vertical' }}
            />
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
          {contractAwareMode && contractRuleNeedsOverride && !targetedRuleLocked ? (
            <div className="channel-contract-rule-override">
              <div><strong>业务差异 · 当前值未完全按合同清单</strong><span>如确需人工覆盖，必须填写原因；该原因会随账单备注保存。</span></div>
              <input type="text" value={contractOverrideReason} onChange={(event) => setContractOverrideReason(event.target.value)} placeholder="例如：商务临时约定、历史口径、合同清单待补录" />
            </div>
          ) : null}
          <div className="channel-rule-grid">
            <label><span>规则模板</span><select value={effectiveRuleHeader.settlementRuleCode} disabled={targetedRuleLocked} onChange={(e) => handleRulePresetChange(e.target.value)}>{Object.entries(CHANNEL_RULE_PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}</select></label>
            <label><span>渠道费模式</span><select value={effectiveRuleHeader.channelFeeMode} disabled={targetedRuleLocked} onChange={(e) => handleRuleFieldChange('channelFeeMode', e.target.value)}><option value="none">不扣渠道费</option><option value="percent">百分比</option><option value="fixed">固定金额/行</option></select></label>
            <label><span>渠道费率%</span><input type="number" step="0.01" min="0" max="100" value={effectiveRuleHeader.channelFeeRate} disabled={targetedRuleLocked || feeMode !== 'percent'} onChange={(e) => handleRuleFieldChange('channelFeeRate', e.target.value)} placeholder={feeMode === 'percent' ? '如 5' : '当前不使用'} /></label>
            <label><span>税处理</span><select value={effectiveRuleHeader.taxMode} disabled={targetedRuleLocked} onChange={(e) => handleRuleFieldChange('taxMode', e.target.value)}><option value="none">仅记录，不参与</option><option value="share">按分成额扣税</option><option value="after_fee">渠道费后再扣税</option></select></label>
            <label><span>差异容差（元）</span><input type="number" step="0.01" min="0" value={header.validationTolerance} onChange={(e) => handleRuleFieldChange('validationTolerance', e.target.value)} /></label>
          </div>
          <div className="channel-rule-formula"><span>当前公式</span><strong>{mixedLineContractRules ? '按每行合同规则分别计算（分成、通道费、税处理均以明细匹配结果为准）' : ruleFormulaText(effectiveRuleHeader)}</strong></div>
        </section>
      </div>

      <div className="channel-form-section">
        <div className="form-section-title channel-bill-detail-title"><span>2）游戏明细</span><span className="channel-bill-period-badge">{periodSummary(lines)}</span></div>
        <LineItemsTable onAddRow={addLine} showAddButton={false} hint="结算月份只能选择本月或过去月份；历史账期允许保存但会提醒核对，未来账期会被前后端同时拦截。">
          <table className="channel-line-items-table">
            <thead><tr><th>结算月份</th><th>游戏名称</th><th>后台流水</th><th>折扣系数</th><th>总流水</th><th>代金券</th><th>无忧试</th><th>玩家退款</th><th>测试费</th><th>福利币</th><th>其他扣减</th><th>分成%</th><th>税率%</th><th>通道费</th><th>计费额</th><th>分成额</th><th>系统结算</th><th>平台结算</th><th>差异</th><th>校验</th><th>操作</th></tr></thead>
            <tbody>{lines.map((row, index) => {
              const rowRuleHeader = resolveChannelLineRuleHeader(row, effectiveRuleHeader)
              const rowFeeMode = rowRuleHeader.channelFeeMode || 'fixed'
              const details = calculateSettlementDetails(row, rowRuleHeader)
              const monthRisk = settlementMonthRisk(row.settlementCycle, currentMonthKey)
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
                  <td><input type="number" step="0.01" className="admin-input" value={row.flow} onChange={(e) => handleLineChange(index, 'flow', e.target.value)} /></td>
                  <td><input type="number" step="0.000001" min="0" className="admin-input" value={row.discountFactor} onChange={(e) => handleLineChange(index, 'discountFactor', e.target.value)} placeholder="默认1" /></td>
                  <td className="channel-line-num">{effectiveLineFlowFromFormData(row).toFixed(2)}</td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.voucherCost} onChange={(e) => handleLineChange(index, 'voucherCost', e.target.value)} /></td>
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
        <div style={{ marginTop: 10, border: '1px solid #dbe5f3', borderRadius: 10, padding: '10px 12px', background: '#f8fbff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 8 }}>
            <div style={{ display: 'grid', gap: 2 }}>
              <strong style={{ fontSize: 13 }}>结算调整（通用）</strong>
              <span style={{ color: '#667085', fontSize: 11 }}>所有渠道都可用；普通账单保持为空。跨月差额、补扣、补款时才填写，不会改写上面的游戏明细。</span>
            </div>
            {adjustmentActive ? <span style={{ fontSize: 11, color: '#9a6700', background: '#fff8c5', borderRadius: 999, padding: '3px 8px' }}>已启用调整</span> : <span style={{ fontSize: 11, color: '#667085' }}>未启用</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, .8fr) minmax(125px, .7fr) minmax(140px, .8fr) minmax(150px, .8fr) minmax(220px, 1.6fr)', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 11 }}><span>调整类型</span><select className="admin-input" value={header.settlementAdjustmentType || ''} onChange={(e) => handleHeaderChange('settlementAdjustmentType', e.target.value)}><option value="">不调整</option><option value="historical_carryover">历史差额结转</option><option value="business_makeup">商务补差</option><option value="offset">补扣 / 冲抵</option><option value="other">其他</option></select></label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11 }}><span>来源账期</span><input type="month" max={currentMonthKey} className="admin-input" value={normalizeChannelSettlementCycle(header.settlementAdjustmentSourceMonth)} onChange={(e) => handleHeaderChange('settlementAdjustmentSourceMonth', e.target.value)} /></label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11 }}><span>调整金额（可正负）</span><input type="number" step="0.01" className="admin-input" value={header.settlementAdjustmentAmount ?? ''} onChange={(e) => handleHeaderChange('settlementAdjustmentAmount', e.target.value)} placeholder="扣减如 -498.64" /></label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11 }}><span>最终确认金额（选填）</span><input type="number" step="0.01" min="0" className="admin-input" value={header.settlementFinalOverride ?? ''} onChange={(e) => handleHeaderChange('settlementFinalOverride', e.target.value)} placeholder="如双方确认 376.00" /></label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11 }}><span>调整原因 {adjustmentActive ? '*' : ''}</span><input type="text" className="admin-input" value={header.settlementAdjustmentReason || ''} onChange={(e) => handleHeaderChange('settlementAdjustmentReason', e.target.value)} placeholder="例如：10月差额于12月结转，双方确认最终金额" /></label>
          </div>
          {adjustmentActive ? (
            <div style={{ marginTop: 9, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12 }}>
              <span>本期业务结算 <strong>{formatMoney(totals.businessSettlement)}</strong></span>
              <span>+</span>
              <span>调整 <strong>{totals.adjustment >= 0 ? '+' : ''}{formatMoney(totals.adjustment)}</strong></span>
              <span>=</span>
              <span>计算后 <strong>{formatMoney(totals.afterAdjustment)}</strong></span>
              {String(header.settlementFinalOverride ?? '').trim() !== '' ? <><span>→</span><span>最终确认 <strong>{formatMoney(totals.settlement)}</strong></span></> : null}
              {Math.abs(totals.adjustmentTail) >= 0.005 ? <span style={{ color: '#9a6700' }}>尾差 {totals.adjustmentTail >= 0 ? '+' : ''}{formatMoney(totals.adjustmentTail)}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="channel-rule-summary">
          <div><span>系统计算合计</span><strong>{formatMoney(totals.system)}</strong></div>
          <div><span>平台结算合计</span><strong>{totals.platform == null ? '未录入' : formatMoney(totals.platform)}</strong></div>
          <div className={validationTone}><span>系统 - 平台</span><strong>{totals.difference == null ? '-' : `${totals.difference >= 0 ? '+' : ''}${formatMoney(totals.difference)}`}</strong></div>
          <div className={validationTone}><span>校验状态</span><strong>{validationText(totals.validationStatus)}</strong></div>
          <div><span>允许误差</span><strong>±{formatMoney(header.validationTolerance)}</strong></div>
        </div>
      </div>
    </form>
  )
}

export default ChannelBillingForm