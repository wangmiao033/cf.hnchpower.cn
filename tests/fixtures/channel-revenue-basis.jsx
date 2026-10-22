import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ChannelBillingForm from '/src/components/channel/ChannelBillingForm.jsx'
import '/src/pages/ChannelBillCompact.css'

const params = new URLSearchParams(window.location.search)
const isOther = params.has('other')
const partners = [{ id: 'synthetic-partner', name: isOther ? '测试其他主体' : '昆山爱趣网络科技有限公司', shortName: isOther ? '4399' : '爱趣' }]
const source = {
  id: 'synthetic-bill', partnerName: partners[0].name, channelName: partners[0].shortName,
  status: params.has('confirmed') ? 'confirmed' : 'pending',
  receiptStatus: params.has('zeroPaid') ? 'paid' : 'unpaid', receivedAmount: params.has('received') ? 1 : 0,
  settlementRuleCode: 'share_only', channelFeeMode: 'none', taxMode: 'none',
  items: [{ id: 'synthetic-line', settlementCycle: '2026-09', gameName: '隔离测试游戏', flow: 1000, discountFactor: 0.1,
    voucherFaceValue: params.has('face') ? 100 : 0, voucherDirectCost: 0,
    shareRate: 30, taxRate: 0, gatewayCost: 0, noWorryCost: 0, refundCost: 0, testCost: 0, welfareCost: 0, coinCost: 0
  }]
}
function Fixture() {
  const [current, setCurrent] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(0)
  return <main className="core-bill-form-page--channel is-compact-view has-advanced-data" style={{ padding: 16 }}>
    <ChannelBillingForm formId="synthetic-basis-form" mode="edit" recordId={source.id} sourceRecord={source}
      partners={partners} onFormStateChange={setCurrent} onError={setError} onUpdateRecord={() => setSaved(count => count + 1)} />
    <button type="submit" form="synthetic-basis-form">测试保存</button>
    <output data-testid="calculated-record">{JSON.stringify(current)}</output>
    <output data-testid="saved-count">{saved}</output>
    <output data-testid="form-error">{error}</output>
  </main>
}
createRoot(document.getElementById('fixture')).render(<Fixture />)
