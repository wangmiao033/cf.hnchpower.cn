import React from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { useAppState } from '@/app/AppStateContext.jsx'
import InvoicePriorityWorkspace from '@/components/invoice/InvoicePriorityWorkspace.jsx'
import PaymentRegisterWorkspace from '@/components/payment/PaymentRegisterWorkspace.jsx'
import { VIEWS } from '@/app/routes.js'
import '@/components/invoice/invoice-admin.css'
import '@/components/invoice/invoice-workspace-toolbar.css'
import '@/components/invoice/invoice-compact-ui.css'
import './InvoiceInitialLoad.css'

function InvoiceLoadingState({ direction }) {
  return (
    <section className="invoice-initial-loading" role="status" aria-live="polite">
      <div className="invoice-initial-loading__heading">
        <span className="invoice-initial-loading__spinner" aria-hidden="true" />
        <div>
          <strong>正在加载{direction === 'input' ? '进项' : '销项'}发票…</strong>
          <span>正在连接发票台账，完成前不会显示临时的0张数据。</span>
        </div>
      </div>
      <div className="invoice-initial-loading__cards" aria-hidden="true">
        {[0, 1, 2, 3].map((key) => <div key={key} />)}
      </div>
      <div className="invoice-initial-loading__table" aria-hidden="true">
        <div /><div /><div />
      </div>
    </section>
  )
}

function InvoicePage({ section }) {
  const { invoice } = useAppState()
  if (section === VIEWS.INVOICE_PAYMENT) {
    return (
      <PageContainer hideHeader className="page-container--recon-rd">
        <PaymentRegisterWorkspace />
      </PageContainer>
    )
  }

  const direction = section === VIEWS.INVOICE_INPUT ? 'input' : 'output'
  const loadStatus = invoice?.invoiceLoadStatus || 'idle'

  return (
    <PageContainer hideHeader className="page-container--recon-rd">
      {loadStatus === 'idle' || loadStatus === 'loading' ? (
        <InvoiceLoadingState direction={direction} />
      ) : (
        <>
          {loadStatus === 'offline' ? (
            <section className="invoice-connection-notice" role="alert">
              <div>
                <strong>发票服务器暂时无法连接</strong>
                <span>可能正在显示浏览器缓存数据，不能据此判断服务器没有发票。建议恢复连接后再办理发票操作。</span>
              </div>
              <button type="button" onClick={() => void invoice?.retryInvoiceLoad?.()}>重新连接</button>
            </section>
          ) : null}
          <InvoicePriorityWorkspace
            variant={section === VIEWS.INVOICE_VERIFY ? 'verify' : 'manage'}
            direction={direction}
          />
        </>
      )}
    </PageContainer>
  )
}

export default InvoicePage
