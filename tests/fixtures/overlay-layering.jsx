import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '/src/App.jsx'
import AppShell from '/src/app/AppShell.jsx'
import { AppStateProvider } from '/src/app/AppStateContext.jsx'
import { AuthProvider, useAuth } from '/src/features/auth/AuthContext.jsx'
import { VIEWS } from '/src/app/routes.js'
import PageContainer from '/src/components/layout/PageContainer.jsx'
import ContractManagementPage from '/src/pages/ContractManagementPage.jsx'
import ConfirmDialog from '/src/components/ConfirmDialog.jsx'
import DaxiongOrderImportDialog from '/src/pages/DaxiongOrderImportDialog.jsx'
import InvoiceMatchPreview from '/src/components/invoice/InvoiceMatchPreview.jsx'
import InvoiceLightDrawer from '/src/components/invoice/InvoiceLightDrawer.jsx'
import ChannelAuditGroupManager from '/src/components/channel/ChannelAuditGroupManager.jsx'
import Customer360Drawer from '/src/components/partner/Customer360Drawer.jsx'
import GamePresets from '/src/components/GamePresets.jsx'
import '/src/styles/SimplifiedBillReview.css'
import '/src/pages/PartnerPage.css'
import mainSource from '/src/main.jsx?raw'
for (const [, path] of mainSource.matchAll(/import ['"](.+\.css)['"]/g)) {
  await import(/* @vite-ignore */ '/src/' + path.replace(/^\.\//, ''))
}
const noop = () => {}
const record = { id: 'invoice-test', title: '层级测试客户', invoiceDirection: 'output', status: '已开', amountWithTax: 100 }
function Fixture() {
  const { loading } = useAuth()
  const [open, setOpen] = useState(false)
  const [navigations, setNavigations] = useState(0)
  const mode = new URLSearchParams(location.search).get('mode') || 'contract'
  const close = () => setOpen(false)
  const navigate = () => setNavigations(value => value + 1)
  const value = { settings: { partners: [] }, showToast: noop, openBill360: noop, openInvoiceEdit: noop, setActiveView: navigate }
  return <AppStateProvider value={value}>
    <AppShell activeView={VIEWS.CONTRACTS} onNavigate={navigate} openTabs={[VIEWS.CONTRACTS, VIEWS.PARTNER_CONTACTS]}>
      {mode === 'contract' ? <ContractManagementPage /> : <PageContainer title="浮层回归测试" className={mode === 'presets' ? 'core-bill-form-page--rd' : ''}>
        <button type="button" onClick={() => setOpen(true)} disabled={loading}>打开测试浮层</button>
        {mode === 'channel' ? <ChannelAuditGroupManager enabled={!loading} partners={[]} onSave={noop} /> : null}
        {mode === 'presets' ? <div className="rd-recon-meta-header"><GamePresets onApplyPreset={noop} /></div> : null}
        {open && mode === 'confirm' ? <ConfirmDialog isOpen title="测试确认" message="只读测试，不会修改数据。" onCancel={close} onConfirm={close} /> : null}
        {open && mode === 'orders' ? <DaxiongOrderImportDialog onClose={close} onApply={noop} /> : null}
        {open && mode === 'invoice' ? <InvoiceMatchPreview preview={{ items: [] }} onClose={close} /> : null}
        {mode === 'invoice-detail' ? <InvoiceLightDrawer open={open} record={record} onClose={close} /> : null}
        {open && mode === 'customer' ? <Customer360Drawer partnerId="partner-test" onClose={close} /> : null}
      </PageContainer>}
    </AppShell>
    <output data-testid="navigations" hidden>{navigations}</output>
    <output data-testid="auth-ready" hidden>{String(!loading)}</output>
  </AppStateProvider>
}
createRoot(document.getElementById('root')).render(<React.StrictMode><AuthProvider><Fixture /></AuthProvider></React.StrictMode>)
