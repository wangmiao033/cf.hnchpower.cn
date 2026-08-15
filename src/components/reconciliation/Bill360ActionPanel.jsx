import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import BillInvoiceAllocationPanel from '@/components/invoice/BillInvoiceAllocationPanel.jsx'
import BillScanAttachments from '@/components/billing/BillScanAttachments.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import './Bill360ActionPanel.css'

export default function Bill360ActionPanel({
  billType,
  billId,
  billNumber = '',
  open: controlledOpen,
  onOpenChange,
  initialTab = 'invoice',
  hideLauncher = false,
  onChanged
}) {
  const { recon, showToast } = useAppState()
  const { can } = useAuth()
  const [internalOpen, setInternalOpen] = useState(false)
  const [tab, setTab] = useState(initialTab)

  const canManageInvoice = can('invoices.manage')
  const canManageAttachment = can('reconciliation.manage')
  const availableTabs = useMemo(() => [
    ...(canManageInvoice ? ['invoice'] : []),
    ...(canManageAttachment ? ['attachment'] : [])
  ], [canManageAttachment, canManageInvoice])
  const open = controlledOpen === undefined ? internalOpen : controlledOpen

  const setOpen = (next) => {
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  useEffect(() => {
    setOpen(false)
    setTab(availableTabs.includes(initialTab) ? initialTab : availableTabs[0] || 'invoice')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billType, billId])

  useEffect(() => {
    if (!open) return
    setTab(availableTabs.includes(initialTab) ? initialTab : availableTabs[0] || 'invoice')
  }, [availableTabs, initialTab, open])

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
    else await recon?.refetchReconciliationFromApi?.()
    onChanged?.('invoice')
  }

  const handleAttachmentChanged = () => {
    onChanged?.('attachment')
  }

  if (!availableTabs.length) return null

  return (
    <>
      {!hideLauncher ? (
        <button type="button" className="bill360-action-launcher" onClick={() => setOpen(true)}>
          <span aria-hidden>处</span>
          <span><strong>账单处理</strong><small>发票智能匹配 · 附件上传管理</small></span>
          <em aria-hidden>›</em>
        </button>
      ) : null}

      {open ? (
        <div className="bill360-action-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false)
        }}>
          <aside className="bill360-action-panel" role="dialog" aria-modal="true" aria-label="账单处理中心">
            <header>
              <div>
                <span>账单 360° · ACTION CENTER</span>
                <h2>账单处理中心</h2>
                <p>{billNumber || billId} · 所有写操作继续复用正式发票与附件服务。</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭账单处理">×</button>
            </header>
            <nav>
              {canManageInvoice ? (
                <button type="button" className={tab === 'invoice' ? 'is-active' : ''} onClick={() => setTab('invoice')}>发票智能处理</button>
              ) : null}
              {canManageAttachment ? (
                <button type="button" className={tab === 'attachment' ? 'is-active' : ''} onClick={() => setTab('attachment')}>附件管理</button>
              ) : null}
            </nav>
            <main>
              {tab === 'invoice' && canManageInvoice ? (
                <BillInvoiceAllocationPanel
                  billType={billType}
                  billId={billId}
                  showToast={showToast}
                  onChanged={() => void handleInvoiceChanged()}
                />
              ) : tab === 'attachment' && canManageAttachment ? (
                <BillScanAttachments billType={billType} billId={billId} onChanged={handleAttachmentChanged} />
              ) : (
                <div className="bill360-action-empty">当前账号没有可执行的账单处理权限。</div>
              )}
            </main>
          </aside>
        </div>
      ) : null}
    </>
  )
}