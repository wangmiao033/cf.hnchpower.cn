import React, { useEffect } from 'react'
import CoreChannelReconciliationGroupedPage from './CoreChannelReconciliationGroupedPage.jsx'
import './ChannelMasterDetailLedger.css'

function normalizeMasterDetailLedger(root) {
  const ledger = root?.querySelector('.channel-group-ledger')
  if (!ledger) return

  const head = ledger.querySelector('.channel-group-summary-head')
  if (head) {
    const cells = head.querySelectorAll(':scope > span')
    if (cells[2] && cells[2].textContent !== '最近账期') cells[2].textContent = '最近账期'
    if (cells[6] && cells[6].textContent !== '待处理') cells[6].textContent = '待处理'
  }

  ledger.querySelectorAll('.channel-group-card').forEach((card) => {
    const period = card.querySelector('.channel-group-period')
    if (period) {
      const raw = String(period.textContent || '').trim()
      const parts = raw.split('–')
      const latest = parts.length > 1 ? parts[parts.length - 1].trim() : raw
      if (latest && period.textContent !== latest) period.textContent = latest
    }

    const badge = card.querySelector('.channel-group-summary .core-channel-status-badge')
    if (badge) {
      const raw = String(badge.textContent || '').trim()
      const completed = raw === '已结清' || raw === '已归档' || raw === '已作废'
      const next = completed ? raw : '待处理'
      if (badge.textContent !== next) badge.textContent = next
      badge.classList.toggle('is-master-pending', !completed)
    }

    const details = card.querySelector('.channel-group-details')
    if (details) {
      const channelName = card.querySelector('.channel-group-identity strong')?.textContent?.trim() || '当前渠道'
      if (details.dataset.channel !== channelName) details.dataset.channel = channelName
    }
  })
}

function CoreChannelReconciliationMasterDetailPage() {
  useEffect(() => {
    const root = document.querySelector('.core-channel-recon-page')
    const ledger = root?.querySelector('.channel-group-ledger')
    if (!root || !ledger) return undefined

    normalizeMasterDetailLedger(root)

    const onLedgerClickCapture = (event) => {
      const toggle = event.target.closest('.channel-group-toggle')
      if (!toggle || !ledger.contains(toggle)) return

      const card = toggle.closest('.channel-group-card')
      if (!card) return
      const isAlreadyOpen = card.classList.contains('is-expanded')

      if (!isAlreadyOpen) {
        ledger.querySelectorAll('.channel-group-card.is-expanded').forEach((openCard) => {
          if (openCard === card) return
          openCard.querySelector('.channel-group-toggle')?.click()
        })
      }

      window.setTimeout(() => normalizeMasterDetailLedger(root), 0)
    }

    ledger.addEventListener('click', onLedgerClickCapture, true)
    const observer = new MutationObserver(() => normalizeMasterDetailLedger(root))
    observer.observe(ledger, { childList: true, subtree: true, characterData: true })

    return () => {
      ledger.removeEventListener('click', onLedgerClickCapture, true)
      observer.disconnect()
    }
  }, [])

  return <CoreChannelReconciliationGroupedPage />
}

export default CoreChannelReconciliationMasterDetailPage
