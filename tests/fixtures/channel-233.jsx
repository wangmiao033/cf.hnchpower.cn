import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ChannelBillingForm from '/src/components/channel/ChannelBillingForm.jsx'
import { frontendChannelRecordToPayload, apiChannelRowToFrontend } from '/src/lib/api/channel.ts'
import { readBillDraft, writeBillDraft } from '/src/domain/drafts/billDrafts.js'
const other = new URLSearchParams(location.search).has('other')
const partners = [{ id: 'synthetic-233-partner', name: other ? '合成其他公司' : '北京龙威互动科技有限公司', shortName: other ? '大熊' : '龙威233' }]
const seed = { partnerName: partners[0].name, channelName: partners[0].shortName, status: 'pending', settlementMonth: '2026-06', settlementRuleCode: 'custom', channelFeeMode: 'none', taxMode: 'none',
  items: [{ gameName: '合成游戏', settlementCycle: '2026-06', flow: '', shareRate: '', taxRate: '', platformSettlementAmount: -5.34, refundCost: 5.34 }] }
function Fixture() {
  const [source, setSource] = useState(null), [draft, setDraft] = useState(readBillDraft('synthetic-233-draft')?.record || seed), [revision, setRevision] = useState(0)
  const [current, setCurrent] = useState(null), [saved, setSaved] = useState(null), [error, setError] = useState('')
  const intent = useRef('back')
  const save = record => {
    const payload = frontendChannelRecordToPayload(record); setSaved(payload)
    setSource(apiChannelRowToFrontend({ ...payload, id: 'synthetic-bill', items: payload.items.map((row, index) => ({ ...row, id: `synthetic-line-${index}` })) }))
    return true
  }
  return <main>
    <ChannelBillingForm key={revision} mode={source ? 'edit' : 'add'} formId="bill233" recordId={source?.id} sourceRecord={source} draftRecord={draft} partners={partners} submitIntentRef={intent} onFormStateChange={setCurrent} onError={setError} onAddRecord={save} onUpdateRecord={(id, record) => save(record)} />
    <button type="submit" form="bill233" onClick={() => { intent.current = 'back' }}>测试保存</button>
    <button type="submit" form="bill233" onClick={() => { intent.current = 'confirm' }}>测试确认</button>
    <button onClick={() => { setDraft(null); setRevision(value => value + 1) }}>测试重新打开</button>
    <button onClick={() => writeBillDraft('synthetic-233-draft', current)}>测试保存本机草稿</button>
    <output data-testid="current">{JSON.stringify(current)}</output><output data-testid="saved">{JSON.stringify(saved)}</output><output role="alert">{error}</output>
  </main>
}
createRoot(document.getElementById('fixture')).render(<Fixture />)
