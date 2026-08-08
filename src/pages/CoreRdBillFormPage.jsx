import React, { useEffect, useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import BillScanAttachments from '@/components/billing/BillScanAttachments.jsx'
import ReconciliationLineItemsForm from '@/components/reconciliation/ReconciliationLineItemsForm.jsx'
import { CoreBillLoadingState } from '@/pages/CoreBillLoadingState.jsx'
import { VIEWS } from '@/app/routes.js'
import {
  apiRowToFrontend,
  getReconciliationRecord,
  getReconciliationRecordId
} from '@/lib/api/reconciliation.ts'
import { transitionBillLifecycle } from '@/lib/api/billLifecycle.ts'
import {
  getCachedEditRecord,
  invalidateEditRecord,
  loadEditRecord
} from '@/lib/api/editRecordCache.js'
import {
  isMeaningfulRdDraft,
  normalizeRdDraft
} from '@/domain/drafts/billDrafts.js'
import { useBillFormSafety } from '@/hooks/useBillFormSafety.js'
import './CoreBillFormPages.css'
import '@/components/reconciliation/reconciliation-admin.css'
import '@/styles/SimplifiedBillReview.css'

const FORM_ID = 'core-rd-bill-form'

function money(value) {
  const n = Number(value || 0)
  return `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function reviewValidation(record) {
  if (!String(record?.partnerId || '').trim()) return '请先从客户库选择合作方。'
  const items = Array.isArray(record?.items) ? record.items : []
  const validItems = items.filter((item) => String(item?.gameName || '').trim())
  if (!validItems.length) return '请至少填写一条游戏明细。'
  if (validItems.some((item) => Number(item?.revenue || 0) <= 0)) return '游戏后台流水必须大于 0。'
  if (Number(record?.settlementAmount || 0) <= 0) return '结算金额必须大于 0 才能确认核对。'
  return ''
}

function CoreRdBillFormPage({ mode }) {
  const {
    recon,
    settings,
    showToast,
    setActiveView,
    setNavigationBlocker,
    clearNavigationBlocker,
    reconEditRecordId,
    reconReturnView
  } = useAppState()
  const isEdit = mode === 'edit'
  const view = isEdit ? VIEWS.RECON_EDIT : VIEWS.RECON_CREATE
  const submitIntentRef = useRef('back')
  const [previewAmount, setPreviewAmount] = useState(0)
  const [remoteRecord, setRemoteRecord] = useState(null)
  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    if (!isEdit) return
    if (!reconEditRecordId) {
      setRemoteRecord(null)
      setLoading(false)
      setLoadError('')
      return
    }

    const recordId = String(reconEditRecordId)
    const cached = getCachedEditRecord('rd', recordId)
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
        const record = await loadEditRecord('rd', recordId, async () => {
          const row = await getReconciliationRecord(recordId)
          return apiRowToFrontend(row)
        })
        if (!cancelled) setRemoteRecord(record)
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error && error.message
              ? error.message
              : '读取账单明细失败，请稍后重试。'
          setLoadError(message)
          showToast('研发账单加载失败，可以在当前页面重试', 'error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRecord()
    return () => {
      cancelled = true
    }
  }, [isEdit, reconEditRecordId, loadAttempt, showToast])

  const editRecord = remoteRecord
  const stableEditRecord =
    editRecord && getReconciliationRecordId(editRecord) === ''
      ? { ...editRecord, id: String(reconEditRecordId) }
      : editRecord

  const safety = useBillFormSafety({
    type: 'rd',
    title: isEdit ? '编辑研发账单' : '新增研发账单',
    mode: isEdit ? 'edit' : 'add',
    view,
    recordId: isEdit ? String(reconEditRecordId || '') : '',
    initialRecord: stableEditRecord,
    normalize: normalizeRdDraft,
    isMeaningful: isMeaningfulRdDraft,
    setNavigationBlocker,
    clearNavigationBlocker
  })

  const listSnapshot = isEdit
    ? (recon.records || []).find((row) => String(row?.id || '') === String(reconEditRecordId || ''))
    : null
  const loadingSummary = listSnapshot
    ? [
        { label: '账单编号', value: listSnapshot.settlementNumber || '-' },
        {
          label: '合作方',
          value: listSnapshot.partnerShortName || listSnapshot.partner || listSnapshot.partyBName || '-'
        },
        { label: '账单月份', value: listSnapshot.settlementMonth || '-' },
        { label: '结算金额', value: money(listSnapshot.settlementAmount) }
      ]
    : []

  const goList = () => {
    recon.setQuickFillData(null)
    setActiveView(isEdit ? reconReturnView || VIEWS.RECON_RD : VIEWS.RECON_RD)
  }

  const retryLoad = () => {
    if (!reconEditRecordId) return
    invalidateEditRecord('rd', String(reconEditRecordId))
    setLoadAttempt((value) => value + 1)
  }

  const handleSubmitted = (intent) => {
    safety.clearAfterSubmit()
    if (isEdit && reconEditRecordId) {
      invalidateEditRecord('rd', String(reconEditRecordId))
    }
    if (intent === 'continue') {
      recon.setQuickFillData(null)
      showToast('已保存，可继续新增下一张研发账单', 'success')
      return
    }
    goList()
  }

  const confirmReview = async () => {
    if (!isEdit || !reconEditRecordId || reviewing) return
    const candidate = safety.currentRecord || safety.draftRecord || stableEditRecord
    const validationMessage = reviewValidation(candidate)
    if (validationMessage) {
      showToast(validationMessage, 'error')
      return
    }
    const confirmed = window.confirm(
      `确认核对这张研发账单吗？\n\n结算金额：${money(candidate?.settlementAmount || previewAmount)}\n\n确认后账单会自动锁定；如需再修改，可点击“退回修改”。`
    )
    if (!confirmed) return

    setReviewing(true)
    const billId = String(reconEditRecordId)
    try {
      const saved = await recon.updateRecord(billId, {
        ...stableEditRecord,
        ...candidate,
        id: billId,
        status: stableEditRecord?.status || 'pending'
      })
      if (saved === false) return
      safety.clearAfterSubmit()
      invalidateEditRecord('rd', billId)

      await transitionBillLifecycle('rd', billId, 'confirmed', '')
      await recon.refetchReconciliationFromApi?.()
      showToast('核对完成，账单已锁定', 'success')
      goList()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '账单已保存，但确认核对失败，请稍后重试。', 'error')
    } finally {
      setReviewing(false)
    }
  }

  const discardDraft = () => {
    const confirmed = window.confirm('确定清除当前本机草稿并恢复为空白/服务器版本吗？')
    if (confirmed) safety.discardDraft()
  }

  if (isEdit && !reconEditRecordId) {
    return <EmptyState title="请选择研发账单" onBack={goList} />
  }

  if (loading || loadError) {
    return (
      <CoreBillLoadingState
        billType="研发账单"
        summary={loadingSummary}
        error={loadError}
        onRetry={retryLoad}
        onBack={goList}
      />
    )
  }

  if (isEdit && !stableEditRecord) {
    return <EmptyState title="未找到研发账单" onBack={goList} />
  }

  return (
    <PageContainer
      hideHeader
      className={`core-bill-form-page core-bill-form-page--rd ${isEdit ? 'is-edit' : 'is-create'}`}
    >
      <section className="core-bill-form-head">
        <div className="core-bill-form-head__context">
          <div className="core-bill-form-title-row">
            <span className="core-bill-form-kind">研发账单</span>
            <h1>{isEdit ? '编辑研发账单' : '新增研发账单'}</h1>
            <span className={`core-bill-state-tag ${isEdit ? 'is-pending' : ''}`}>{isEdit ? '待核对' : '新建账单'}</span>
          </div>
          <span className="core-bill-form-tip">
            {isEdit ? '修改完成后可直接“保存并确认核对”，确认后系统自动锁定账单。' : '先确认合作方和账期，再录入游戏流水。保存后账单进入待核对。'}
          </span>
          {isEdit ? <span className="core-bill-review-hint">日常只需要“确认核对”与“退回修改”两个动作</span> : null}
          <div className={`core-bill-draft-state ${safety.dirty ? 'is-dirty' : 'is-clean'}`}>
            <span aria-hidden="true" />
            <strong>{safety.statusText}</strong>
            <small>{safety.dirty ? '本机草稿尚未提交服务器' : '已启用离开保护与自动恢复'}</small>
          </div>
        </div>
        <div className="core-bill-form-total" aria-live="polite">
          <span>预估结算</span>
          <strong>{money(previewAmount)}</strong>
        </div>
      </section>

      <section className="core-bill-card core-bill-card--embedded">
        <ReconciliationLineItemsForm
          key={`${mode}-${reconEditRecordId || 'new'}-${safety.resetVersion}`}
          formId={FORM_ID}
          layout="createPage"
          mode={isEdit ? 'edit' : 'add'}
          editRecord={stableEditRecord}
          draftRecord={isEdit || !recon.quickFillData ? safety.draftRecord : null}
          showSubmitButton={false}
          submitIntentRef={submitIntentRef}
          onPreviewChange={setPreviewAmount}
          onFormStateChange={safety.onFormStateChange}
          onSubmitted={handleSubmitted}
          onAddRecord={recon.addRecord}
          onUpdateRecord={recon.updateRecord}
          settlementMonth={settings.settlementMonth}
          settlementCycles={(recon.records || []).map((row) => row.settlementMonth)}
          onError={(msg) => showToast(msg, 'error')}
          quickFillData={isEdit ? null : recon.quickFillData}
          partners={settings.partners || []}
          onAddPartner={async (name) => {
            const newPartner = {
              name,
              category: '研发商',
              tag2: '',
              createdAt: new Date().toISOString()
            }
            const ok = await settings.persistPartner(newPartner)
            if (ok) showToast(`客户「${name}」已加入服务器客户库`, 'success')
          }}
        />
      </section>

      <BillScanAttachments
        billType="rd"
        billId={isEdit ? String(stableEditRecord?.id || reconEditRecordId || '') : ''}
      />

      <section className="core-bill-footer">
        <div className="core-bill-footer-summary">
          <span>当前结算</span>
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
            <button type="button" className="confirm-review" disabled={reviewing} onClick={() => void confirmReview()}>
              {reviewing ? '正在确认…' : '保存并确认核对'}
            </button>
          ) : null}
        </div>
      </section>
    </PageContainer>
  )
}

function EmptyState({ title, onBack }) {
  return (
    <PageContainer hideHeader className="core-bill-form-page core-bill-form-page--rd">
      <section className="core-bill-card core-bill-empty">
        <h1>{title}</h1>
        <button type="button" onClick={onBack}>返回列表</button>
      </section>
    </PageContainer>
  )
}

export default CoreRdBillFormPage
