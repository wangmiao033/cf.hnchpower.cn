import React from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'
import InvoicePriorityWorkspace from '@/components/invoice/InvoicePriorityWorkspace.jsx'
import PaymentRegisterWorkspace from '@/components/payment/PaymentRegisterWorkspace.jsx'
import { VIEWS } from '@/app/routes.js'
import '@/components/invoice/invoice-admin.css'
import '@/components/invoice/invoice-workspace-toolbar.css'
import '@/components/invoice/invoice-compact-ui.css'

function InvoicePage({ section }) {
  if (section === VIEWS.INVOICE_PAYMENT) {
    return (
      <PageContainer hideHeader className="page-container--recon-rd">
        <PaymentRegisterWorkspace />
      </PageContainer>
    )
  }

  return (
    <PageContainer hideHeader className="page-container--recon-rd">
      <InvoicePriorityWorkspace
        variant={section === VIEWS.INVOICE_VERIFY ? 'verify' : 'manage'}
        direction={section === VIEWS.INVOICE_INPUT ? 'input' : 'output'}
      />
    </PageContainer>
  )
}

export default InvoicePage
