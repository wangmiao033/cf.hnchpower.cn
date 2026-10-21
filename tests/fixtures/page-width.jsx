import React from 'react'
import { createRoot } from 'react-dom/client'
import '/src/App.jsx'
import AppShell from '/src/app/AppShell.jsx'
import { AppStateProvider } from '/src/app/AppStateContext.jsx'
import { AuthProvider, useAuth } from '/src/features/auth/AuthContext.jsx'
import { VIEWS } from '/src/app/routes.js'
import mainSource from '/src/main.jsx?raw'
for (const [, path] of mainSource.matchAll(/import ['"](.+\.css)['"]/g)) {
  await import(/* @vite-ignore */ '/src/' + path.replace(/^\.\//, ''))
}
// Match production: route CSS is fetched after the shared main stylesheet.
const mode = new URLSearchParams(location.search).get('mode') || 'contract'
const RoutePage = (await import(/* @vite-ignore */ mode === 'contract'
  ? '/src/pages/ContractManagementPage.jsx' : '/src/pages/CoreDashboardV4.jsx')).default
const noop = () => {}
function Fixture() {
  const { loading } = useAuth()
  const active = mode === 'contract' ? VIEWS.CONTRACTS : VIEWS.DASHBOARD
  return <AppStateProvider value={{ settings: { partners: [] }, showToast: noop, openBill360: noop, openInvoiceEdit: noop, setActiveView: noop }}>
    <AppShell activeView={active} onNavigate={noop} openTabs={[active]}>
      <RoutePage />
    </AppShell>
    <output data-testid="auth-ready" hidden>{String(!loading)}</output>
  </AppStateProvider>
}
createRoot(document.getElementById('root')).render(<AuthProvider><Fixture /></AuthProvider>)
