import React from 'react'
import { createRoot } from 'react-dom/client'
import '/src/App.jsx'
import InvoiceLightDrawer from '/src/components/invoice/InvoiceLightDrawer.jsx'
import '/src/components/invoice/invoice-admin.css'
import mainSource from '/src/main.jsx?raw'
for (const [, path] of mainSource.matchAll(/import ['"](.+\.css)['"]/g)) {
  await import(/* @vite-ignore */ '/src/' + path.replace(/^\.\//, ''))
}
createRoot(document.getElementById('fixture')).render(<InvoiceLightDrawer open record={{ id:'test-invoice', invoiceDirection:'output', buyerName:'测试渠道公司', digitalInvoiceNo:'26442000010949414566', amount:'100', taxAmount:'6', amountWithTax:'106', issueDate:'2026-09-23' }} onClose={()=>{}} showToast={()=>{}} />)
