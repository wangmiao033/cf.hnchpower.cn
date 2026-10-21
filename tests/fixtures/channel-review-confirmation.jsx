import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ChannelReviewConfirmation from '/src/components/channel/ChannelReviewConfirmation.jsx'
function Fixture() {
  const [request, setRequest] = useState(null)
  const [count, setCount] = useState(0)
  return <main><input aria-label="账单备注" defaultValue="保留我的输入" />
    <output data-testid="requests">{count}</output>
    <button onClick={() => setRequest({ partnerName: '测试渠道', month: '2026-09', amountLabel: '¥ 100.00', dirty: true })}>保存并确认核对</button>
    <button onClick={() => setRequest({ partnerName: '测试渠道', month: '2026-09', amountLabel: '¥ 0.00', zeroSettlement: true })}>零结算</button>
    <ChannelReviewConfirmation request={request} onCancel={() => setRequest(null)} onConfirm={() => { setCount(n => n + 1); setTimeout(() => setRequest(null), 200) }} />
  </main>
}
createRoot(document.getElementById('fixture')).render(<React.StrictMode><Fixture /></React.StrictMode>)
