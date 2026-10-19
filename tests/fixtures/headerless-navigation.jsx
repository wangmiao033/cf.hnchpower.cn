import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '/src/App.jsx'
import AppShell from '/src/app/AppShell.jsx'
import CoreChannelReconciliationPage from '/src/pages/CoreChannelReconciliationPage.jsx'
import CoreReconciliationPage from '/src/pages/CoreReconciliationPage.jsx'
import ChannelReconciliationCreatePage from '/src/pages/ChannelReconciliationCreatePage.jsx'
import ReconciliationCreatePage from '/src/pages/ReconciliationCreatePage.jsx'
import UserCenterPage from '/src/pages/UserCenterPage.jsx'
import { AppStateProvider } from '/src/app/AppStateContext.jsx'
import { AuthProvider } from '/src/features/auth/AuthContext.jsx'
import { VIEWS } from '/src/app/routes.js'
import mainSource from '/src/main.jsx?raw'
for (const [, path] of mainSource.matchAll(/import ['"](.+\.css)['"]/g)) {
  await import(/* @vite-ignore */ '/src/' + path.replace(/^\.\//, ''))
}
const noop = () => {}
const partners = [{ id: 'vivo-1', name: '维沃移动通信有限公司', shortName: 'vivo天鑫' }]
const channelRecords = [{ id:'channel-1', partnerId:'vivo-1', partnerName:partners[0].name, channelName:'vivo天鑫', settlementMonth:'2026-09', status:'pending', settlementAmount:100, receivedAmount:0, items:[{gameName:'测试游戏',settlementCycle:'2026-09'}] }]
const records = [{id:'rd-1',partner:'测试研发',settlementMonth:'2026-09',status:'pending',settlementAmount:200,items:[]}]
function Fixture() {
  const [activeView,setActiveView] = useState(new URLSearchParams(location.search).get('view') || VIEWS.RECON_CHANNEL)
  const [channelCreatePrefill,setPrefill] = useState(null)
  const [quickFillData,setQuickFillData] = useState(null)
  const value = {
    activeView, setActiveView, showToast:noop, setNavigationBlocker:noop, clearNavigationBlocker:noop,
    openChannelCreate: prefill => {setPrefill(prefill);setActiveView(VIEWS.CHANNEL_RECON_CREATE)},
    channelCreatePrefill, channelReturnView:VIEWS.RECON_CHANNEL, reconReturnView:VIEWS.RECON_RD,
    settings:{partners}, invoice:{},
    recon:{channelRecords,records,channelApiEnabled:false,reconciliationApiEnabled:false,quickFillData,setQuickFillData},
    openBill360:noop,prefetchBill360:noop,openReconciliationEdit:noop,openChannelReconciliationEdit:noop
  }
  const content = activeView===VIEWS.RECON_CHANNEL ? <CoreChannelReconciliationPage />
    : activeView===VIEWS.RECON_RD ? <CoreReconciliationPage />
    : activeView===VIEWS.CHANNEL_RECON_CREATE ? <ChannelReconciliationCreatePage />
    : activeView===VIEWS.RECON_CREATE ? <ReconciliationCreatePage />
    : activeView===VIEWS.USER_CENTER ? <UserCenterPage /> : <h1>经营工作台</h1>
  return <AuthProvider><AppStateProvider value={value}>
    <AppShell activeView={activeView} onNavigate={setActiveView} openTabs={[VIEWS.RECON_RD,VIEWS.RECON_CHANNEL]}>
      {content}
    </AppShell>
    <output data-testid="route" hidden>{activeView}</output>
    <output data-testid="prefill" hidden>{JSON.stringify(channelCreatePrefill)}</output>
  </AppStateProvider></AuthProvider>
}
createRoot(document.getElementById('fixture')).render(<Fixture />)
