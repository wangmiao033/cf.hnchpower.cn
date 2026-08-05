import React from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'

function InvoiceFormPageLayout({
  toolsSlot,
  previewAmount,
  previewLabel = '开票金额',
  pageMode = '新增发票',
  isEdit = false,
  footerActions,
  children
}) {
  return (
    <PageContainer hideHeader className="page-container--admin-workspace page-container--invoice-form">
      <div className="admin-workspace rec-form-page">
        <section className="invoice-form-workbench-head">
          <div className="invoice-form-workbench-head__meta">
            <span className={`invoice-form-workbench-head__badge ${isEdit ? 'is-edit' : ''}`}>
              {pageMode}
            </span>
            {toolsSlot ? (
              <div className="invoice-form-workbench-head__hint">{toolsSlot}</div>
            ) : null}
          </div>
          <div className="invoice-form-workbench-head__amount">
            <span>{previewLabel}</span>
            <strong>¥{Number(previewAmount || 0).toFixed(2)}</strong>
          </div>
        </section>

        <div className="rec-form-page__form-wrap">{children}</div>

        <div className="rec-create-footer">
          <div className="rec-create-footer__preview" aria-hidden="true" />
          <div className="rec-create-footer__actions">{footerActions}</div>
        </div>
      </div>
    </PageContainer>
  )
}

export default InvoiceFormPageLayout
