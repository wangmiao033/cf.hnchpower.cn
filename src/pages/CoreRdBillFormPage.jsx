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
import './CoreBillFormPages.css'
import '@/components/reconciliation/reconciliation-admin.css'

const FORM_ID = 'core-rd-bill-form'

function money(value) {
  const n = Number(value || 0)
  return `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function CoreRdBillFormPage({ mode }) {
  const {
    recon,
    settings,
    showToast,
    setActiveView,
    reconEditRecordId,
    reconReturnView
  } = useAppState()
  const isEdit = mode === 'edit'
  const submitIntentRef = useRef('back')
  const [previewAmount, setPreviewAmount] = useState(0)
  const [remoteRecord, setRemoteRecord] = useState(null)
  const [loading, setLoading] = useState(isEdit)

  useEffect(() => {
    if (!isEdit) return
    if (!reconEditRecordId) {
      setRemoteRecord(null)
      setLoading(false)
      return
    }
    let cancelled = false
    async function loadRecord() {
      setRemoteRecord(null)
      setLoading(true)
      try {
        const row = await getReconciliationRecord(String(reconEditRecordId))
        if (!cancelled) setRemoteRecord(apiRowToFrontend(row))
      } catch {
        if (!cancelled) showToast('无法加载研发账单，请返回列表重试', 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadRecord()
    return () => {
      cancelled = true
    }
  }, [isEdit, reconEditRecordId, showToast])

  const editRecord = remoteRecord
  const stableEditRecord =
    editRecord && getReconciliationRecordId(editRecord) === ''
      ? { ...editRecord, id: String(reconEditRecordId) }
      : editRecord

  const goList = () => {
    recon.setQuickFillData(null)
    setActiveView(isEdit ? reconReturnView || VIEWS.RECON_RD : VIEWS.RECON_RD)
  }

  const handleSubmitted = (intent) => {
    if (intent === 'continue') {
      recon.setQuickFillData(null)
      showToast('已保存，可继续新增下一张研发账单', 'success')
      return
    }
    goList()
  }

  if (isEdit && !reconEditRecordId) {
    return <EmptyState title="请选择研发账单" onBack={goList} />
  }

  if (loading) {
    return <CoreBillLoadingState billType="研发账单" />
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
            <span className="core-bill-state-tag">{isEdit ? '编辑模式' : '新建账单'}</span>
          </div>
          <span className="core-bill-form-tip">
            {isEdit ? '修改基础信息或游戏明细后保存。' : '先确认合作方和账期，再录入游戏流水。'}
          </span>
        </div>
        <div className="core-bill-form-total" aria-live="polite">
          <span>预估结算</span>
          <strong>{money(previewAmount)}</strong>
        </div>
      </section>

      <section className="core-bill-card core-bill-card--embedded">
        <ReconciliationLineItemsForm
          formId={FORM_ID}
          layout="createPage"
          mode={isEdit ? 'edit' : 'add'}
          editRecord={stableEditRecord}
          showSubmitButton={false}
          submitIntentRef={submitIntentRef}
          onPreviewChange={setPreviewAmount}
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
            if (ok) {
              showToast(`客户「${name}」已加入服务器客户库`, 'success')
            }
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
            {isEdit ? '保存修改' : '保存账单'}
          </button>
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
