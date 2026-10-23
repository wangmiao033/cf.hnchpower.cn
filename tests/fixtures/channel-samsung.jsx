import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ChannelBillingForm from '/src/components/channel/ChannelBillingForm.jsx'
import { frontendChannelRecordToPayload, apiChannelRowToFrontend } from '/src/lib/api/channel.ts'
const other=new URLSearchParams(location.search).has('other')
const partners=[{id:'synthetic-partner',name:other?'合成其他公司':'北京鹏泰博兴科技有限公司',shortName:other?'合成渠道':'鹏泰博兴'}]
const rule={settlementRuleCode:'five_percent_gateway_share',channelFeeMode:'percent',channelFeeRate:5,taxMode:'none'}
const seed={id:'synthetic-bill',partnerName:partners[0].name,channelName:other||new URLSearchParams(location.search).has('alias')?partners[0].shortName:'三星',status:'pending',settlementMonth:'2026-07',...rule,items:[{id:'synthetic-line-1',gameName:'合成游戏甲',settlementCycle:'2026-07',flow:532,shareRate:50,taxRate:6,platformSettlementAmount:255.46,...rule},{id:'synthetic-line-2',gameName:'合成游戏乙',settlementCycle:'2026-07',flow:262,voucherCost:47,shareRate:50,taxRate:6,platformSettlementAmount:103.20,...rule}]}
function Fixture(){
 const [source,setSource]=useState(seed),[revision,setRevision]=useState(0),[current,setCurrent]=useState(null),[saved,setSaved]=useState(null),[error,setError]=useState('')
 return <main><ChannelBillingForm key={revision} mode="edit" formId="bill" recordId={source.id} sourceRecord={source} partners={partners} onFormStateChange={setCurrent} onError={setError} onUpdateRecord={async(id,record)=>{
 const payload=frontendChannelRecordToPayload(record);setSaved(payload)
 setSource(apiChannelRowToFrontend({...payload,id,items:payload.items.map((row,i)=>({...row,id:`saved-${i}`,channel_record_id:id,sort_order:i}))}));return true
 }}/><button type="submit" form="bill">测试保存</button><button onClick={()=>setRevision(n=>n+1)}>测试重新打开</button><output data-testid="current">{JSON.stringify(current)}</output><output data-testid="saved">{JSON.stringify(saved)}</output><output role="alert">{error}</output></main>
}
createRoot(document.getElementById('fixture')).render(<Fixture/>)
