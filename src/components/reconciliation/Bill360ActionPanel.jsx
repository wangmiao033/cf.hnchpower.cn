import React, { useEffect, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import BillInvoiceAllocationPanel from '@/components/invoice/BillInvoiceAllocationPanel.jsx'
import BillScanAttachments from '@/components/billing/BillScanAttachments.jsx'
import './Bill360ActionPanel.css'

export default function Bill360ActionPanel({ billType, billId, billNumber = '' }) {
  const { recon, showToast } = useAppState()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('invoice')

  useEffect(() => {
    setOpen(false)
    setTab('invoice')
  }, [billType, billId])

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleInvoiceChanged = async () => {
    if (billType === 'channel') await recon?.refetchChannelFromApi?.()
    else await recon?.refetchFromApi?.()
  }

  return (
    <>
      <button type="button" className="bill360-action-launcher" onClick={() => setOpen(true)}>
        <span aria-hidden>处</span>
        <span><strong>账单处理</strong><small>发票智能匹配 · 附件上传管理</small></span>
        <em aria-hidden>›</em>
      </button>

      {open ? (
        <div className="bill360-action-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false)
        }}>
          <aside className="bill360-action-panel" role="dialog" aria-modal="true" aria-label="账单处理中心">
            <header>
              <div>
                <span>账单 360° · ACTION CENTER</span>
                <h2>账单处理中心</h2>
                <p>{billNumber || billId} · 写操作继续复用现有发票与附件服务，不创建第二套财务事实。</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭账单处理">×</button>
            </header>
            <nav>
              <button type="button" className={tab === 'invoice' ? 'is-active' : ''} onClick={() => setTab('invoice')}>发票智能处理</button>
              <button type="button" className={tab === 'attachment' ? 'is-active' : ''} onClick={() => setTab('attachment')}>附件管理</button>
            </nav>
            <main>
              {tab === 'invoice' ? (
                <BillInvoiceAllocationPanel
                  billType={billType}
                  billId={billId}
                  showToast={showToast}
                  onChanged={() => void handleInvoiceChanged()}
                />
              ) : (
                <BillScanAttachments billType={billType} billId={billId} />
              )}
            </main>
          </aside>
        </div>
      ) : null}
    </>
  )
}
