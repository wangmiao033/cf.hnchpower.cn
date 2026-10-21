import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ChannelBillingForm from '/src/components/channel/ChannelBillingForm.jsx'
const partners = [{ id: 'partner-a', name: '测试客户有限公司', shortName: '测试渠道（聚合）' }]
const seed = { id: 'bill-a', partnerName: partners[0].name, channelName: partners[0].shortName, status: 'pending', items: [{ id: 'line-a', gameName: new URLSearchParams(window.location.search).has('unknownDevice') ? '测试游戏3折' : '测试游戏3折-ios', settlementCycle: '2026-09', flow: 6, discountFactor: .3, testCost: 1.8, shareRate: 25, taxRate: 0, platformSettlementAmount: 0, channelFeeMode: 'none', channelFeeRate: 0, settlementRuleCode: 'share_only' }] }
const compactCase = new URLSearchParams(window.location.search).get('compact')
if (compactCase === '005' || compactCase === '01') {
  seed.items[0] = { ...seed.items[0], gameName: `测试游戏${compactCase}折混服`, discountFactor: compactCase === '005' ? .005 : .01, flow: 10000, testCost: 0, platformSettlementAmount: null }
}
function Fixture() {
  const [source, setSource] = useState(seed)
  const [revision, setRevision] = useState(0)
  const [current, setCurrent] = useState(null)
  const [saved, setSaved] = useState(null)
  const [error, setError] = useState('')
  return <main>
    <ChannelBillingForm key={revision} formId="bill-form" mode="edit" recordId="bill-a" sourceRecord={source} partners={partners} onFormStateChange={setCurrent} onError={setError} onUpdateRecord={async (id, record) => { setSaved(record); setSource({ ...record, items: record.items.map(line => ({ ...line, id: 'saved-line-a' })) }); return true }} />
    <button form="bill-form" type="submit">测试保存</button><button onClick={() => setRevision(n => n + 1)}>测试重新打开</button>
    <output data-testid="current">{JSON.stringify(current)}</output><output data-testid="saved">{JSON.stringify(saved)}</output><output role="alert">{error}</output>
  </main>
}
createRoot(document.getElementById('fixture')).render(<Fixture />)
