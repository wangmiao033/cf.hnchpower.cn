import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import ChannelBillingForm from '@/components/channel/ChannelBillingForm.jsx'
import { VIEWS } from '@/app/routes.js'
import { apiChannelRowToFrontend, getChannelRecord } from '@/lib/api/channel.ts'
import './CoreBillFormPages.css'
import '@/components/reconciliation/reconciliation-admin.css'

const FORM_ID = 'core-channel-bill-form'

function money(value) {
  const n = Number(value || 0)
  return `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function CoreChannelBillFormPage({ mode }) {
  const { recon, showToast, setActiveView, channelEditRecordId } = useAppState()
  const isEdit = mode === 'edit'
  const submitIntentRef = useRef('back')
  const [previewAmount, setPreviewAmount] = useState(0)
  const [remoteRecord, setRemoteRecord] = useState(null)
  const [loading, setLoading] = useState(isEdit)

  const recordFromList = useMemo(() => {
    if (!isEdit || !channelEditRecordId) return null
    return (recon.channelRecords || []).find((row) => String(row.id) === String(channelEditRecordId)) || null
  }, [isEdit, recon.channelRecords, channelEditRecordId])

  useEffect(() => {
    if (!isEdit) return
    if (!channelEditRecordId) {
      setLoading(false)
      return
    }
    if (recordFromList) {
      setRemoteRecord(null)
      setLoading(false)
      return
    }
    let cancelled = false
    async function loadRecord() {
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
  }, [isEdit, channelEditRecordId, recordFromList, showToast])

  const editRecord = recordFromList || remoteRecord
  const stableRecord =
    editRecord && (!editRecord.id || editRecord.id === '')
      ? { ...editRecord, id: String(channelEditRecordId) }
      : editRecord

  const goList = () => setActiveView(VIEWS.RECON_CHANNEL)

  const handleAfterSubmit = (intent) => {
    if (intent === 'continue') {
      showToast('已保存，可继续新增下一张渠道账单', 'success')
      return
    }
    goList()
  }

  if (isEdit && !channelEditRecordId) {
    return <EmptyState title="请选择渠道账单" onBack={goList} />
  }

  if (loading) {
    return <EmptyState title="正在加载渠道账单..." onBack={goList} />
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
          <span>保留你确认的渠道明细录入表格，外层只做新版整理。</span>
        </div>
        <div className="core-bill-form-total">
          <span>预估结算金额</span>
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
        />
      </section>

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
        <button
          type="button"
          className="primary"
          onClick={() => {
            submitIntentRef.current = 'back'
            document.getElementById(FORM_ID)?.requestSubmit()
          }}
        >
          保存
        </button>
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
