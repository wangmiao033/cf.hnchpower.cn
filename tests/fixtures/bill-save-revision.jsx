import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useBillFormSafety } from '/src/hooks/useBillFormSafety.js'
import { billDraftKey, readBillDraft } from '/src/domain/drafts/billDrafts.js'

const initial = { id: 'REV-1', status: 'pending', updatedAt: 'v1', partnerName: '甲', settlementAmount: 10 }
const normalize = row => ({
  // Deliberately exclude the revision from the business-data normalization:
  // the hook must still detect a changed server version.
  id: row?.id, status: row?.status,
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
    <div data-testid="server-status">{server?.status || 'loading'}</div>
    <div data-testid="draft-status">{safety.statusText}</div>
    <div data-testid="old-draft">{readBillDraft(draftKey)?.record?.settlementAmount || 'none'}</div>
    <button onClick={() => safety.onFormStateChange({ ...server, settlementAmount: 99 })}>edit-draft</button>
    <button onClick={() => setServer({ ...server, status: 'confirmed', updatedAt: 'v2', settlementAmount: 12 })}>server-confirms</button>
    <button onClick={() => setServer({ ...server, updatedAt: 'v2' })}>server-other-change</button>
    <button onClick={() => { safety.flushDraft(); setServer(null) }}>reload-starts</button>
    <button onClick={() => setServer({ ...initial, updatedAt: 'v2' })}>reload-finishes</button>
    <button onClick={() => safety.discardDraft()}>discard-on-purpose</button>
  </main>
}
createRoot(document.getElementById('fixture')).render(<Fixture />)
