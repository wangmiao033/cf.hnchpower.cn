import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '/src/App.jsx'
import AppShell from '/src/app/AppShell.jsx'
import SelfOperatedPreviewPage from '/src/pages/SelfOperatedPreviewPage.jsx'
import { AppStateProvider } from '/src/app/AppStateContext.jsx'
import { AuthProvider, useAuth } from '/src/features/auth/AuthContext.jsx'
import { VIEWS } from '/src/app/routes.js'
import mainSource from '/src/main.jsx?raw'

// 与正式入口一致的全局样式顺序，避免只测孤立组件而漏掉后台壳层的影响。
for (const [, path] of mainSource.matchAll(/import ['"](.+\.css)['"]/g)) {
  await import(/* @vite-ignore */ '/src/' + path.replace(/^\.\//, ''))
}

function Fixture() {
  const { loading, user } = useAuth()
  const [view, setView] = useState(VIEWS.SELF_OPERATED)
  const value = { activeView: view, setActiveView: setView }

  // Match the production App's authentication gate. Mounting the business page
  // before auth resolves lets its account-change reset race with test input.
  if (loading || !user) return <p data-testid="fixture-auth-loading">正在加载测试账号…</p>

  return (
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
  )
}

createRoot(document.getElementById('fixture')).render(<AuthProvider><Fixture /></AuthProvider>)
