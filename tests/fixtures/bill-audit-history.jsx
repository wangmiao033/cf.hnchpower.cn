import React from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider, useAuth } from '/src/features/auth/AuthContext.jsx'
import { AppStateProvider } from '/src/app/AppStateContext.jsx'
import LockedBillEditNotice from '/src/components/reconciliation/LockedBillEditNotice.jsx'
import productionHtml from '/index.html?raw'
// Preserve the production retirement CSS: this regression must not revive 360.
for (const [, css] of productionHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
  const style = document.createElement('style'); style.textContent = css; document.head.append(style)
}
function AuthReady() {
  const { loading, user } = useAuth()
  return <span>{!loading && user ? '权限已加载' : '权限加载中'}</span>
}
const billType = new URLSearchParams(location.search).get('type') || 'channel'
createRoot(document.getElementById('fixture')).render(
  <AuthProvider><AuthReady /><AppStateProvider value={{ recon: {}, showToast: () => {} }}>
    <LockedBillEditNotice billType={billType} record={{id:'audit-test',status:'confirmed',channelName:'测试渠道',settlementMonth:'2026-09'}}>
      <p>原账单金额 ¥475.81</p>
    </LockedBillEditNotice>
    <div className="bill360-workspace-host">已停用工作区</div>
  </AppStateProvider></AuthProvider>
)
