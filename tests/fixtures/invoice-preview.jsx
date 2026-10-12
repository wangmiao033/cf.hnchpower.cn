import React from 'react'
import { createRoot } from 'react-dom/client'
import InvoiceMatchPreview from '/src/components/invoice/InvoiceMatchPreview.jsx'
const items=[1,2].map(n=>({invoice_id:`i${n}`,invoice_number:`2026090000000000000${n}`,bill_type:'channel',bill_id:`b${n}`,bill_number:`QD-00${n}`,allocated_gross_amount:106,match_score:.95,match_reasons:['往来单位精确匹配','金额一致（±0.02元）','次月开票']}))
createRoot(document.getElementById('fixture')).render(<InvoiceMatchPreview preview={{items,ambiguous:2,unmatched:3,skipped:1,invoices:items.map(x=>({id:x.invoice_id,buyerName:'测试渠道公司',issueDate:'2026-09-10',amountWithTax:106}))}} onClose={()=>{}} />)
