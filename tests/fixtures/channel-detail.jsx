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
const fixtureParams = new URLSearchParams(window.location.search)
const records = ['百分', '八门'].flatMap(channelName => Array.from({ length: 14 }, (_, i) => ({
  id: `${channelName}-${i}`, channelName, partnerName: `${channelName}合作方`,
  settlementMonth: i < 7 ? '2026-09' : '2026-08', status: 'confirmed',
  statementNo: `${channelName}-${i}`, settlementAmount: 100, receivedAmount: 0,
  items: [{ settlementCycle: i < 7 ? '2026-09' : '2026-08', gameName: i % 2 ? '游戏甲' : '游戏乙' }]
})))
records.push({ ...records[0], id: 'archived', channelName: '归档渠道' })
if (new URLSearchParams(window.location.search).has('legacy-aliases')) {
  records.splice(0, records.length,
    {
      id: 'Y-202608', channelName: '游海', originalChannelName: '游海（麦游）',
      partnerName: '西安游海网络科技有限公司',
      statementNo: 'QD-YOUHAI-08', settlementMonth: '2026-08',
      settlementAmount: 3119.46, receivedAmount: 0, status: 'confirmed',
      items: [{ gameName: '一起来修仙', settlementCycle: '2026-08' }]
    },
    {
      id: 'M-202609', channelName: '麦游',
      partnerName: '西安麦游网络科技有限公司',
      statementNo: 'QD-MAIYOU-09', settlementMonth: '2026-09',
      settlementAmount: 2802.70, receivedAmount: 0, status: 'confirmed',
      items: [{ gameName: '一起来修仙', settlementCycle: '2026-09' }]
    },
    {
      id: 'OTHER', channelName: '百分', partnerName: '四川百分网',
      settlementMonth: '2026-09', status: 'pending',
      settlementAmount: 100, receivedAmount: 0,
      items: [{ gameName: '其他游戏', settlementCycle: '2026-09' }]
    }
  )
}

if (fixtureParams.has('cumulative')) {
  records.splice(0, records.length, ...[
    ['threshold-pending', 'pending', 0], ['threshold-active', 'confirmed', 0],
    ['threshold-ready', 'confirmed', 0], ['threshold-paid', 'completed', 100],
    ['threshold-archived', 'completed', 100], ['threshold-cancelled', 'cancelled', 0], ['periodic', 'pending', 0],
    ['disabled-policy', 'confirmed', 0], ['missing-mode', 'confirmed', 0]
  ].map(([id, status, receivedAmount]) => ({
    ...records[0], id, billNumber: id, statementNo: id, channelName: '合成渠道', partnerName: '合成合作方',
    settlementMonth: '2026-07', status, receivedAmount, remark: '累计中（仅备注，不作为类型）',
    items: [{ gameName: '测试游戏', settlementCycle: '2026-07' }]
  })))
}
const noop = () => {}
const value = {
  recon: { channelRecords: records, records: [], channelApiEnabled: fixtureParams.has('cumulative') },
  settings: {}, showToast: noop, setActiveView: noop, openBill360: noop,
  openChannelReconciliationEdit: noop
}
createRoot(document.getElementById('fixture')).render(
  <main style={{ width: '100%', padding: 16, boxSizing: 'border-box' }}>
    <AuthProvider><AppStateProvider value={value}><CoreChannelReconciliationGroupedPage /></AppStateProvider></AuthProvider>
  </main>
)
