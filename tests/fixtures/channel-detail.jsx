import React from 'react'
import { createRoot } from 'react-dom/client'
import '/src/App.jsx'
import CoreChannelReconciliationGroupedPage from '/src/pages/CoreChannelReconciliationGroupedPage.jsx'
import { AppStateProvider } from '/src/app/AppStateContext.jsx'
import { AuthProvider } from '/src/features/auth/AuthContext.jsx'
import mainSource from '/src/main.jsx?raw'
for (const [, path] of mainSource.matchAll(/import ['"](.+\.css)['"]/g)) {
  await import(/* @vite-ignore */ '/src/' + path.replace(/^\.\//, ''))
}
const records = ['百分', '八门'].flatMap(channelName => Array.from({ length: 14 }, (_, i) => ({
  id: `${channelName}-${i}`, channelName, partnerName: `${channelName}合作方`,
  settlementMonth: i < 7 ? '2026-09' : '2026-08', status: 'confirmed',
  statementNo: `${channelName}-${i}`, settlementAmount: 100, receivedAmount: 0,
  items: [{ settlementCycle: i < 7 ? '2026-09' : '2026-08', gameName: i % 2 ? '游戏甲' : '游戏乙' }]
})))
records.push({ ...records[0], id: 'archived', channelName: '归档渠道' })
const noop = () => {}
const value = {
  recon: { channelRecords: records, records: [], channelApiEnabled: false },
  settings: {}, showToast: noop, setActiveView: noop, openBill360: noop,
  openChannelReconciliationEdit: noop
}
createRoot(document.getElementById('fixture')).render(
  <main style={{ width: '100%', padding: 16, boxSizing: 'border-box' }}>
    <AuthProvider><AppStateProvider value={value}><CoreChannelReconciliationGroupedPage /></AppStateProvider></AuthProvider>
  </main>
)
