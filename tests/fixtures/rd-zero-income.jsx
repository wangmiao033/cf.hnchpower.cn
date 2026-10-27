import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ReconciliationLineItemsForm from '/src/components/reconciliation/ReconciliationLineItemsForm.jsx'
import RdReconciliationProgressPanel from '/src/components/reconciliation/RdReconciliationProgressPanel.jsx'
import { summarizeRdReconciliationProgress } from '/src/domain/reconciliation/rdReconciliationProgress.js'
import { frontendRecordToApiPayload, apiRowToFrontend } from '/src/lib/api/reconciliation.ts'
import { calculateRdSettlementRow } from '/src/domain/settlement/calculateSettlementAmount.js'
import { expandRdRecordsForSettlementExport } from '/src/domain/export/settlementConfirmationExport.js'
import { readBillDraft, writeBillDraft } from '/src/domain/drafts/billDrafts.js'

const zeroOnly = new URLSearchParams(location.search).has('zeroOnly')
const amounts = zeroOnly ? ['', ''] : [100, 200, 934.56, '', '']
const partners = [{ id: 'synthetic-partner', name: '合成研发' }]
const seed = { id: 'synthetic-bill', partnerId: partners[0].id, partner: partners[0].name, status: 'pending', settlementMonth: '2026年9月', settlementNumber: 'SYNTHETIC-ZERO', channelFeeRate: 0,
  items: amounts.map((revenue, index) => ({ id: `line-${index}`, gameName: `合成游戏${index + 1}`, settlementCycle: '2026年9月', revenue, discountRate: 1, shareRatio: 100, taxRate: 0, couponAmount: 0, testFee: 0, extraFee: 0 })) }

function Fixture() {
  const [source, setSource] = useState(seed)
  const [draft, setDraft] = useState(readBillDraft('rd-zero-synthetic')?.record || null)
  const [current, setCurrent] = useState(null), [saved, setSaved] = useState(null), [error, setError] = useState('')
  const [revision, setRevision] = useState(0), [saveCount, setSaveCount] = useState(0)
  const save = (_id, record) => {
    const payload = frontendRecordToApiPayload(record)
    const response = { ...payload, id: seed.id, items: payload.items.map((item, index) => {
      const calc = calculateRdSettlementRow(record.items[index], record.channelFeeRate)
      return { ...item, id: `stored-${index}`, net_revenue: calc.totalFlow, share_amount: calc.shareAmount, settlement_amount: calc.settlementAmount }
    }) }
    setSaved(apiRowToFrontend(response)); setSaveCount(value => value + 1); setError('')
    return true
  }
  return <main>
    <ReconciliationLineItemsForm key={revision} mode="edit" formId="rd-zero" editRecord={source} draftRecord={draft} partners={partners} onFormStateChange={setCurrent} onError={setError} onUpdateRecord={save} />
    <button onClick={() => { setSource(saved); setDraft(null); setRevision(value => value + 1) }}>重新打开</button>
    <button onClick={() => writeBillDraft('rd-zero-synthetic', current)}>保存本机草稿</button>
    <output data-testid="saved">{JSON.stringify(saved)}</output><output data-testid="save-count">{saveCount}</output><output role="alert">{error}</output>
    {saved && <><RdReconciliationProgressPanel snapshot={summarizeRdReconciliationProgress([saved])} />
      <table data-testid="export"><tbody>{expandRdRecordsForSettlementExport([saved]).map((row, i) => <tr key={i}><td>{row.game}</td><td>{row.revenue.toFixed(2)}</td><td>{row.settlementAmount.toFixed(2)}</td></tr>)}</tbody></table></>}
  </main>
}
createRoot(document.getElementById('fixture')).render(<Fixture />)
