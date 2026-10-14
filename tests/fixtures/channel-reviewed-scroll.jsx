import React from 'react'
import { createRoot } from 'react-dom/client'
import ChannelBillReadonlyView from '/src/components/channel/ChannelBillReadonlyView.jsx'
import mainSource from '/src/main.jsx?raw'
for (const [, path] of mainSource.matchAll(/import ['"](.+\.css)['"]/g)) {
  await import(/* @vite-ignore */ '/src/' + path.replace(/^\.\//, ''))
}
const snapshot = {
  id: 'XIAOMI-202609',
  billNumber: 'QD-20261010-09CA29',
  partnerName: '北京瓦力网络科技有限公司',
  channelName: '瓦力（小米）',
  settlementMonth: '2026-09',
  status: 'confirmed',
  settlementAmount: 475.81,
  receivedAmount: 0
}
createRoot(document.getElementById('fixture')).render(
  <main style={{ maxWidth: 1000, margin: '0 auto', padding: 20, minWidth: 0 }}>
    <ChannelBillReadonlyView recordId="XIAOMI-202609" fallbackRecord={snapshot} />
  </main>
)