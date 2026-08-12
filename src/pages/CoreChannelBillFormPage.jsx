import React, { useEffect, useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import BillScanAttachments from '@/components/billing/BillScanAttachments.jsx'
import ChannelBillingForm from '@/components/channel/ChannelBillingForm.jsx'
import ChannelCumulativeSettlementCard from '@/components/channel/ChannelCumulativeSettlementCard.jsx'
import ChannelSmartEntryBar from '@/components/channel/ChannelSmartEntryBar.jsx'
import ChannelFlowInputPanel from '@/components/channel/ChannelFlowInputPanel.jsx'
import { CHANNEL_MONTH_CLOSE_SEED_KEY } from '@/components/channel/ChannelMonthCloseLauncher.jsx'
import { CoreBillLoadingState } from '@/pages/CoreBillLoadingState.jsx'
import { VIEWS } from '@/app/routes.js'
import { initialLineItem } from '@/domain/channel/channelBillingForm.js'
import { channelFlowCompletion, normalizeChannelTextKey } from '@/domain/channel/channelFlowInput.js'
import { apiChannelRowToFrontend, getChannelRecord } from '@/lib/api/channel.ts'
import { transitionBillLifecycle } from '@/lib/api/billLifecycle.ts'
import {
  getCachedEditRecord,
  invalidateEditRecord,
  loadEditRecord
} from '@/lib/api/editRecordCache.js'
import {
  isMeaningfulChannelDraft,
  normalizeChannelDraft
} from '@/domain/drafts/billDrafts.js'
import { useBillFormSafety } from '@/hooks/useBillFormSafety.js'
import './CoreBillFormPages.css'
import '@/components/reconciliation/reconciliation-admin.css'
import '@/styles/SimplifiedBillReview.css'

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

function readMonthCloseSeed() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(CHANNEL_MONTH_CLOSE_SEED_KEY)
    if (!raw) return null
    window.sessionStorage.removeItem(CHANNEL_MONTH_CLOSE_SEED_KEY)
    const parsed = JSON.parse(raw)
    return parsed && parsed.source === 'month-close' ? parsed : null
  } catch {
    return null
  }
}

function applyMonthCloseSeed(baseRecord, seed) {
  const month = String(seed?.month || '').trim()
  const games = [...new Set((seed?.games || []).map((value) => String(value || '').trim()).filter(Boolean))]
  const currentItems = Array.isArray(baseRecord?.items) ? baseRecord.items : []
  const keys = new Set(currentItems.map((item) => normalizeChannelTextKey(item?.gameName)).filter(Boolean))
  const added = games
    .filter((gameName) => !keys.has(normalizeChannelTextKey(gameName)))
    .map((gameName) => ({
      ...initialLineItem(),
      gameName,
      settlementCycle: month,
      flowInputState: 'missing'
    }))
  return {
    ...(baseRecord || {}),
    partnerName: String(seed?.partnerName || baseRecord?.partnerName || '').trim(),
    channelName: String(seed?.channelName || baseRecord?.channelName || seed?.partnerName || '').trim(),
    settlementMonth: month || baseRecord?.settlementMonth || '',
    items: [...currentItems, ...added]
  }
}

