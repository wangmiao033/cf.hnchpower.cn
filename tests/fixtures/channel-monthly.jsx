import React from 'react'
import { createRoot } from 'react-dom/client'
import '/src/App.jsx'
import CoreChannelReconciliationPage from '/src/pages/CoreChannelReconciliationPage.jsx'
import { AppStateProvider } from '/src/app/AppStateContext.jsx'
import { AuthProvider, useAuth } from '/src/features/auth/AuthContext.jsx'
import { useReconciliationStore } from '/src/store/useReconciliationStore.js'
import mainSource from '/src/main.jsx?raw'
for (const [, path] of mainSource.matchAll(/import ['"](.+\.css)['"]/g)) {
  await import(/* @vite-ignore */ '/src/' + path.replace(/^\.\//, ''))
}
const noop = () => {}
const settings = { partners: [], deliveries: [] }
function Ledger() {
  const recon = useReconciliationStore(settings, noop)
  return <AppStateProvider value={{ recon, settings, showToast: noop, setActiveView: noop,
    openBill360: noop, openChannelReconciliationEdit: noop }}>
    <CoreChannelReconciliationPage />
  </AppStateProvider>
}
function Ready() { return useAuth().loading ? null : <Ledger /> }
createRoot(document.getElementById('fixture')).render(
  <main style={{ width: '100%', padding: 16, boxSizing: 'border-box' }}>
    <AuthProvider><Ready /></AuthProvider>
  </main>
)
