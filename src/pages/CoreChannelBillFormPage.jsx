import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import BillScanAttachments from '@/components/billing/BillScanAttachments.jsx'
import { listBillAttachments } from '@/lib/api/billAttachments.ts'
import ChannelReviewConfirmation from '@/components/channel/ChannelReviewConfirmation.jsx'
import ChannelBillingForm from '@/components/channel/ChannelBillingForm.jsx'
import ChannelSmallVarianceApprovalPanel from '@/components/channel/ChannelSmallVarianceApprovalPanel.jsx'
import ChannelBillReadonlyView from '@/components/channel/ChannelBillReadonlyView.jsx'
import LockedBillEditNotice from '@/components/reconciliation/LockedBillEditNotice.jsx'
import ChannelCumulativeSettlementCard from '@/components/channel/ChannelCumulativeSettlementCard.jsx'
import ReviewedChannelCumulativeSection from '@/components/channel/ReviewedChannelCumulativeSection.jsx'
import ContractDifferenceActionPanel from '@/components/reconciliation/ContractDifferenceActionPanel.jsx'
import ChannelSmartEntryBar from '@/components/channel/ChannelSmartEntryBar.jsx'
import { findExactPartner } from '@/components/shared/PartnerPicker.jsx'
import { CoreBillLoadingState } from '@/pages/CoreBillLoadingState.jsx'
import { VIEWS } from '@/app/routes.js'
import { isBillLockedStatus } from '@/domain/reconciliation/billLifecycle.js'
import { apiChannelRowToFrontend, getChannelRecord } from '@/lib/api/channel.ts'
import {
  ContractDifferenceBlockedError,
  transitionBillLifecycle,
  confirmApprovedChannelSmallVariance,
  confirmReviewedChannelPlatformVariance,
  assertContractReadyForPlatformTail,
  getChannelOfficialStatementPolicy,
  getChannelManualReviewException
} from '@/lib/api/billLifecycle.ts'
import { getContractBillReconciliation } from '@/lib/api/contractTerms.ts'
import { listContractDifferenceCases, handleContractDifferenceCase } from '@/lib/api/contractDifferences.ts'
import { prepareChannelSpecialSettlement } from '@/domain/channel/channelSpecialSettlement.js'
import { assessChannelSmallVariancePreflight } from '@/domain/channel/channelSmallVarianceReview.js'
import { assessSavedChannelPlatformDifference, buildChannelPlatformApprovalNote, isSingleBillManualReviewCandidate } from '@/domain/channel/channelPlatformVarianceReview.js'
import { assessChannelSavePreflight } from '@/domain/channel/channelSavePreflight.js'
import { getRecentApiErrorMessage } from '@/lib/api/client.ts'
import {
  invalidateEditRecord,
  loadEditRecord
} from '@/lib/api/editRecordCache.js'
import {
  isMeaningfulChannelDraft,
  normalizeChannelDraft
} from '@/domain/drafts/billDrafts.js'
import {
  isSmartGeneratedMessage,
  resolveChannelContractAuthority,
  sanitizeGeneratedHistoryRules
} from '@/domain/channel/channelRuleAuthority.js'
import { useBillFormSafety } from '@/hooks/useBillFormSafety.js'
import './CoreBillFormPages.css'
import '@/components/reconciliation/reconciliation-admin.css'
import '@/styles/SimplifiedBillReview.css'
import './ChannelBillCompact.css'

async function assessCurrentPlatformReview(savedBill) {
  const honor = savedBill.partner_name === '荣耀' && (!savedBill.channel_name || savedBill.channel_name === '荣耀')
  const policy = honor ? (await getChannelOfficialStatementPolicy(String(savedBill.id))).policy : null
  const exception = isSingleBillManualReviewCandidate(savedBill)
    ? (await getChannelManualReviewException(String(savedBill.id), savedBill.updated_at)).exception : null
  return assessSavedChannelPlatformDifference(savedBill, policy, exception)
}

const FORM_ID = 'core-channel-bill-form'