function reviewValidation(record) {
  if (!String(record?.partnerName || record?.channelName || '').trim()) return '请先选择合作方。'
  if (!String(record?.settlementMonth || '').trim()) return '请先选择账单月份。'
  const items = Array.isArray(record?.items) ? record.items : []
  const validItems = items.filter((item) => String(item?.gameName || '').trim())
  if (!validItems.length) return '请至少填写一条游戏明细。'
  const flowCompletion = channelFlowCompletion({ items: validItems })
  if (flowCompletion.missingCount) {
    const names = flowCompletion.missingGames.slice(0, 5).join('、')
    const suffix = flowCompletion.missingCount > 5 ? ` 等 ${flowCompletion.missingCount} 个游戏` : ''
    return `后台流水尚未录完：${names}${suffix}。请填写金额，或明确点击“确认本期为 0”。`
  }
  if (normalizedAmount(record?.settlementAmount) < 0) {
    return '结算金额为负，请先检查退款、冲抵或费用配置；负数账单不能按普通应收流程确认。'
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
    channelEditRecordId,
    channelReturnView
  } = useAppState()
  const isEdit = mode === 'edit'
  const view = isEdit ? VIEWS.CHANNEL_RECON_EDIT : VIEWS.CHANNEL_RECON_CREATE
  const submitIntentRef = useRef('back')
  const [previewAmount, setPreviewAmount] = useState(0)
  const [remoteRecord, setRemoteRecord] = useState(null)
  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [reviewing, setReviewing] = useState(false)
  const [smartRecord, setSmartRecord] = useState(null)
  const [smartRevision, setSmartRevision] = useState(0)
  const [monthCloseSeed, setMonthCloseSeed] = useState(null)

  useEffect(() => {
    setSmartRecord(null)
    setSmartRevision(0)
    setMonthCloseSeed(readMonthCloseSeed())
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
    const cached = getCachedEditRecord('channel', recordId)
    if (cached) {
      setRemoteRecord(cached)
      setLoading(false)
      setLoadError('')
      return
    }

    let cancelled = false
    async function loadRecord() {
      setRemoteRecord(null)
      setLoading(true)
      setLoadError('')
      try {
        const record = await loadEditRecord('channel', recordId, async () => {
          const row = await getChannelRecord(recordId)
          return apiChannelRowToFrontend(row)
        })
        if (!cancelled) setRemoteRecord(record)
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
    normalize: normalizeChannelDraft,
    isMeaningful: isMeaningfulChannelDraft,
    setNavigationBlocker,
    clearNavigationBlocker
  })

  useEffect(() => {
    if (!monthCloseSeed) return
    if (isEdit) {
      if (!stableRecord) return
      if (monthCloseSeed.billId && String(monthCloseSeed.billId) !== String(channelEditRecordId || '')) {
        setMonthCloseSeed(null)
        return
      }
    }
    const base = isEdit ? stableRecord : {}
    const nextRecord = applyMonthCloseSeed(base, monthCloseSeed)
    setSmartRecord(nextRecord)
    setSmartRevision((value) => value + 1)
    setMonthCloseSeed(null)
    const addedCount = Math.max(0, (nextRecord.items?.length || 0) - (base?.items?.length || 0))
    showToast(
      addedCount
        ? `月结任务已带入 ${addedCount} 个缺失游戏；流水仍保持未录状态。`
        : '已打开本月账单，继续补流水或核对即可。',
      'info'
    )
  }, [monthCloseSeed, isEdit, stableRecord, channelEditRecordId, showToast])

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

  const handleAfterSubmit = (intent) => {
    safety.clearAfterSubmit()
    setSmartRecord(null)
    setSmartRevision((value) => value + 1)
    if (isEdit && channelEditRecordId) {
      invalidateEditRecord('channel', String(channelEditRecordId))
    }
    if (intent === 'continue') {
      showToast('已保存，可继续新增下一张渠道账单', 'success')
      return
    }
    goList()
  }

  const applySmartRecord = (nextRecord, message = '', tone = 'success') => {
    setSmartRecord(nextRecord)
    setSmartRevision((value) => value + 1)
    if (message) showToast(message, tone)
  }

  const confirmReview = async () => {
    if (!isEdit || !channelEditRecordId || reviewing) return
    const candidate = safety.currentRecord || smartRecord || safety.draftRecord || stableRecord
    const validationMessage = reviewValidation(candidate)
    if (validationMessage) {
      showToast(validationMessage, 'error')
      return
    }

    const settlementAmount = normalizedAmount(candidate?.settlementAmount ?? previewAmount)
    const zeroSettlement = isZeroSettlement(settlementAmount)
    const confirmed = window.confirm(
      zeroSettlement
        ? `确认核对并结清这张零结算账单吗？\n\n所有游戏流水均已明确录入/确认 0。\n结算金额：${money(settlementAmount)}\n\n本期无需开票和收款，确认后账单将直接完成并锁定。`
        : `确认核对这张渠道账单吗？\n\n结算金额：${money(settlementAmount)}\n\n确认后账单会自动锁定；如合作方启用了累计结算，本期会进入累计池而不是立即催收/开票。`
    )
    if (!confirmed) return

    setReviewing(true)
    const billId = String(channelEditRecordId)
    try {
      const saved = await recon.onChannelUpdateRecord(billId, {
        ...stableRecord,
        ...candidate,
        id: billId,
        status: stableRecord?.status || 'pending'
      })
      if (saved === false) return
      safety.clearAfterSubmit()
      setSmartRecord(null)
      invalidateEditRecord('channel', billId)

      const lifecycle = await transitionBillLifecycle('channel', billId, 'confirmed', '')
      if (zeroSettlement) {
        await transitionBillLifecycle('channel', billId, 'completed', '')
      }
      await recon.refetchChannelFromApi?.()
      const deferred = Boolean(lifecycle?.settlement_condition?.deferred)
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
      showToast(error instanceof Error ? error.message : '账单已保存，但确认核对失败，请稍后重试。', 'error')
    } finally {
      setReviewing(false)
    }
  }

  const discardDraft = () => {
    const confirmed = window.confirm('确定清除当前本机草稿并恢复为空白/服务器版本吗？')
    if (confirmed) {
      setSmartRecord(null)
      setSmartRevision((value) => value + 1)
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

  const currentRecord = safety.currentRecord || smartRecord || safety.draftRecord || stableRecord || {}
  const flowCompletion = channelFlowCompletion(currentRecord)
  const zeroSettlementPreview = flowCompletion.complete && isZeroSettlement(previewAmount)

  return (
    <PageContainer
      hideHeader
      className={`core-bill-form-page core-bill-form-page--channel ${isEdit ? 'is-edit' : 'is-create'}`}
    >
      <section className="core-bill-form-head">
        <div className="core-bill-form-head__context">
          <div className="core-bill-form-title-row">
            <span className="core-bill-form-kind">渠道账单</span>
            <h1>{isEdit ? '编辑渠道账单' : '新增渠道账单'}</h1>
            <span className={`core-bill-state-tag ${isEdit ? 'is-pending' : ''}`}>
              {isEdit ? '待核对' : '新建账单'}
            </span>
          </div>
          <span className="core-bill-form-tip">
            {flowCompletion.missingCount
              ? `还有 ${flowCompletion.missingCount} 个游戏的后台流水未明确；保存草稿可以，确认核对前必须填写金额或确认 0。`
              : isEdit
                ? zeroSettlementPreview
                  ? '所有游戏流水已明确，本期为零结算账单；确认后会跳过开票与收款环节。'
                  : '流水已明确，修改完成后可直接保存并确认核对。'
                : 'V3.3 会按合同/月结任务准备游戏清单；充值流水始终由你手工填写。'}
          </span>
          {isEdit ? <span className="core-bill-review-hint">账单核对与实际结算已分离：未达累计门槛也可以正常完成核对</span> : null}
          <div className={`core-bill-draft-state ${safety.dirty ? 'is-dirty' : 'is-clean'}`}>
            <span aria-hidden="true" />
            <strong>{safety.statusText}</strong>
            <small>{safety.dirty ? '本机草稿尚未提交服务器' : '已启用离开保护与自动恢复'}</small>
          </div>
        </div>
        <div className="core-bill-form-total" aria-live="polite">
          <span>{flowCompletion.missingCount ? '暂估结算' : zeroSettlementPreview ? '零结算' : '预估结算'}</span>
          <strong>{money(previewAmount)}</strong>
        </div>
      </section>

      {!isEdit ? (
        <ChannelSmartEntryBar
          record={currentRecord}
          channelRecords={recon.channelRecords || []}
          onApply={applySmartRecord}
          onNotice={(message, tone = 'info') => showToast(message, tone)}
        />
      ) : null}

      <ChannelFlowInputPanel
        record={currentRecord}
        onApply={applySmartRecord}
        onNotice={(message, tone = 'info') => showToast(message, tone)}
      />

      <section className="core-bill-card core-bill-card--embedded">
        <ChannelBillingForm
          key={`${mode}-${channelEditRecordId || 'new'}-${safety.resetVersion}-${smartRevision}`}
          formId={FORM_ID}
          mode={isEdit ? 'edit' : 'add'}
          recordId={stableRecord?.id}
          sourceRecord={stableRecord}
          draftRecord={smartRecord || safety.draftRecord}
          onAddRecord={recon.onChannelAddRecord}
          onUpdateRecord={recon.onChannelUpdateRecord}
          submitIntentRef={submitIntentRef}
          onAfterSubmit={handleAfterSubmit}
          onPreviewChange={setPreviewAmount}
          onFormStateChange={safety.onFormStateChange}
          onError={(msg) => showToast(msg, 'error')}
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
      </section>

      <ChannelCumulativeSettlementCard
        partnerName={currentRecord.partnerName || currentRecord.channelName || ''}
        recordId={isEdit ? String(stableRecord?.id || channelEditRecordId || '') : ''}
        billStatus={currentRecord.status || stableRecord?.status || 'pending'}
        draftBasisAmount={Number(currentRecord.flow ?? currentRecord.billingFlow ?? 0)}
        draftSettlementAmount={Number(currentRecord.settlementAmount ?? previewAmount ?? 0)}
      />

      <BillScanAttachments
        billType="channel"
        billId={isEdit ? String(stableRecord?.id || channelEditRecordId || '') : ''}
      />

      <section className="core-bill-footer">
        <div className="core-bill-footer-summary">
          <span>{flowCompletion.missingCount ? `待录流水 ${flowCompletion.missingCount}` : zeroSettlementPreview ? '零结算' : '当前结算'}</span>
          <strong>{money(previewAmount)}</strong>
        </div>
        <div className="core-bill-footer-actions">
          {safety.dirty ? (
            <button type="button" className="core-bill-draft-clear" onClick={discardDraft}>
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
            <button
              type="button"
              className="confirm-review"
              disabled={reviewing || flowCompletion.missingCount > 0}
              title={flowCompletion.missingCount ? '还有游戏流水未录入/未确认 0' : '保存并确认核对'}
              onClick={() => void confirmReview()}
            >
              {reviewing ? '正在确认…' : flowCompletion.missingCount ? `先补流水（${flowCompletion.missingCount}）` : zeroSettlementPreview ? '确认核对并结清' : '保存并确认核对'}
            </button>
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