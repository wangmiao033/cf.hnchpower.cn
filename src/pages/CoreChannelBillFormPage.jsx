import React, { useEffect, useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import BillScanAttachments from '@/components/billing/BillScanAttachments.jsx'
import ChannelBillingForm from '@/components/channel/ChannelBillingForm.jsx'
import { CoreBillLoadingState } from '@/pages/CoreBillLoadingState.jsx'
import { VIEWS } from '@/app/routes.js'
import { apiChannelRowToFrontend, getChannelRecord } from '@/lib/api/channel.ts'
import {
  getCachedEditRecord,
  invalidateEditRecord,
  loadEditRecord
} from '@/lib/api/editRecordCache.js'
import './CoreBillFormPages.css'
import '@/components/reconciliation/reconciliation-admin.css'

const FORM_ID = 'core-channel-bill-form'
const RECONCILED_STATUSES = new Set(['confirmed', 'completed', 'settled', 'reconciled', 'verified'])

function money(value) {
  const n = Number(value || 0)
  return `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function CoreChannelBillFormPage({ mode }) {
  const {
    recon,
    settings,
    showToast,
    setActiveView,
    channelEditRecordId,
    channelReturnView
  } = useAppState()
  const isEdit = mode === 'edit'
  const submitIntentRef = useRef('back')
  const [previewAmount, setPreviewAmount] = useState(0)
  const [remoteRecord, setRemoteRecord] = useState(null)
  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)

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
  const isReconciled = RECONCILED_STATUSES.has(String(stableRecord?.status || '').toLowerCase())
  const stateLabel = !isEdit ? '新建账单' : isReconciled ? '已核对' : '待核对'

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
    if (isEdit && channelEditRecordId) {
      invalidateEditRecord('channel', String(channelEditRecordId))
    }
    if (intent === 'continue') {
      showToast('已保存，可继续新增下一张渠道账单', 'success')
      return
    }
    if (intent === 'confirm') {
      showToast('渠道账单已完成核对', 'success')
    }
    goList()
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
            <span
              className={`core-bill-state-tag ${isEdit ? (isReconciled ? 'is-complete' : 'is-pending') : ''}`}
            >
              {stateLabel}
            </span>
          </div>
          <span className="core-bill-form-tip">
            {isEdit
              ? isReconciled
                ? '该账单已核对，修改后保存即可同步。'
                : '确认明细和附件后，可直接完成核对。'
              : '先选择合作方和账期，再录入游戏明细。'}
          </span>
        </div>
        <div className="core-bill-form-total" aria-live="polite">
          <span>预估结算</span>
          <strong>{money(previewAmount)}</strong>
        </div>
      </section>

      <section className="core-bill-card core-bill-card--embedded">
        <ChannelBillingForm
          formId={FORM_ID}
          mode={isEdit ? 'edit' : 'add'}
          recordId={stableRecord?.id}
          sourceRecord={stableRecord}
          onAddRecord={recon.onChannelAddRecord}
          onUpdateRecord={recon.onChannelUpdateRecord}
          submitIntentRef={submitIntentRef}
          onAfterSubmit={handleAfterSubmit}
          onPreviewChange={setPreviewAmount}
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
            if (ok) {
              showToast(`客户「${name}」已加入服务器客户库`, 'success')
            }
          }}
        />
      </section>

      <BillScanAttachments
        billType="channel"
        billId={isEdit ? String(stableRecord?.id || channelEditRecordId || '') : ''}
      />

      <section className="core-bill-footer">
        <div className="core-bill-footer-summary">
          <span>当前结算</span>
          <strong>{money(previewAmount)}</strong>
        </div>
        <div className="core-bill-footer-actions">
          <button type="button" onClick={goList}>返回列表</button>
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
          {isEdit && !isReconciled ? (
            <>
              <button
                type="button"
                onClick={() => {
                  submitIntentRef.current = 'back'
                  document.getElementById(FORM_ID)?.requestSubmit()
                }}
              >
                仅保存
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  submitIntentRef.current = 'confirm'
                  document.getElementById(FORM_ID)?.requestSubmit()
                }}
              >
                完成核对
              </button>
            </>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={() => {
                submitIntentRef.current = 'back'
                document.getElementById(FORM_ID)?.requestSubmit()
              }}
            >
              {isEdit ? '保存修改' : '保存账单'}
            </button>
          )}
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
