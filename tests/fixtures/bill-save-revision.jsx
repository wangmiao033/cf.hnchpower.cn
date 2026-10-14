import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useBillFormSafety } from '/src/hooks/useBillFormSafety.js'
import { billDraftKey, readBillDraft } from '/src/domain/drafts/billDrafts.js'

const initial = { id: 'REV-1', status: 'pending', updatedAt: 'v1', partnerName: '甲', settlementAmount: 10 }
const normalize = row => ({
  id: row?.id, status: row?.status, updatedAt: row?.updatedAt,
  partnerName: row?.partnerName, settlementAmount: row?.settlementAmount
})
const noop = () => {}

function Fixture() {
  const [server, setServer] = useState(initial)
  const safety = useBillFormSafety({
    type: 'channel', mode: 'edit', view: 'rev-test',
    title: '账单编辑', recordId: 'REV-1',
    initialRecord: server, normalize, isMeaningful: () => true,
    setNavigationBlocker: noop, clearNavigationBlocker: noop
  })
  const draftKey = billDraftKey('channel', 'edit', 'REV-1')
  return <main>
    <div data-testid="server-status">{server.status}</div>
    <div data-testid="draft-status">{safety.statusText}</div>
    <div data-testid="old-draft">{readBillDraft(draftKey)?.record?.settlementAmount || 'none'}</div>
    <button onClick={() => safety.onFormStateChange({ ...server, settlementAmount: 99 })}>edit-draft</button>
    <button onClick={() => setServer({ ...server, status: 'confirmed', updatedAt: 'v2', settlementAmount: 12 })}>server-confirms</button>
    <button onClick={() => safety.discardDraft()}>discard-on-purpose</button>
  </main>
}
createRoot(document.getElementById('fixture')).render(<Fixture />)
