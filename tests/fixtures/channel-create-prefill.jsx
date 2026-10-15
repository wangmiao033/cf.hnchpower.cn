import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ChannelBillingForm from '/src/components/channel/ChannelBillingForm.jsx'
import '/src/pages/ChannelBillCompact.css'

const partners = [
  { id:'vivo-1', name:'维沃移动通信有限公司', shortName:'vivo天鑫' },
  { id:'opp-1', name:'广东欧珀移动通信有限公司', shortName:'OPPO渠道' }
]
const blank = new URLSearchParams(window.location.search).has('blank')
const prefill = blank ? null : {
  partnerId:'vivo-1', partnerName:'维沃移动通信有限公司', channelName:'vivo天鑫'
}
const seed = prefill ? {partnerName:prefill.partnerName,channelName:prefill.channelName,items:[]} : null
function Fixture() {
  const [current,setCurrent] = useState(null)
  return <main className="core-bill-form-page--channel is-compact-view" style={{padding:16}}>
    <ChannelBillingForm mode="add" draftRecord={seed} createPrefillPartner={prefill}
      partners={partners} onFormStateChange={setCurrent} />
    <output data-testid="calculated-record">{JSON.stringify(current)}</output>
  </main>
}
createRoot(document.getElementById('fixture')).render(<Fixture />)
