import React, { useEffect, useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import BillScanAttachments from '@/components/billing/BillScanAttachments.jsx'
import ChannelBillingForm from '@/components/channel/ChannelBillingForm.jsx'
import { CoreBillLoadingState } from '@/pages/CoreBillLoadingState.jsx'
import { VIEWS } from '@/app/routes.js'
import { apiChannelRowToFrontend, getChannelRecord } from '@/lib/api/channel.ts'
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

  useEffect(() => {
    if (!isEdit) return
    if (!channelEditRecordId) {
      setRemoteRecord(null)
      setLoading(false)
      return
    }
    let cancelled = false
    async function loadRecord() {
      setRemoteRecord(null)
      setLoading(true)
      try {
        const row = await getChannelRecord(String(channelEditRecordId))
        if (!cancelled) setRemoteRecord(apiChannelRowToFrontend(row))
      } catch {
        if (!cancelled) showToast('无法加载渠道账单，请返回列表重试', 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRecord()
    return () => {
      cancelled = true
    }
  }, [isEdit, channelEditRecordId, showToast])

  const editRecord = remoteRecord
  const stableRecord =
    editRecord && (!editRecord.id || editRecord.id === '')
      ? { ...editRecord, id: String(channelEditRecordId) }
      : editRecord
  const isReconciled = RECONCILED_STATUSES.has(String(stableRecord?.status || '').toLowerCase())

  const goList = () => setActiveView(channelReturnView || VIEWS.RECON_CHANNEL)

  const handleAfterSubmit = (intent) => {
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

  if (loading) {
    return <CoreBillLoadingState billType="渠道账单" />
  }

  if (isEdit && !stableRecord) {
    return <EmptyState title="未找到渠道账单" onBack={goList} />
  }

  return (
    <PageContainer hideHeader className="core-bill-form-page">
      <section className="core-bill-form-head">
        <div>
          <p>渠道账单</p>
          <h1>{isEdit ? '编辑渠道账单' : '新增渠道账单'}</h1>
          <span>
            {isEdit
              ? isReconciled
                ? '该账单已核对，可继续修改并保存。'
                : '核对账单明细和附件后，点击“完成核对”。'
              : '录入渠道账单明细并保存。'}
          </span>
        </div>
        <div className="core-bill-form-total">
          <span>预估结算金额</span>
          <strong>{money(previewAmount)}</strong>
        </div>
      </section>

      <section className="core-bill-card core-bill-card--embedded">
      <ChannelBillingForm
        partners={settings?.partners || []}
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
        />
      </section>

      <BillScanAttachments
        billType="channel"
        billId={isEdit ? String(stableRecord?.id || channelEditRecordId || '') : ''}
      />

      <section className="core-bill-footer">
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
            {isEdit ? '保存修改' : '保存'}
          </button>
        )}
      </section>
    </PageContainer>
  )
}

function EmptyState({ title, onBack }) {
  return (
    <PageContainer hideHeader className="core-bill-form-page">
      <section className="core-bill-card core-bill-empty">
        <h1>{title}</h1>
        <button type="button" onClick={onBack}>返回列表</button>
      </section>
    </PageContainer>
  )
}

export default CoreChannelBillFormPage
