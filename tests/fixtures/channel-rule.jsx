import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '/src/App.jsx'
import ChannelBillingForm from '/src/components/channel/ChannelBillingForm.jsx'
import '/src/pages/ChannelBillCompact.css'

const partners = [{ id: 'fixture-partner', name: '测试渠道合作方', shortName: '测试渠道' }]
const record = {
  id: 'fixture-draft', partnerName: partners[0].name, channelName: '测试渠道', status: 'pending',
  items: [
    { gameName: '游戏甲', settlementCycle: '2026-08', flow: 6, shareRate: '', taxRate: '', platformSettlementAmount: 2.85 },
    { gameName: '游戏乙', settlementCycle: '2026-08', flow: 11662, voucherCost: 2901.05, shareRate: '', taxRate: '', platformSettlementAmount: 4161.45 }
  ]
}
function Fixture() {
  const [current, setCurrent] = useState(null)
  return <main className="core-bill-form-page--channel is-compact-view" style={{ padding: 16 }}>
    <ChannelBillingForm mode="edit" recordId={record.id} sourceRecord={record} partners={partners} onFormStateChange={setCurrent} />
    <output data-testid="calculated-record">{JSON.stringify(current)}</output>
  </main>
}
createRoot(document.getElementById('fixture')).render(<Fixture />)
