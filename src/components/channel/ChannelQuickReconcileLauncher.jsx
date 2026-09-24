import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppState } from '@/app/AppStateContext.jsx'
import { getChannelBillNumber } from '@/utils/channelBillNumber.js'
import { quickReconcileEligible } from '@/domain/channel/channelQuickReconcile.js'
import ChannelQuickReconcileDrawer from './ChannelQuickReconcileDrawer.jsx'

function visibleBillNumbers() {
  return new Set(
    [...document.querySelectorAll('.core-channel-recon-page .core-recon-table tbody .core-recon-number')]
      .map((node) => String(node.textContent || '').trim())
      .filter(Boolean)
  )
}

function filterLabelFromPage() {
  const month = document.querySelector('.core-channel-recon-page select[aria-label="筛选明细结算月份"]')?.selectedOptions?.[0]?.textContent?.trim()
  const activeQuick = document.querySelector('.core-channel-recon-page .bill-quick-filters__items button.is-active span')?.textContent?.trim()
  const pieces = [month && month !== '全部月份' ? month : '', activeQuick && activeQuick !== '全部' ? activeQuick : ''].filter(Boolean)
  return pieces.length ? pieces.join(' · ') : '当前筛选'
}

export default function ChannelQuickReconcileLauncher() {
  const {
    recon,
    showToast,
    openChannelReconciliationEdit,
    openBill360
  } = useAppState()
  const [portalTarget, setPortalTarget] = useState(null)
  const [domVersion, setDomVersion] = useState(0)
  const [open, setOpen] = useState(false)
  const [sessionRows, setSessionRows] = useState([])
  const [sessionLabel, setSessionLabel] = useState('当前筛选')

  useEffect(() => {
    let frame = 0
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        setPortalTarget(document.querySelector('.core-channel-recon-page .core-recon-actions'))
        setDomVersion((value) => value + 1)
      })
    }
    sync()
    const observer = new MutationObserver(sync)
    const root = document.querySelector('.app-workspace') || document.body
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  const visiblePendingRows = useMemo(() => {
    void domVersion
    const visible = visibleBillNumbers()
    if (!visible.size) return []
    return (recon.channelRecords || []).filter((record) =>
      quickReconcileEligible(record) && visible.has(getChannelBillNumber(record))
    )
  }, [domVersion, recon.channelRecords])

  const start = () => {
    const visible = visibleBillNumbers()
    const pending = (recon.channelRecords || []).filter((record) =>
      quickReconcileEligible(record) && visible.has(getChannelBillNumber(record))
    )
    if (!pending.length) {
      showToast?.('当前筛选结果里没有待核对渠道账单', 'info')
      return
    }
    setSessionRows(pending)
    setSessionLabel(filterLabelFromPage())
    setOpen(true)
  }

  return (
    <>
      {portalTarget ? createPortal(
        <button
          type="button"
          className="channel-quick-reconcile-launch"
          onClick={start}
          title="按当前渠道账单筛选结果连续核对"
        >
          ⚡ 快速对账{visiblePendingRows.length ? ` · ${visiblePendingRows.length}` : ''}
        </button>,
        portalTarget
      ) : null}

      <ChannelQuickReconcileDrawer
        open={open}
        rows={sessionRows}
        filterLabel={sessionLabel}
        onClose={() => setOpen(false)}
        onRefresh={recon.refetchChannelFromApi}
        showToast={showToast}
        onEdit={(record) => openChannelReconciliationEdit(String(record.id))}
        onOpenBill360={(record) => openBill360('channel', String(record.id), record)}
      />
    </>
  )
}
