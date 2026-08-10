import React, { useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import ElectronicInvoiceQuickEntry from '@/components/invoice/ElectronicInvoiceQuickEntry.jsx'
import InvoiceFormPageLayout from '@/components/invoice/InvoiceFormPageLayout.jsx'
import InvoiceForm from '@/components/invoice/InvoiceForm.jsx'
import { VIEWS } from '@/app/routes.js'
import '@/components/reconciliation/reconciliation-admin.css'
import '@/components/invoice/invoice-admin.css'

const FORM_ID = 'invoice-create-form'

function InvoiceCreatePage() {
  const { invoice, showToast, setActiveView } = useAppState()
  const { submitInvoiceFromForm, refetchInvoiceFromApi, invoiceForm } = invoice
  const submitIntentRef = useRef('back')
  const [previewAmount, setPreviewAmount] = useState(0)
  const [fullMode, setFullMode] = useState(false)

  const goList = () => setActiveView(VIEWS.INVOICE_MANAGE)
  const handleAfterSubmit = (intent) => { if (intent !== 'continue') goList() }

  return (
    <InvoiceFormPageLayout
      pageMode={fullMode ? '完整录入' : '电子专票极速录入'}
      toolsSlot={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{fullMode ? '用于红冲、纸票或特殊场景。' : '电子发票直接拖入 PDF / OFD / XML，核对后保存。'}</span>
          <button
            type="button"
            className="rec-btn rec-btn--ghost rec-btn--xs"
            onClick={() => setFullMode((value) => !value)}
          >
            {fullMode ? '返回极速录入' : '完整录入'}
          </button>
        </div>
      )}
      previewAmount={previewAmount}
      footerActions={fullMode ? (
        <>
          <button type="button" className="rec-btn rec-btn--ghost" onClick={goList}>返回列表</button>
          <button type="button" className="rec-btn rec-btn--secondary" onClick={() => {
            submitIntentRef.current = 'continue'
            document.getElementById(FORM_ID)?.requestSubmit()
          }}>保存并继续</button>
          <button type="button" className="rec-btn rec-btn--primary" onClick={() => {
            submitIntentRef.current = 'back'
            document.getElementById(FORM_ID)?.requestSubmit()
          }}>保存发票</button>
        </>
      ) : null}
    >
      {fullMode ? (
        <InvoiceForm
          formId={FORM_ID}
          mode="add"
          seedFromStore
          submitIntentRef={submitIntentRef}
          submitInvoiceFromForm={submitInvoiceFromForm}
          onAfterSubmit={handleAfterSubmit}
          onPreviewChange={setPreviewAmount}
          showToast={showToast}
        />
      ) : (
        <ElectronicInvoiceQuickEntry
          direction={invoiceForm?.invoiceDirection === 'input' ? 'input' : 'output'}
          showToast={showToast}
          onCancel={goList}
          onSaved={async () => {
            try { await refetchInvoiceFromApi?.() } catch { /* list refresh is best effort */ }
            goList()
          }}
        />
      )}
    </InvoiceFormPageLayout>
  )
}

export default InvoiceCreatePage
