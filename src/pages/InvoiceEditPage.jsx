import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import InvoiceFormPageLayout from '@/components/invoice/InvoiceFormPageLayout.jsx'
import InvoiceForm from '@/components/invoice/InvoiceForm.jsx'
import { apiInvoiceRowToFrontend, getInvoiceRecord } from '@/lib/api/invoice.ts'
import { VIEWS } from '@/app/routes.js'
import '@/components/reconciliation/reconciliation-admin.css'
import '@/components/invoice/invoice-admin.css'

const FORM_ID = 'invoice-edit-form'

function InvoiceEditPage() {
  const { invoice, showToast, setActiveView, invoiceEditId } = useAppState()
  const { invoiceRecords, submitInvoiceFromForm } = invoice

  const submitIntentRef = useRef('back')
  const [previewAmount, setPreviewAmount] = useState(0)
  const [remoteRecord, setRemoteRecord] = useState(null)
  const [remoteLoadState, setRemoteLoadState] = useState('idle')

  const recordFromList = useMemo(() => {
    if (invoiceEditId == null || invoiceEditId === '') return null
    return invoiceRecords.find((record) => String(record.id) === String(invoiceEditId)) ?? null
  }, [invoiceRecords, invoiceEditId])

  useEffect(() => {
    if (invoiceEditId == null || invoiceEditId === '') {
      setRemoteRecord(null)
      setRemoteLoadState('idle')
      return
    }
    if (recordFromList) {
      setRemoteRecord(null)
      setRemoteLoadState('idle')
      return
    }
    const id = String(invoiceEditId)
    let cancelled = false
    setRemoteLoadState('loading')
    setRemoteRecord(null)
    ;(async () => {
      try {
        const row = await getInvoiceRecord(id)
        if (cancelled) return
        setRemoteRecord(apiInvoiceRowToFrontend(row))
        setRemoteLoadState('idle')
      } catch (error) {
        console.error(error)
        if (!cancelled) {
          setRemoteRecord(null)
          setRemoteLoadState('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [invoiceEditId, recordFromList])

  const editRecord = recordFromList ?? remoteRecord
  const goList = () => setActiveView(VIEWS.INVOICE_MANAGE)
  const handleAfterSubmit = () => goList()

  if (invoiceEditId == null) {
    return (
      <InvoiceFormPageLayout
        pageMode="编辑发票"
        isEdit
        previewAmount={0}
        toolsSlot={<span>请从发票管理列表选择记录后进入编辑。</span>}
        footerActions={
          <button type="button" className="rec-btn rec-btn--primary" onClick={goList}>
            返回列表
          </button>
        }
      >
        <EmptyState
          title="尚未选择发票"
          description="返回发票管理列表，点击目标记录右侧的“编辑”。"
        />
      </InvoiceFormPageLayout>
    )
  }

  if (remoteLoadState === 'loading' && !editRecord) {
    return (
      <InvoiceFormPageLayout
        pageMode="编辑发票"
        isEdit
        previewAmount={0}
        toolsSlot={<span>正在从服务器读取发票记录。</span>}
        footerActions={
          <button type="button" className="rec-btn rec-btn--primary" onClick={goList}>
            返回列表
          </button>
        }
      >
        <EmptyState title="正在加载发票" description="请稍候，数据读取完成后会自动显示表单。" />
      </InvoiceFormPageLayout>
    )
  }

  if (!editRecord) {
    return (
      <InvoiceFormPageLayout
        pageMode="编辑发票"
        isEdit
        previewAmount={0}
        toolsSlot={<span>该记录可能已删除或当前网络不可用。</span>}
        footerActions={
          <button type="button" className="rec-btn rec-btn--primary" onClick={goList}>
            返回列表
          </button>
        }
      >
        <EmptyState
          title="未找到发票"
          description={
            remoteLoadState === 'error'
              ? '无法从服务器加载该记录，请检查网络后返回列表重试。'
              : `当前记录可能已删除（ID：${invoiceEditId}）。`
          }
        />
      </InvoiceFormPageLayout>
    )
  }

  return (
    <InvoiceFormPageLayout
      pageMode="编辑发票"
      isEdit
      toolsSlot={<span>修改保存后返回发票管理；核销仍在列表中处理。</span>}
      previewAmount={previewAmount}
      footerActions={
        <>
          <button type="button" className="rec-btn rec-btn--ghost" onClick={goList}>
            返回列表
          </button>
          <button
            type="button"
            className="rec-btn rec-btn--primary"
            onClick={() => {
              submitIntentRef.current = 'back'
              document.getElementById(FORM_ID)?.requestSubmit()
            }}
          >
            保存修改
          </button>
        </>
      }
    >
      <InvoiceForm
        formId={FORM_ID}
        mode="edit"
        sourceRecord={editRecord}
        submitIntentRef={submitIntentRef}
        submitInvoiceFromForm={submitInvoiceFromForm}
        onAfterSubmit={handleAfterSubmit}
        onPreviewChange={setPreviewAmount}
        showToast={showToast}
      />
    </InvoiceFormPageLayout>
  )
}

function EmptyState({ title, description }) {
  return (
    <div className="invoice-form-empty-state">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  )
}

export default InvoiceEditPage
