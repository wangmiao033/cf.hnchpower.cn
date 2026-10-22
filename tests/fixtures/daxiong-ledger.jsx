import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '/src/App.jsx'
import AppShell from '/src/app/AppShell.jsx'
import SelfOperatedPreviewPage from '/src/pages/DaxiongLedgerPage.jsx'
import { AppStateProvider } from '/src/app/AppStateContext.jsx'
import { AuthProvider } from '/src/features/auth/AuthContext.jsx'
import { VIEWS } from '/src/app/routes.js'
import mainSource from '/src/main.jsx?raw'

// 与正式入口一致的全局样式顺序，避免只测孤立组件而漏掉后台壳层的影响。
for (const [, path] of mainSource.matchAll(/import ['"](.+\.css)['"]/g)) {
  await import(/* @vite-ignore */ '/src/' + path.replace(/^\.\//, ''))
}

function Fixture() {
  const [view, setView] = useState(VIEWS.SELF_OPERATED)
  const value = { activeView: view, setActiveView: setView }

  return (
    <AuthProvider>
      <AppStateProvider value={value}>
        <AppShell
          activeView={view}
          onNavigate={setView}
          openTabs={[VIEWS.RECON_RD, VIEWS.RECON_CHANNEL, VIEWS.SELF_OPERATED]}
          onCloseTab={() => {}}
        >
          {view === VIEWS.SELF_OPERATED
            ? <SelfOperatedPreviewPage />
            : <div data-testid="other-view">原有功能入口</div>}
        </AppShell>
        <output data-testid="view" hidden>{view}</output>
      </AppStateProvider>
    </AuthProvider>
  )
}

createRoot(document.getElementById('fixture')).render(<Fixture />)
