import React from 'react'
import { createRoot } from 'react-dom/client'
import ChannelInvoiceMergeDialog from '/src/components/channel/ChannelInvoiceMergeDialog.jsx'

const rows = [{ id:'feb', billNumber:'QD-FEB', partnerName:'湖南天宇互动网络科技有限公司', channelName:'天宇游戏',
  status:'confirmed', settlementMonth:'2026-02', settlementAmount:36.46, receivedAmount:0 }]
createRoot(document.getElementById('fixture')).render(
  <ChannelInvoiceMergeDialog rows={rows} onClose={() => {}}
    onIssued={result => {
      document.body.dataset.completed = result.invoice_id
    }}
    showToast={() => {}} />
)
