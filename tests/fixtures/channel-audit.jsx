import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
// Load the real application imports and then its trailing styles, in main.jsx order.
import '/src/App.jsx'
import '/src/pages/CoreChannelReconciliationGroupedPage.jsx'
import mainSource from '/src/main.jsx?raw'
import ChannelMonthCoveragePanel from '/src/components/channel/ChannelMonthCoveragePanel.jsx'
import { channelAuditMonths } from '/src/domain/channel/channelMonthCoverage.js'
for (const [, path] of mainSource.matchAll(/import ['"](.+\.css)['"]/g)) {
  await import(/* @vite-ignore */ '/src/' + path.replace(/^\.\//, ''))
}
const months = channelAuditMonths({ windowSize: 12 })
const visible = months.slice(-6)
const count = Number(new URLSearchParams(location.search).get('rows') || 4)
const records = Array.from({ length: count }, (_, index) => [visible[0], visible[3]].map((month, n) => ({
  id: `${index}-${month}`, channelName: `渠道${index + 1}`, settlementMonth: month,
  status: n === 0 ? 'archived' : 'confirmed',
  items: [{ settlementCycle: month, gameName: '测试游戏' }]
}))).flat()
function Fixture() {
  const [focus, setFocus] = useState('')
  const [selected, setSelected] = useState(null)
  return <main style={{ width: '100%', padding: 16, boxSizing: 'border-box' }}>
    <button onClick={() => setFocus('渠道1')}>聚焦渠道1</button>
    <div className="page-container core-channel-recon-page"><div className="page-container-body">
      <ChannelMonthCoveragePanel records={records} initialExpanded focusChannel={focus}
        onClearFocus={() => setFocus('')}
        onInspectMonth={(channel, month, options) => setSelected({ channel, month, ...options })} />
    </div></div>
    <output data-testid="selection">{JSON.stringify(selected)}</output>
  </main>
}
createRoot(document.getElementById('fixture')).render(<Fixture />)
