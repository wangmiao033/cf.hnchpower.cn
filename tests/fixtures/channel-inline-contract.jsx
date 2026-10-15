import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ChannelContractIssueEditor from '/src/components/channel/ChannelContractIssueEditor.jsx'

const issue = {
  line_index: 1, game_name: '龙吟大陆（内置0.1折正版放置手游）', settlement_cycle: '2025-07',
  message: '已找到合同，但候选身份仍需人工确认',
  match: {
    contract_id: 'C1', access_item_id:'A1', contract_name:'渠道合作协议',
    authorization_start:null, authorization_end:null
  }
}
function Fixture() {
  const [saves, setSaves] = useState(0)
  return <main>
    <output data-testid="saved-count">{saves}</output>
    <output data-testid="ledger-amount">1174.72</output>
    <ChannelContractIssueEditor issue={issue} partnerName="湖南芯动网络科技有限公司"
      onClose={() => {}} onSaved={() => setSaves(n => n + 1)} />
  </main>
}
createRoot(document.getElementById('fixture')).render(<Fixture />)
