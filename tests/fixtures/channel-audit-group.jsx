import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import ChannelMonthCoveragePanel from '/src/components/channel/ChannelMonthCoveragePanel.jsx'
import '/src/components/channel/ChannelMonthCoveragePanel.css'

const a='武汉曦晨互娱网络科技有限公司',b='武汉杨桃网络科技有限公司'
const initial=[
 {id:'a',name:a,shortName:'曦晨互娱',category:'渠道',channelAuditGroup:''},
 {id:'b',name:b,shortName:'武汉瓜子',category:'渠道',channelAuditGroup:''},
 {id:'c',name:'厦门游戏之家科技有限公司',shortName:'游戏之家',category:'渠道',channelAuditGroup:''}
]
const records=[
 {id:'a-7',channelName:'曦晨渠道',partnerName:a,settlementMonth:'2026-07',status:'confirmed',items:[{gameName:'测试',settlementCycle:'2026-07'}]},
 {id:'b-8',channelName:'武汉瓜子',partnerName:b,settlementMonth:'2026-08',status:'confirmed',items:[{gameName:'测试',settlementCycle:'2026-08'}]},
 {id:'b-9',channelName:'武汉瓜子',partnerName:b,settlementMonth:'2026-09',status:'confirmed',items:[{gameName:'测试',settlementCycle:'2026-09'}]},
]
function Fixture(){
 const [partners,setPartners]=useState(initial)
 const [last,setLast]=useState(null)
 const [drill,setDrill]=useState(null)
 const onSave=async ({partnerIds,groupName,removeIds=[]})=>{
  setLast({partnerIds,groupName,removeIds})
  setPartners(prev=>prev.map(p=>({...p,channelAuditGroup:partnerIds.includes(p.id)?groupName:removeIds.includes(p.id)?'':p.channelAuditGroup})))
  return true
 }
 return <main className="core-channel-recon-page">
  <ChannelMonthCoveragePanel initialExpanded records={records} partners={partners}
   groupEditEnabled onSaveGroup={onSave} onInspectMonth={(name,month,options)=>setDrill({name,month,options})}/>
  <output data-testid="saved-group">{JSON.stringify(last)}</output>
  <output data-testid="drill">{JSON.stringify(drill)}</output>
 </main>
}
createRoot(document.getElementById('fixture')).render(<Fixture/>)