function money(value) {
  const n = Number(value || 0)
  return `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function normalizedAmount(value) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0
}

function isZeroSettlement(value) {
  return normalizedAmount(value) === 0
}

function hasNonZeroValue(value) {
  const amount = Number(value)
  return Number.isFinite(amount) && Math.abs(amount) > 0.000001
}

function hasAdvancedChannelData(record) {
  const items = Array.isArray(record?.items) ? record.items : []
  return items.some((item) => {
    const discountText = String(item?.discountFactor ?? '').trim()
    const discount = discountText === '' ? 1 : Number(discountText)
    const hasDiscount = Number.isFinite(discount) && Math.abs(discount - 1) > 0.000001
    const hasSpecialAmount = [
      item?.voucherCost,
      item?.noWorryCost,
      item?.refundCost,
      item?.testCost,
      item?.welfareCost,
      item?.coinCost
    ].some(hasNonZeroValue)
    return hasDiscount || hasSpecialAmount
  })
}

function hasChannelFeeConfiguration(record) {
  const headerMode = String(record?.channelFeeMode || '').trim()
  if (headerMode && headerMode !== 'none') return true
  if (hasNonZeroValue(record?.channelFeeRate)) return true
  const items = Array.isArray(record?.items) ? record.items : []
  return items.some((item) => {
    const mode = String(item?.channelFeeMode || '').trim()
    return (mode && mode !== 'none') || hasNonZeroValue(item?.channelFeeRate) || hasNonZeroValue(item?.gatewayCost)
  })
}

function reviewValidation(record) {
  if (!String(record?.partnerName || record?.channelName || '').trim()) return '请先选择合作方。'
  if (!String(record?.settlementMonth || '').trim()) return '请先选择账单月份。'
  const items = Array.isArray(record?.items) ? record.items : []
  const validItems = items.filter((item) => String(item?.gameName || '').trim())
  if (!validItems.length) return '请至少填写一条游戏明细。'
  if (normalizedAmount(record?.settlementAmount) < 0) {
    return '结算金额为负，请先检查退款、冲抵或费用配置；负数账单不能按普通应收流程确认。'
  }
  return ''
}

function authorityText(state) {
  if (state.status === 'loading') return '正在按游戏 + 渠道 + 账期读取合同规则；历史账单只用于识别和参考，不会覆盖合同。'
  if (state.status === 'error') return '合同规则读取失败；系统已阻止自动沿用上月分成/税率/通道费，请稍后重试或人工确认。'
  if (state.status === 'ok') return `合同规则已明确应用 ${state.matched}/${state.total} 个游戏；历史账单不会反向覆盖合同。`
  if (state.status === 'warning') {
    const confirmText = state.needsConfirmation ? `，其中 ${state.needsConfirmation} 个存在合同候选需确认` : ''
    return `合同规则已应用 ${state.matched}/${state.total} 个游戏；${state.unmatched} 个未自动套用历史规则${confirmText}。`
  }
  return ''
}

function CoreChannelBillFormPage({ mode }) {
  const {
    recon,
    settings,
    showToast,
    setActiveView,
    setNavigationBlocker,
    clearNavigationBlocker,
    openBill360,
    channelEditRecordId,
    channelReturnView,
    channelCreatePrefill
  } = useAppState()
  const isEdit = mode === 'edit'
  // Only a customer ID resolved by the ledger is accepted. This is NOT a
  // copy of a historical bill, and never supplies games/flows/settlements.
  const createPrefill = !isEdit && channelCreatePrefill?.partnerId ? channelCreatePrefill : null
  const prefillRecord = useMemo(() => createPrefill ? {
    partnerName: createPrefill.partnerName,
    channelName: createPrefill.channelName,
    items: []
  } : null, [createPrefill?.partnerId, createPrefill?.partnerName, createPrefill?.channelName])
  const view = isEdit ? VIEWS.CHANNEL_RECON_EDIT : VIEWS.CHANNEL_RECON_CREATE
  const submitIntentRef = useRef('back')
  const authorityRequestRef = useRef(0)
  const [auditReason, setAuditReason] = useState('')
  useEffect(() => setAuditReason(''), [channelEditRecordId, mode])
  const [previewAmount, setPreviewAmount] = useState(0)
  const [remoteRecord, setRemoteRecord] = useState(null)
  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [reviewing, setReviewing] = useState(false)
  const reviewInFlightRef = useRef(false)
  const reviewGenerationRef = useRef(0)
  const [reviewRequest, setReviewRequest] = useState(null)
  const [reviewPhase, setReviewPhase] = useState('')
  useEffect(() => {
    reviewGenerationRef.current += 1
    reviewInFlightRef.current = false
    setReviewing(false)
    setReviewPhase('')
    return () => { reviewGenerationRef.current += 1 }
  }, [mode, channelEditRecordId])
  const [inlineIssue, setInlineIssue] = useState(null)
  const [differenceSeedItems, setDifferenceSeedItems] = useState([])
  const [showSmallVariancePanel, setShowSmallVariancePanel] = useState(false)
  const [smallVarianceKind, setSmallVarianceKind] = useState('contract')
  const [platformVarianceReview, setPlatformVarianceReview] = useState(null)
  const [platformEvidenceAttachments, setPlatformEvidenceAttachments] = useState([])
  const [platformEvidenceLoading, setPlatformEvidenceLoading] = useState(false)
  const [platformEvidenceId, setPlatformEvidenceId] = useState('')
  const [officialConfirmedLineIds, setOfficialConfirmedLineIds] = useState([])
  const [smallVarianceNote, setSmallVarianceNote] = useState('')
  const [manualReviewConfirmed, setManualReviewConfirmed] = useState(false)
  const [smartRecord, setSmartRecord] = useState(null)
  const [smartRevision, setSmartRevision] = useState(0)
  const [compactMode, setCompactMode] = useState(true)
  const [ruleAuthority, setRuleAuthority] = useState({
    status: 'idle',
    total: 0,
    matched: 0,
    unmatched: 0,
    needsConfirmation: 0
  })

  useEffect(() => {
    authorityRequestRef.current += 1
    setSmartRecord(null)
    setReviewRequest(null)
    setSmartRevision(0)
    setInlineIssue(null)
    setDifferenceSeedItems([])
    setShowSmallVariancePanel(false)
    setSmallVarianceKind('contract')
    setPlatformVarianceReview(null)
    setManualReviewConfirmed(false)
    setPlatformEvidenceAttachments([])
    setPlatformEvidenceId('')
    setSmallVarianceNote('')
    setRuleAuthority({ status: 'idle', total: 0, matched: 0, unmatched: 0, needsConfirmation: 0 })
  }, [mode, channelEditRecordId])

  useEffect(() => {
    if (!isEdit) return
    if (!channelEditRecordId) {
      setRemoteRecord(null)
      setLoading(false)
      setLoadError('')
      return
    }

    const recordId = String(channelEditRecordId)
    // A cached "pending" row is not proof the server remains editable.
    // Always read the authoritative status when entering the editor.
    let cancelled = false
    async function loadRecord() {
      setRemoteRecord(null)
      setLoading(true)
      setLoadError('')
      try {
        const record = await loadEditRecord('channel', recordId, async () => {
          const row = await getChannelRecord(recordId)
          return apiChannelRowToFrontend(row)
        }, { force: true })
        if (!cancelled) {
          setRemoteRecord(record)
          // A successfully refreshed snapshot resolves only the old revision alert.
          // Failed reloads keep the issue; unrelated validation errors remain.
          setInlineIssue((issue) => issue?.kind === 'stale-status' ? null : issue)
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error && error.message
              ? error.message
              : '读取账单明细失败，请稍后重试。'
          setLoadError(message)
          showToast('渠道账单加载失败，可以在当前页面重试', 'error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRecord()
    return () => {
      cancelled = true
    }
  }, [isEdit, channelEditRecordId, loadAttempt, showToast])

  const editRecord = remoteRecord
  const stableRecord =
    editRecord && (!editRecord.id || editRecord.id === '')
      ? { ...editRecord, id: String(channelEditRecordId) }
      : editRecord

  const safety = useBillFormSafety({
    type: 'channel',
    title: isEdit ? '编辑渠道账单' : '新增渠道账单',
    mode: isEdit ? 'edit' : 'add',
    view,
    recordId: isEdit ? String(channelEditRecordId || '') : '',
    initialRecord: stableRecord,
    // Scoped new-bill drafts cannot overwrite the user's unrelated generic
    // draft or another company's unfinished statement.
    draftScope: createPrefill ? `partner:${createPrefill.partnerId}` : '',
    normalize: normalizeChannelDraft,
    isMeaningful: isMeaningfulChannelDraft,
    setNavigationBlocker,
    clearNavigationBlocker
  })

  const listSnapshot = isEdit
    ? (recon.channelRecords || []).find(
        (row) => String(row?.id || '') === String(channelEditRecordId || '')
      )
    : null
  const loadingSummary = listSnapshot
    ? [
        { label: '账单编号', value: listSnapshot.billNumber || listSnapshot.statementNo || '-' },
        { label: '渠道', value: listSnapshot.channelName || '-' },
        { label: '账单月份', value: listSnapshot.settlementMonth || '-' },
        { label: '结算金额', value: money(listSnapshot.settlementAmount) }
      ]
    : []

  const goList = () => setActiveView(channelReturnView || VIEWS.RECON_CHANNEL)

  const retryLoad = () => {
    if (!channelEditRecordId) return
    invalidateEditRecord('channel', String(channelEditRecordId))
    setLoadAttempt((value) => value + 1)
  }

  const focusProblemTarget = (element) => {
    if (!element) return false
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    element.classList.remove('core-bill-problem-target')
    void element.offsetWidth
    element.classList.add('core-bill-problem-target')
    window.setTimeout(() => element.classList.remove('core-bill-problem-target'), 2600)
    const focusable = element.matches?.('input,select,textarea,button')
      ? element
      : element.querySelector?.('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])')
    focusable?.focus?.({ preventScroll: true })
    return true
  }

  const openContractDifferenceWorkbench = () => {
    if (!isEdit) return
    window.setTimeout(() => {
      focusProblemTarget(document.getElementById('channel-contract-difference-workbench'))
    }, 30)
  }

  const locateIssue = (issue = inlineIssue) => {
    if (!issue) return
    if (issue.kind === 'contract') {
      openContractDifferenceWorkbench()
      return
    }

    const message = String(issue.message || '')
    const form = document.getElementById(FORM_ID)
    let target = null
    const lineMatch = message.match(/第\s*(\d+)\s*行/)
    if (lineMatch) {
      const rowIndex = Math.max(1, Number(lineMatch[1]) || 1)
      target = form?.querySelector(`.channel-line-items-table tbody tr:nth-child(${rowIndex})`)
    }
    if (!target && /合作方|客户库/.test(message)) {
      target = form?.querySelector('.channel-bill-meta-grid__partner')
    }
    if (!target && /调整原因|结算调整|冲抵|补差/.test(message)) {
      // The exceptional adjustment editor is collapsed by default.
      // Its action row remains focusable even before the inputs are expanded.
      target = form?.querySelector('.channel-optional-adjustment .channel-optional-toggle')
    }
    if (!target && /合同|分成|税率|通道费|匹配/.test(message)) {
      target = form?.querySelector('.channel-rule-panel')
    }
    if (!target && /结算月份|账单月份|游戏明细/.test(message)) {
      target = form?.querySelector('.channel-line-items-table tbody tr:first-child')
    }
    focusProblemTarget(target || form)
  }

  const reportIssue = (
    message,
    { kind = 'form', title = '账单暂时无法保存', saved = false, toast = true, autoLocate = true } = {}
  ) => {
    const issue = {
      kind,
      title,
      message: String(message || '发生未知错误，请检查当前账单后重试。'),
      saved
    }
    setInlineIssue(issue)
    if (toast) showToast(issue.message, 'error')
    if (autoLocate) window.setTimeout(() => locateIssue(issue), 70)
    return issue
  }

  const handleChannelUpdateRecord = async (recordId, record, isCurrentAttempt = () => true) => {
    try {
      const result = await recon.onChannelUpdateRecord?.(recordId, {
        ...record,
        auditReason,
        updatedAt: stableRecord?.updatedAt || record?.updatedAt
      }, { returnSavedRecord: true })
      if (!isCurrentAttempt()) return false
      if (result === false) {
        const serverMessage = getRecentApiErrorMessage()
        const reason = serverMessage || '服务器没有接受本次保存。请按提示处理后重新保存。'
        const stateChanged = /锁定|已核对|服务器账单已更新|版本|状态流转/.test(reason)
        reportIssue(reason, {
          kind: stateChanged ? 'stale-status' : 'save',
          title: stateChanged ? '服务器状态已变化 · 本次没有覆盖账单' : '账单未保存',
          autoLocate: !stateChanged
        })
        return false
      }
      if (!result || typeof result !== 'object' || String(result.id) !== String(recordId)
        || !result.updated_at || !Number.isFinite(new Date(result.updated_at).getTime())) {
        reportIssue('未能验证服务器保存结果，本机修改会保留。本次不继续核对，请重新读取账单状态。',
          { kind: 'stale-status', title: '保存结果待确认', autoLocate: false })
        return false
      }
      const persistedRecord = apiChannelRowToFrontend(result)
      if (JSON.stringify(normalizeChannelDraft(record)) !== JSON.stringify(normalizeChannelDraft(persistedRecord))
        || normalizedAmount(record.settlementAmount) !== normalizedAmount(persistedRecord.settlementAmount)) {
        reportIssue('服务器返回的账单内容与本次提交不一致，已暂停核对。本机修改仍保留，请重新读取并核对最新内容。',
          { kind: 'stale-status', title: '保存后的内容需要重新核对', autoLocate: false })
        return false
      }
      setInlineIssue(null)
      // Only this PUT's acknowledged snapshot may advance our edit baseline.
      // Never adopt an unrelated GET revision just to make a retry pass.
      setRemoteRecord(persistedRecord)
      setAuditReason('')
      return result
    } catch (error) {
      if (!isCurrentAttempt()) return false
      const message = error instanceof Error && error.message
        ? error.message
        : '账单保存失败，请根据当前页提示修正后重试。'
      const lockedOrChanged = /锁定|已核对|版本|服务器账单已更新|状态流转|退回待核对/.test(message)
      reportIssue(message, {
        kind: lockedOrChanged ? 'stale-status' : 'save',
        title: lockedOrChanged ? '服务器状态已变化 · 本次没有覆盖账单' : '账单未保存',
        autoLocate: !lockedOrChanged
      })
      throw error
    }
  }

  const handleAfterSubmit = (intent) => {
    authorityRequestRef.current += 1
    safety.clearAfterSubmit()
    setSmartRecord(null)
    setSmartRevision((value) => value + 1)
    setRuleAuthority({ status: 'idle', total: 0, matched: 0, unmatched: 0, needsConfirmation: 0 })
    if (isEdit && channelEditRecordId) {
      invalidateEditRecord('channel', String(channelEditRecordId))
    }
    if (intent === 'continue') {
      showToast('已保存，可继续新增下一张渠道账单', 'success')
      return
    }
    goList()
  }

  const applySmartRecord = async (nextRecord, message = '', tone = 'success') => {
    const shouldResolve = /(已生成|游戏清单|上月账单|自动重新匹配|名称映射|合同规则已更新|补入合同合作清单|合作清单已创建)/.test(String(message || ''))
    if (!shouldResolve) {
      authorityRequestRef.current += 1
      setSmartRecord(nextRecord)
      setSmartRevision((value) => value + 1)
      if (message) showToast(message, tone)
      return
    }

    const generated = isSmartGeneratedMessage(message)
    const requestId = authorityRequestRef.current + 1
    authorityRequestRef.current = requestId
    const safeFallback = generated ? sanitizeGeneratedHistoryRules(nextRecord) : nextRecord
    const namedCount = (Array.isArray(nextRecord?.items) ? nextRecord.items : [])
      .filter((line) => String(line?.gameName || '').trim()).length
    setRuleAuthority({
      status: 'loading',
      total: namedCount,
      matched: 0,
      unmatched: namedCount,
      needsConfirmation: 0
    })

    try {
      const resolved = await resolveChannelContractAuthority(nextRecord, { generated })
      if (requestId !== authorityRequestRef.current) return
      const summary = resolved.summary || {}
      const matched = Number(summary.matched || 0)
      const total = Number(summary.total || 0)
      const needsConfirmation = Number(summary.needsConfirmation || 0)
      const unmatched = Number(summary.unmatched ?? Math.max(0, total - matched))
      setSmartRecord(resolved.record)
      setSmartRevision((value) => value + 1)
      setRuleAuthority({
        status: total > 0 && matched === total && needsConfirmation === 0 ? 'ok' : 'warning',
        total,
        matched,
        unmatched,
        needsConfirmation
      })
      if (message) showToast(message, tone)
    } catch (error) {
      if (requestId !== authorityRequestRef.current) return
      setSmartRecord(safeFallback)
      setSmartRevision((value) => value + 1)
      setRuleAuthority({
        status: 'error',
        total: namedCount,
        matched: 0,
        unmatched: namedCount,
        needsConfirmation: 0
      })
      if (message) showToast(message, tone)
      showToast('合同规则暂时读取失败；已阻止自动沿用上月分成，请稍后重试或人工确认。', 'error')
      console.warn('渠道账单合同优先规则读取失败', error)
    }
  }

  const confirmReview = async (approvedRequest = null) => {
    if (!isEdit || !channelEditRecordId || reviewing || reviewInFlightRef.current) return
    const candidate = safety.currentRecord || smartRecord || safety.draftRecord || stableRecord
    const validationMessage = reviewValidation(candidate)
    if (validationMessage) {
      reportIssue(validationMessage, { kind: 'form', title: '还不能确认核对' })
      return
    }

    const settlementAmount = normalizedAmount(candidate?.settlementAmount ?? previewAmount)
    const zeroSettlement = isZeroSettlement(settlementAmount)
    const hasPlatformDifference = String(candidate?.validationStatus ?? stableRecord?.validationStatus ?? '') === 'fail'
      && Number.isFinite(Number(candidate?.settlementDifference ?? stableRecord?.settlementDifference))
      && Math.abs(Number(candidate?.settlementDifference ?? stableRecord?.settlementDifference)) > 0.005
    // Platform discrepancies still use their existing written evidence approval.
    // Ordinary confirmation is an accessible in-app dialog, never a bypass.
    const signature = JSON.stringify(candidate)
    if (!hasPlatformDifference && (approvedRequest?.signature !== signature || approvedRequest?.billId !== String(channelEditRecordId))) {
      setReviewRequest({
        signature, billId: String(channelEditRecordId), zeroSettlement,
        partnerName: candidate?.partnerName || candidate?.channelName,
        month: candidate?.settlementMonth, amountLabel: money(settlementAmount), dirty: safety.dirty
      })
      return
    }
    setReviewRequest(null)
    const generation = reviewGenerationRef.current
    const isCurrentAttempt = () => reviewGenerationRef.current === generation
    reviewInFlightRef.current = true
    setReviewing(true)
    setReviewPhase('正在检查服务器状态…')
    setInlineIssue(null)
    const billId = String(channelEditRecordId)
    let savedSuccessfully = false
    let acknowledgedRecord = stableRecord
    let confirmedSuccessfully = false
    let completedSuccessfully = false
    try {
      // One authoritative preflight BEFORE writing any amount. Previously
      // confirmation saved first and discovered an already-locked status after
      // the write had failed, trapping users between two contradictory views.
      const currentBill = await getChannelRecord(billId)
      if (!isCurrentAttempt()) return
      const preflight = assessChannelSavePreflight(stableRecord, currentBill)
      if (!preflight.allowed) {
        reportIssue(preflight.message, {
          kind: 'stale-status',
          title: preflight.kind === 'locked' ? '服务器已锁单 · 不可覆盖金额' : '服务器版本已变化',
          saved: false, autoLocate: false
        })
        safety.flushDraft()
        retryLoad()
        return
      }
      if (safety.dirty) {
        setReviewPhase('正在保存修改…')
        const saved = await handleChannelUpdateRecord(billId, {
          ...stableRecord,
          ...candidate,
          id: billId,
          status: currentBill.status || 'pending',
          // Keep the opened revision for backend optimistic concurrency.
          updatedAt: stableRecord?.updatedAt || currentBill.updated_at
        }, isCurrentAttempt)
        if (!isCurrentAttempt()) return
        if (saved === false) {
          // A concurrent update may have happened between preflight and PUT.
          // Reload safely, keeping an incompatible local draft for recovery.
          safety.flushDraft()
          retryLoad()
          return
        }
        if (saved && typeof saved === 'object' && saved.updated_at) {
          acknowledgedRecord = apiChannelRowToFrontend(saved)
        }
        savedSuccessfully = true
        safety.clearAfterSubmit()
        setSmartRecord(null)
        invalidateEditRecord('channel', billId)
      } else {
        // An identical second save used to delete/reinsert all game lines, so
        // previously approved contract differences were orphaned. Directly
        // verify the server-persisted bill when there are no unsaved changes.
        savedSuccessfully = true
      }

      // The initial edit snapshot may have been superseded in a second tab.
      // Verify the current persisted status before *any* confirmation attempt.
      setReviewPhase('账单已保存，正在校验核对条件…')
      const savedBill = await getChannelRecord(billId)
      if (!isCurrentAttempt()) return
      const savedStatus = String(savedBill.status || 'pending').trim().toLowerCase()
      if (savedStatus !== 'pending') {
        retryLoad()
        reportIssue(
          `服务器账单现在是「${savedStatus === 'confirmed' ? '已核对' : savedStatus}」，不能再次从旧页面保存或核对。请重新读取服务器状态；需要改金额时，先使用已有的修改账单流程。`,
          { kind: 'stale-status', title: '服务器状态已变化 · 本次未覆盖账单', saved: savedSuccessfully, autoLocate: false }
        )
        return
      }
      if (acknowledgedRecord?.updatedAt && savedBill.updated_at
        && new Date(acknowledgedRecord.updatedAt).getTime() !== new Date(savedBill.updated_at).getTime()) {
        reportIssue(
          '本张账单已由其他操作更新，当前页面的数据不是最新版本。本次没有确认；请重新读取服务器账单再操作。',
          { kind: 'stale-status', title: '账单版本已变化 · 本次未确认', saved: false, autoLocate: false }
        )
        return
      }
      if (savedBill.partner_name === '荣耀' && (!savedBill.channel_name || savedBill.channel_name === '荣耀')
        && (!(savedBill.items || []).length || savedBill.items.some(line => line.platform_settlement_amount == null))) {
        reportIssue('荣耀账单必须逐游戏录入官方结算金额，不能用公式金额代替尚未提供的官方金额。',
          { kind: 'review', title: '账单已保存，官方结算金额尚未补齐', saved: true })
        return
      }
      // A saved platform discrepancy goes through the existing audit review
      // rather than a guaranteed-failing ordinary confirmed transition.
      if (String(savedBill.validation_status || '').toLowerCase() === 'fail') {
        const review = await assessCurrentPlatformReview(savedBill)
        if (!isCurrentAttempt()) return
        if (review.eligible) {
          const documented = review.reviewKind === 'documented'
          setInlineIssue({
            kind: 'platform',
            title: review.manualException ? '账单已保存 · 单笔人工核对' : documented ? '账单已保存 · 核对平台原始结算单' : '账单已保存 · 小额平台尾差',
            saved: true,
            message: `系统计算 ${money(review.systemAmount)}，平台实结 ${money(review.platformAmount)}，差额 ${money(Math.abs(review.differenceCents / 100))}。请按下方提示核对并留痕；不修改真实金额。`
          })
          openSmallVariancePanel('platform', review)
          return
        }
        reportIssue(
          review.error || '系统金额与平台结算存在未核实差异，请核对账单明细',
          { kind: 'review', title: '账单已保存，平台金额需先核对', saved: true }
        )
        return
      }

      setReviewPhase('正在执行核对并锁定账单…')
      const lifecycle = await transitionBillLifecycle('channel', billId, 'confirmed', '')
      if (!isCurrentAttempt()) return
      confirmedSuccessfully = true
      if (zeroSettlement) {
        setReviewPhase('已核对，正在结清零结算账单…')
        await transitionBillLifecycle('channel', billId, 'completed', '')
        if (!isCurrentAttempt()) return
        completedSuccessfully = true
      }
      await recon.refetchChannelFromApi?.()
      if (!isCurrentAttempt()) return
      const deferred = Boolean(lifecycle?.settlement_condition?.deferred)
      setInlineIssue(null)
      setDifferenceSeedItems([])
      showToast(
        zeroSettlement
          ? '零结算账单已核对并结清'
          : deferred
            ? '核对完成，账单已锁定并进入累计结算池'
            : '核对完成，账单已锁定',
        'success'
      )
      goList()
    } catch (error) {
      if (!isCurrentAttempt()) return
      if (confirmedSuccessfully) {
        reportIssue(zeroSettlement && !completedSuccessfully
          ? '账单已核对并锁定，但零结算结清结果尚未确认。请重新读取服务器状态后处理，不要重复核对。'
          : '账单核对已成功，但列表刷新失败。请重新读取服务器状态，不要重复核对。',
        { kind: 'stale-status', title: '核对已成功 · 请刷新服务器状态', saved: true, autoLocate: false })
        return
      }
      const message = error instanceof Error && error.message
        ? error.message
        : savedSuccessfully
          ? '账单修改已保存，但确认核对失败，请在当前页处理后重试。'
          : '保存并确认核对失败，请在当前页处理后重试。'
      // The ordinary lifecycle rightly refuses platform mismatches. Use one
      // audited review for both <=¥0.50 tails and larger statement-backed
      // differences; never convert a difference into a false PASS.
      if (savedSuccessfully && (
        error?.errorCode === 'settlement_validation_failed' ||
        /系统计算与平台账单存在差异/.test(message)
      )) {
        try {
          const savedBill = await getChannelRecord(billId)
          if (!isCurrentAttempt()) return
          const review = await assessCurrentPlatformReview(savedBill)
          if (!isCurrentAttempt()) return
          if (review.eligible) {
            const documented = review.reviewKind === 'documented'
            setInlineIssue({
              kind: 'platform', saved: true,
              title: review.manualException ? '账单已保存 · 单笔人工核对' : documented ? '账单已保存 · 等待平台原始凭证核对' : '账单已保存 · 仅剩平台小额尾差',
              message: `系统计算 ${money(review.systemAmount)}，平台结算 ${money(review.platformAmount)}，差额 ${money(Math.abs(review.differenceCents / 100))}。${review.manualException ? '请填写真实文字依据并明确确认本次单笔免附件例外。' : documented ? '请上传平台原始结算单并填写人工审核原因。' : '填写人工核对说明即可继续。'}原账单金额不会被修改。`
            })
            openSmallVariancePanel('platform', review)
            return
          }
        } catch (lookupError) {
          console.warn('读取平台金额差异核对依据失败', lookupError)
        }
      }
      if (!isCurrentAttempt()) return
      const contractRelated = /合同|差异|核验|特殊结算|匹配/.test(message)
      const contractDifferences = error instanceof ContractDifferenceBlockedError
        ? error.contractDifferences || []
        : []
      if (contractDifferences.length) setDifferenceSeedItems(contractDifferences)
      const issue = reportIssue(message, {
        kind: contractRelated ? 'contract' : 'review',
        title: savedSuccessfully ? '修改已保存，但核对未完成' : '保存 / 核对未完成',
        saved: savedSuccessfully,
        toast: false,
        autoLocate: false
      })
      showToast(savedSuccessfully ? `修改已保存；${message}` : message, 'error')
      if (contractRelated) openContractDifferenceWorkbench()
      else window.setTimeout(() => locateIssue(issue), 70)
    } finally {
      if (isCurrentAttempt()) {
        reviewInFlightRef.current = false
        setReviewPhase('')
        setReviewing(false)
      }
    }
  }

  // One explicit finance approval replaces the multi-screen special-settlement
  // workflow. It acts on already-persisted values: no PUT, no fee/share rewrite.
  const confirmSavedSpecialSettlement = async () => {
    if (!isEdit || !channelEditRecordId || reviewing) return
    if (safety.dirty) {
      reportIssue('当前还有未保存的表单修改，请先点击“保存修改”，再按结算确认函核对。', {
        kind: 'form',
        title: '请先保存账单金额',
        saved: false
      })
      return
    }
    setReviewing(true)
    const billId = String(channelEditRecordId)
    try {
      const persisted = apiChannelRowToFrontend(await getChannelRecord(billId))
      // A fresh preflight also creates rate-only difference cases on the server,
      // even for a ¥0.04 monetary variance within the rounding tolerance.
      await getContractBillReconciliation('channel', billId)
      const latest = await listContractDifferenceCases({ billType: 'channel', billId, limit: 100 })
      const plan = prepareChannelSpecialSettlement({
        billId,
        record: persisted,
        cases: latest.items || []
      })
      if (plan.error) throw new Error(plan.error)

      const details = plan.actions.map((item) => item.description).join('\n')
      const approval = window.confirm(
        '请确认已核对本期渠道分成结算确认函。\n\n' +
        (details || '相关合同差异已人工处理。') + '\n\n' +
        '本次账单结算金额：' + money(persisted.settlementAmount) + '\n' +
        '确认后将登记本期特殊结算依据并完成核对。\n' +
        '不会修改原合同、分成、通道费、结算金额或收款数据。'
      )
      if (!approval) return

      for (const item of plan.actions) {
        await handleContractDifferenceCase(item.caseId, {
          action: 'accept_difference',
          reason_type: item.reasonType,
          description: item.description,
          evidence: item.evidence
        })
      }
      const zeroSettlement = isZeroSettlement(persisted.settlementAmount)
      await transitionBillLifecycle('channel', billId, 'confirmed', '按本期渠道结算确认函进行特殊结算')
      if (zeroSettlement) {
        await transitionBillLifecycle('channel', billId, 'completed', '')
      }
      setInlineIssue(null)
      setDifferenceSeedItems([])
      invalidateEditRecord('channel', billId)
      try {
        await recon.refetchChannelFromApi?.()
      } catch (refreshError) {
        console.warn('特殊结算核对已完成，但账单列表刷新失败', refreshError)
      }
      showToast('账单已按本期结算确认函核对完成，结算金额未修改', 'success')
      goList()
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : '特殊结算核对失败，账单金额保持不变。'
      reportIssue(message, {
        kind: 'contract',
        title: '账单已保存，特殊结算核对未完成',
        saved: true,
        toast: false,
        autoLocate: false
      })
      showToast('账单金额保持已保存状态；' + message, 'error')
    } finally {
      setReviewing(false)
    }
  }

  const refreshPlatformEvidence = async () => {
    if (!channelEditRecordId) return
    setPlatformEvidenceLoading(true)
    try {
      const docs = await listBillAttachments('channel', String(channelEditRecordId))
      setPlatformEvidenceAttachments(docs)
      setPlatformEvidenceId(previous => (
        docs.some(item => item.id === previous) ? previous
          : docs.length === 1 ? docs[0].id : ''
      ))
    } finally {
      setPlatformEvidenceLoading(false)
    }
  }

  const openSmallVariancePanel = (kind = 'contract', review = null) => {
    setSmallVarianceKind(kind)
    setPlatformVarianceReview(review)
    setOfficialConfirmedLineIds([])
    setPlatformEvidenceAttachments([])
    setPlatformEvidenceId('')
    setManualReviewConfirmed(false)
    if (kind === 'platform' && review?.reviewKind === 'documented' && !review.manualException) {
      void refreshPlatformEvidence().catch((error) => {
        console.warn('读取已上传的渠道原始结算凭证失败', error)
        showToast('账单凭证列表暂时读取失败，可以上传后重新尝试', 'error')
      })
    }
    setSmallVarianceNote('')
    setShowSmallVariancePanel(true)
    window.setTimeout(() => {
      document.getElementById('channel-small-variance-approval')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      })
    }, 35)
  }

  const confirmSmallApprovedVariance = async () => {
    if (!isEdit || !channelEditRecordId || reviewing || reviewInFlightRef.current) return
    const note = smallVarianceNote.trim()
    if (smallVarianceKind === 'platform') {
      const documented = platformVarianceReview?.reviewKind === 'documented'
      const official = platformVarianceReview?.policyCode === 'honor_official_statement_v1'
      const manual = Boolean(platformVarianceReview?.manualException)
      if (!platformVarianceReview) {
        showToast('平台结算数据尚未就绪，请重新打开本张账单', 'error')
        return
      }
      const effectiveEvidenceId = platformEvidenceId || (
        platformEvidenceAttachments.length === 1 ? platformEvidenceAttachments[0].id : ''
      )
      if (documented && !manual && !effectiveEvidenceId) {
        showToast('请先上传或选择平台原始结算凭证', 'error')
        return
      }
      if (manual && (!manualReviewConfirmed || note.length < 12)) {
        showToast('请填写至少12个字的真实核对依据，并勾选单笔人工确认', 'error')
        return
      }
      if (official && (note.length < 6 || officialConfirmedLineIds.length !== platformVarianceReview.officialLines.length)) {
        showToast('请逐游戏勾选确认官方金额，并填写至少6个字的核对依据', 'error')
        return
      }
      const evidence = platformEvidenceAttachments.find(item => item.id === effectiveEvidenceId)
      const auditNote = buildChannelPlatformApprovalNote(platformVarianceReview, note, evidence?.file_name || '')
      if (safety.dirty) {
        showToast('有尚未保存的修改，请先保存后重新核对尾差', 'error')
        return
      }
      const generation = reviewGenerationRef.current
      const isCurrent = () => reviewGenerationRef.current === generation
      reviewInFlightRef.current = true
      setReviewing(true)
      try {
        // Strict contract preflight: neither unknown authorization nor
        // unresolved contract deviations can be waived by platform approval.
        await assertContractReadyForPlatformTail(String(channelEditRecordId), platformVarianceReview)
        if (!isCurrent()) return
        // The backend checks document ownership, current line IDs, balances and
        // contract history atomically. Do not block the user with a redundant
        // second attachment-list fetch before the actual confirmation.
        const lifecycle = await confirmReviewedChannelPlatformVariance(
          String(channelEditRecordId), auditNote, platformVarianceReview,
          documented && !manual ? effectiveEvidenceId : '', documented && !manual,
          official ? platformVarianceReview.officialLines.filter(line => officialConfirmedLineIds.includes(line.line_id)) : [],
          official ? note : '', manualReviewConfirmed, manual ? note : ''
        )
        if (!isCurrent()) return
        safety.clearAfterSubmit()
        invalidateEditRecord('channel', String(channelEditRecordId))
        setInlineIssue(null)
        setDifferenceSeedItems([])
        setShowSmallVariancePanel(false)
        setPlatformVarianceReview(null)
        setPlatformEvidenceAttachments([])
        setPlatformEvidenceId('')
            setSmallVarianceNote('')
        try {
          await recon.refetchChannelFromApi?.()
        } catch (refreshError) {
          console.warn('平台金额差异核对已完成，渠道列表刷新暂不可用', refreshError)
        }
        if (!isCurrent()) return
        showToast(lifecycle?.settlement_condition?.deferred
          ? '账单已核对、进入累计待结算池；未达到门槛前不催收，不代表实际到账'
          : manual ? '本单已按文字依据人工核对，原始金额、差异及收款保留；不适用于其他账单'
            : '平台实结金额已凭证核对并确认，原始规则与金额保留；请核实累计结算策略',
          'success')
        goList()
      } catch (error) {
        if (!isCurrent()) return
        setManualReviewConfirmed(false)
        if (error?.errorCode === 'manual_review_revision_changed') {
          setShowSmallVariancePanel(false)
          setPlatformVarianceReview(null)
        }
        const message = error instanceof Error ? error.message : '平台金额核对失败'
        reportIssue(message, {
          kind: 'platform', title: '金额已保存，人工核对尚未确认',
          saved: true, toast: false, autoLocate: false
        })
        showToast(message, 'error')
      } finally {
        if (isCurrent()) {
          reviewInFlightRef.current = false
          setReviewing(false)
        }
      }
      return
    }
    if (note.length < 2) {
      showToast('请先填写小额差异强制确认备注（至少2个字）', 'error')
      return
    }
    if (safety.dirty && !window.confirm(
      '本页仍有尚未提交到服务器的草稿。\n\n' +
      '强制核对只会使用服务器已保存的账单内容，绝不会将当前草稿写入账单。' +
      '\n确定以服务器保存值为准继续吗？'
    )) return

    if (!window.confirm(
      '请再次确认：仅对已人工确认、合计不超过¥0.50的合同金额差异做核对确认。\n\n' +
      '系统将保留当前服务器账单的金额、28%/5%等实际规则和合同原值；' +
      '全部审批依据和备注会留在操作日志中。是否继续？'
    )) return

    setReviewing(true)
    const billId = String(channelEditRecordId)
    try {
      const persisted = apiChannelRowToFrontend(await getChannelRecord(billId))
      if (String(persisted.status || '').toLowerCase() !== 'pending') {
        throw new Error('账单状态已变化，请刷新列表重新打开后再试')
      }
      const preflight = await getContractBillReconciliation('channel', billId)
      const assessment = assessChannelSmallVariancePreflight(preflight)
      if (assessment.error) throw new Error(assessment.error)

      const latest = await listContractDifferenceCases({ billType: 'channel', billId, limit: 200 })
      const cases = latest.items || []
      const failedIds = new Set(assessment.affectedLineIds)
      const unresolved = cases.filter(item =>
        failedIds.has(String(item.line_id || '')) &&
        item.status !== 'resolved'
      )

      if (unresolved.some(item =>
        item.handling_type && item.handling_type !== 'edit_bill'
      )) {
        throw new Error('本期合同差异正在补差或结转处理中，不允许覆盖原处理流程')
      }
      if (unresolved.length > 20) {
        throw new Error('合同差异数量过多，请在合同差异处理页面逐项核对')
      }

      // Each new case is approved through the existing audited contract action.
      // A repeated confirmation is safe: resolved records are not submitted again.
      for (const item of unresolved) {
        const difference = Math.abs(Number(item.expected_amount) - Number(item.actual_amount))
        if (!Number.isFinite(difference) || difference > 0.500001) {
          throw new Error('存在超过¥0.50的合同差异，已停止强制确认')
        }
        await handleContractDifferenceCase(item.id, {
          action: 'accept_difference',
          reason_type: '商务特殊约定',
          description: '管理员小额差异人工核准。' + note +
            '。保留当前服务器账单的分成、通道费、原结算金额，合同原值不修改。',
          evidence: ['账单修改记录及管理员本次人工确认备注']
        })
      }

      // Independent backend validation checks stored line economics, legal
      // authorization, accepted cases and 50-cent budget, then atomically logs
      // reviewer + note + variance and performs the lifecycle transition.
      await confirmApprovedChannelSmallVariance(billId, note)
      safety.clearAfterSubmit()
      invalidateEditRecord('channel', billId)
      setInlineIssue(null)
      setDifferenceSeedItems([])
      setShowSmallVariancePanel(false)
      setSmallVarianceNote('')
      try {
        await recon.refetchChannelFromApi?.()
      } catch (refreshError) {
        console.warn('小额差异核对已完成，刷新渠道列表暂时失败', refreshError)
      }
      showToast('小额合同差异已人工核准，账单已完成核对并保留原金额', 'success')
      goList()
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : '小额合同差异确认失败，请稍后重试'
      reportIssue(message, {
        kind: 'contract',
        title: '账单金额未改变，小额差异尚未确认完成',
        saved: true,
        toast: false,
        autoLocate: false
      })
      showToast(message, 'error')
    } finally {
      setReviewing(false)
    }
  }

  const discardDraft = () => {
    const confirmed = window.confirm('确定清除当前本机草稿并恢复为空白/服务器版本吗？')
    if (confirmed) {
      authorityRequestRef.current += 1
      setSmartRecord(null)
      setSmartRevision((value) => value + 1)
      setRuleAuthority({ status: 'idle', total: 0, matched: 0, unmatched: 0, needsConfirmation: 0 })
      safety.discardDraft()
    }
  }

  if (isEdit && !channelEditRecordId) {
    return <EmptyState title="请选择渠道账单" onBack={goList} />
  }

  if (loading || loadError) {
    return (
      <CoreBillLoadingState
        billType="渠道账单"
        summary={loadingSummary}
        error={loadError}
        onRetry={retryLoad}
        onBack={goList}
      />
    )
  }

  if (isEdit && !stableRecord) {
    return <EmptyState title="未找到渠道账单" onBack={goList} />
  }

  // Use the authoritative server record to render the full, readable bill.
  // Editing starts only after a required note is recorded and re-verification is enabled.
  if (isEdit && stableRecord && isBillLockedStatus(stableRecord.status)) {
    return (
      <LockedBillEditNotice
        billType="channel"
        record={stableRecord}
        onOpen360={() => {
          // Keep the reviewed bill visible while its audit drawer loads/closes.
          openBill360('channel', String(stableRecord.id), stableRecord)
        }}
        onBack={goList}
        onEditApproved={retryLoad}
      >
        <ReviewedChannelCumulativeSection record={stableRecord} />
        <ChannelBillReadonlyView recordId={String(stableRecord.id)} fallbackRecord={stableRecord} />
      </LockedBillEditNotice>
    )
  }

  const zeroSettlementPreview = isZeroSettlement(previewAmount)
  const currentRecord = safety.currentRecord || smartRecord || safety.draftRecord || prefillRecord || stableRecord || {}
  const hasAdvancedData = hasAdvancedChannelData(currentRecord)
  const hasChannelFee = hasChannelFeeConfiguration(currentRecord)
  const smartEntryPartner = !isEdit
    ? findExactPartner(settings?.partners || [], currentRecord.partnerName || currentRecord.channelName)
    : null
  const smartEntryRecord = smartEntryPartner
    ? currentRecord
    : {
        ...currentRecord,
        partnerName: '',
        channelName: '',
        items: []
      }

  return (
    <PageContainer
      hideHeader
      className={`core-bill-form-page core-bill-form-page--channel ${isEdit ? 'is-edit' : 'is-create'} ${compactMode ? 'is-compact-view' : 'is-full-view'} ${hasAdvancedData ? 'has-advanced-data' : ''} ${hasChannelFee ? 'has-channel-fee' : ''}`}
    >
      <section className="core-bill-form-head">
        <div className="core-bill-form-head__context">
          <div className="core-bill-form-title-row">
            <span className="core-bill-form-kind">渠道账单</span>
            <h1>{isEdit ? '编辑渠道账单' : '新增渠道账单'}</h1>
            <span className={`core-bill-state-tag ${isEdit ? 'is-pending' : ''}`}>
              {isEdit ? '待核对' : '新建账单'}
            </span>
            <button
              type="button"
              className="core-bill-density-toggle"
              title={compactMode ? '展开合同参数、扣减项和完整计算字段' : '只保留本次录账常用字段'}
              onClick={() => setCompactMode((value) => !value)}
            >
              {compactMode ? '显示完整字段' : '返回简洁模式'}
            </button>
            {compactMode && hasAdvancedData ? (
              <span className="core-bill-density-note">本单有特殊项，已保留高级列</span>
            ) : null}
          </div>
          <span className="core-bill-form-tip">
            {isEdit
              ? zeroSettlementPreview
                ? '当前为零结算账单，可直接“确认核对并结清”，系统会跳过开票与收款环节。'
                : '修改完成后可直接“保存并确认核对”；累计结算合作方会在核对后自动进入累计池。'
              : '合同优先模式：游戏先识别，分成/税率/通道费按当前游戏 + 渠道 + 账期匹配合同；历史账单只作参考，不会自动覆盖合同。'}
          </span>
          {isEdit ? <span className="core-bill-review-hint">账单核对与实际结算已分离：未达累计门槛也可以正常完成核对</span> : null}
          <div className={`core-bill-draft-state ${safety.dirty ? 'is-dirty' : 'is-clean'}`}>
            <span aria-hidden="true" />
            <strong>{safety.statusText}</strong>
            <small>{safety.dirty ? '本机草稿尚未提交服务器' : '已启用离开保护与自动恢复'}</small>
          </div>
        </div>
        <div className="core-bill-form-total" aria-live="polite">
          <span>{zeroSettlementPreview ? '零结算' : '预估结算'}</span>
          <strong>{money(previewAmount)}</strong>
        </div>
      </section>

      {inlineIssue ? (
        <section className={`core-bill-inline-issue ${inlineIssue.saved ? 'is-saved' : 'is-error'}`} role="alert">
          <div className="core-bill-inline-issue__body">
            <span>{inlineIssue.saved ? '修改已保存' : '需要处理'}</span>
            <strong>{inlineIssue.title}</strong>
            <p>{inlineIssue.message}</p>
            <small>
              {inlineIssue.kind === 'stale-status'
                ? '请先重新读取服务器状态；不会自动再次提交或覆盖账单。'
                : inlineIssue.saved
                ? inlineIssue.kind === 'contract'
                  ? '账单金额已保存，无需改成合同默认费率。若本期结算确认函属实，可直接确认特殊结算并锁单。'
                  : inlineIssue.kind === 'platform'
                    ? '不需要修改真实流水、分成或增加结算调整。在下方填写核对依据并确认即可。'
                    : '刚才的账单修改已经写入服务器，不需要重新录入。处理下面的核对问题后，再重新确认即可。'
                : '点击“定位问题”会直接跳到对应明细行、合同规则区或调整区，不需要自己逐项查找。'}
            </small>
          </div>
          <div className="core-bill-inline-issue__actions">
            {inlineIssue.kind === 'stale-status' ? (
              <button type="button" onClick={() => {
                if (safety.dirty) {
                  safety.flushDraft()
                  if (!window.confirm(
                    '服务器账单状态已经变化，当前页面还有未提交的修改。\\n' +
                    '重新读取不会将本机旧草稿覆盖到服务器，也不会自动恢复到新的账单上。\\n' +
                    '旧草稿会暂时保留。确定重新读取最新状态吗？'
                  )) return
                }
                retryLoad()
              }}>重新读取账单状态</button>
            ) : (
              <button type="button" onClick={() => locateIssue()}>定位问题</button>
            )}
            {inlineIssue.kind === 'contract' && isEdit && inlineIssue.saved ? (
              <button type="button" className="is-primary" disabled={reviewing} onClick={() => void confirmSavedSpecialSettlement()}>
                {reviewing ? '正在核对本期结算…' : '按结算确认函保留金额并完成核对'}
              </button>
            ) : null}
            {inlineIssue.kind === 'contract' && isEdit ? (
              <button type="button" onClick={openContractDifferenceWorkbench} disabled={reviewing}>查看合同差异详情</button>
            ) : null}
            {isEdit && inlineIssue.saved && inlineIssue.kind !== 'stale-status' ? (
              <button type="button" disabled={reviewing} onClick={() => void confirmReview()}>重新检测合同</button>
            ) : null}
            <button type="button" className="is-quiet" onClick={() => setInlineIssue(null)}>关闭提示</button>
          </div>
        </section>
      ) : null}

      {!isEdit ? (
        <details className="core-bill-smart-details">
          <summary>
            <span>智能补齐游戏明细（按合同 / 上月账单）</span>
            <small>非必需 · 需要时点击展开，普通账单直接填写下方明细</small>
          </summary>
          <ChannelSmartEntryBar
            record={smartEntryRecord}
            channelRecords={recon.channelRecords || []}
            onApply={applySmartRecord}
            onNotice={(message, tone = 'info') => showToast(message, tone)}
          />
        </details>
      ) : null}

      {!isEdit && ruleAuthority.status !== 'idle' ? (
        <div className={`channel-smart-entry__notice ${ruleAuthority.status === 'warning' || ruleAuthority.status === 'error' ? 'is-warning' : ''}`} role="status">
          <strong>规则依据：合同优先</strong>
          <span>{authorityText(ruleAuthority)}</span>
        </div>
      ) : null}

      {isEdit ? <label className="core-bill-card">修改原因（可选，随本次修改留档）<input disabled={reviewing} value={auditReason} maxLength={2000} onChange={event => setAuditReason(event.target.value)} placeholder="说明本次调整的依据；不填写则明确记为未填写" /></label> : null}
      <section className="core-bill-card core-bill-card--embedded">
        <fieldset disabled={reviewing} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <ChannelBillingForm
          key={`${mode}-${channelEditRecordId || 'new'}-${safety.resetVersion}-${smartRevision}`}
          formId={FORM_ID}
          mode={isEdit ? 'edit' : 'add'}
          recordId={stableRecord?.id}
          sourceRecord={stableRecord}
          draftRecord={smartRecord || safety.draftRecord || prefillRecord}
          createPrefillPartner={createPrefill}
          onAddRecord={recon.onChannelAddRecord}
          onUpdateRecord={handleChannelUpdateRecord}
          submitIntentRef={submitIntentRef}
          onAfterSubmit={handleAfterSubmit}
          onPreviewChange={setPreviewAmount}
          onFormStateChange={safety.onFormStateChange}
          onError={(msg) => reportIssue(msg, { kind: 'form', title: '账单暂时无法保存' })}
          partners={settings?.partners || []}
          onAddPartner={async (name) => {
            const newPartner = {
              name,
              category: '渠道',
              tag2: '',
              createdAt: new Date().toISOString()
            }
            const ok = await settings.persistPartner(newPartner)
            if (ok) showToast(`客户「${name}」已加入服务器客户库`, 'success')
          }}
        />
        </fieldset>
      </section>

      {isEdit ? (
        <div id="channel-contract-difference-workbench" className="core-bill-contract-difference-workbench">
          <ContractDifferenceActionPanel
            billType="channel"
            billId={String(stableRecord?.id || channelEditRecordId || '')}
            initialItems={differenceSeedItems}
            onEditBill={() => {
              const issue = {
                kind: 'form',
                title: '请直接修改当前账单',
                message: '合同差异已标记为“修改当前账单”。当前页面就是编辑页，已为你定位到账单内容。',
                saved: true
              }
              setInlineIssue(issue)
              window.setTimeout(() => focusProblemTarget(document.getElementById(FORM_ID)), 70)
            }}
            onChanged={async () => {
              setInlineIssue({
                kind: 'review',
                title: '合同差异状态已更新',
                message: '处理结果已保存。请核对当前账单内容，然后重新点击“保存并确认核对”进行复核。',
                saved: true
              })
              await recon.refetchChannelFromApi?.()
            }}
          />
        </div>
      ) : null}

      <ChannelCumulativeSettlementCard
        platformName={currentRecord.channelName || ''}
        partnerName={currentRecord.partnerName || currentRecord.channelName || ''}
        recordId={isEdit ? String(stableRecord?.id || channelEditRecordId || '') : ''}
        billStatus={currentRecord.status || stableRecord?.status || 'pending'}
        draftBasisAmount={Number(currentRecord.flow ?? currentRecord.billingFlow ?? 0)}
        draftSettlementAmount={Number(currentRecord.settlementAmount ?? previewAmount ?? 0)}
      />

      {!(showSmallVariancePanel && smallVarianceKind === 'platform' && platformVarianceReview?.reviewKind === 'documented') ? (
        <BillScanAttachments
          billType="channel"
          billId={isEdit ? String(stableRecord?.id || channelEditRecordId || '') : ''}
        />
      ) : null}

      {isEdit ? (
        <ChannelSmallVarianceApprovalPanel
          open={showSmallVariancePanel}
          note={smallVarianceNote}
          onNoteChange={value => { setSmallVarianceNote(value); setManualReviewConfirmed(false) }}
          manualReviewConfirmed={manualReviewConfirmed}
          onManualReviewConfirmedChange={setManualReviewConfirmed}
          onConfirm={() => void confirmSmallApprovedVariance()}
          onCancel={() => setShowSmallVariancePanel(false)}
          busy={reviewing}
          settlementAmount={stableRecord?.settlementAmount ?? previewAmount}
          kind={smallVarianceKind}
          platformReview={platformVarianceReview}
          officialConfirmedLineIds={officialConfirmedLineIds}
          onOfficialLineToggle={lineId => setOfficialConfirmedLineIds(previous => previous.includes(lineId)
            ? previous.filter(id => id !== lineId) : [...previous, lineId])}
          billId={String(stableRecord?.id || channelEditRecordId || '')}
          attachments={platformEvidenceAttachments}
          attachmentsLoading={platformEvidenceLoading}
          selectedAttachmentId={platformEvidenceId}
          onAttachmentChange={setPlatformEvidenceId}
          onAttachmentsChanged={() => {
            void refreshPlatformEvidence().catch((error) => {
              console.warn('平台凭证上传后刷新列表失败', error)
              showToast('凭证上传后无法刷新，请重试或刷新页面', 'error')
            })
          }}
        />
      ) : null}

      <ChannelReviewConfirmation request={reviewRequest} onCancel={() => setReviewRequest(null)}
        onConfirm={request => void confirmReview(request)} />
      {reviewing && reviewPhase ? <div className="core-bill-review-progress" role="status" aria-live="polite">
        {reviewPhase} 请勿重复提交。
      </div> : null}
      <section className="core-bill-footer" aria-busy={reviewing}>
        <div className="core-bill-footer-summary">
          <span>{zeroSettlementPreview ? '零结算' : '当前结算'}</span>
          <strong>{money(previewAmount)}</strong>
        </div>
        <div className="core-bill-footer-actions">
          {safety.dirty ? (
            <button type="button" className="core-bill-draft-clear" disabled={reviewing} onClick={discardDraft}>
              清除草稿
            </button>
          ) : null}
          <button type="button" onClick={goList} disabled={reviewing}>返回列表</button>
          {!isEdit ? (
            <button
              type="button"
              onClick={() => {
                submitIntentRef.current = 'continue'
                document.getElementById(FORM_ID)?.requestSubmit()
              }}
            >
              保存并继续
            </button>
          ) : null}
          <button
            type="button"
            className={isEdit ? '' : 'primary'}
            disabled={reviewing}
            onClick={() => {
              submitIntentRef.current = 'back'
              document.getElementById(FORM_ID)?.requestSubmit()
            }}
          >
            {isEdit ? '保存修改' : '保存账单'}
          </button>
          {isEdit ? (
            <>
              <button type="button" className="confirm-review" disabled={reviewing} onClick={() => void confirmReview()}>
                {reviewing ? reviewPhase || '正在核对…' : zeroSettlementPreview ? '确认核对并结清' : safety.dirty ? '保存并确认核对' : '确认核对'}
              </button>
            </>
          ) : null}
        </div>
      </section>
    </PageContainer>
  )
}

function EmptyState({ title, onBack }) {
  return (
    <PageContainer hideHeader className="core-bill-form-page core-bill-form-page--channel">
      <section className="core-bill-card core-bill-empty">
        <h1>{title}</h1>
        <button type="button" onClick={onBack}>返回列表</button>
      </section>
    </PageContainer>
  )
}

export default CoreChannelBillFormPage
