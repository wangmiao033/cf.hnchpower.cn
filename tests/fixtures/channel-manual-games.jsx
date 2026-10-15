import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ChannelSmartEntryBar from '/src/components/channel/ChannelSmartEntryBar.jsx'

const first = {
  partnerName: '示例渠道公司', channelName: '示例渠道公司',
  settlementMonth: '2026-08',
  items: [{
    id: '', settlementCycle: '', gameName: '', flow: '', discountFactor: '1',
    shareRate: '30', taxRate: '0'
  }]
}
const past = {
  partnerName: '示例渠道公司', channelName: '示例渠道公司',
  settlementMonth: '2026-07',
  items: [{ gameName: '上月历史游戏', settlementCycle: '2026-07', flow: 100 }]
}
function Fixture() {
  const [record, setRecord] = useState(first)
  const [events, setEvents] = useState([])
  return <main style={{padding:18}}>
    <ChannelSmartEntryBar record={record} channelRecords={[past]}
      onApply={(next,message) => {
        setEvents(current => [...current, String(message || '')])
        setRecord(next)
      }}
      onNotice={() => {}}
    />
    <output data-testid="generated-events">{events.length}</output>
    <output data-testid="game-list">{JSON.stringify(record.items.map(item => item.gameName))}</output>
    <output data-testid="statement-month">{record.settlementMonth || ''}</output>
  </main>
}
createRoot(document.getElementById('fixture')).render(<Fixture />)
