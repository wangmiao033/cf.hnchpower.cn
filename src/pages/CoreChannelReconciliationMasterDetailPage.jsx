import React, { useEffect } from 'react'
import CoreChannelReconciliationGroupedPage from './CoreChannelReconciliationGroupedPage.jsx'
import './ChannelMasterDetailLedger.css'

function parseMoneyText(value) {
  const parsed = Number(String(value || '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function moneySummary(card) {
  const values = card.querySelectorAll('.channel-group-summary .channel-group-money')
  return {
    settlement: values[0]?.textContent?.trim() || '¥ 0.00',
    received: values[1]?.textContent?.trim() || '¥ 0.00',
    unpaid: values[2]?.textContent?.trim() || '¥ 0.00'
  }
}

function updateMetric(container, label, value) {
  const small = container?.querySelector('small')
  const strong = container?.querySelector('strong')
  if (small && small.textContent !== label) small.textContent = label
  if (strong && strong.textContent !== value) strong.textContent = value
}

function ensureDetailToolbar(card, details) {
  const channelName = card.querySelector('.channel-group-identity strong')?.textContent?.trim() || '当前渠道'
  const partnerName = card.querySelector('.channel-group-identity small')?.textContent?.trim() || ''
  const count = card.querySelector('.channel-group-count strong')?.textContent?.trim() || '0'
  const summary = moneySummary(card)

  let toolbar = details.querySelector(':scope > .channel-master-detail-toolbar')
  if (!toolbar) {
    toolbar = document.createElement('div')
    toolbar.className = 'channel-master-detail-toolbar'
    toolbar.innerHTML = `
      <button type="button" class="channel-master-detail-back" aria-label="返回渠道总览">← 返回渠道总览</button>
      <div class="channel-master-detail-heading">
        <strong></strong>
        <span></span>
      </div>
      <div class="channel-master-detail-metrics" aria-label="当前渠道账单汇总">
        <span data-kind="settlement"><small></small><strong></strong></span>
        <span data-kind="received"><small></small><strong></strong></span>
        <span data-kind="unpaid"><small></small><strong></strong></span>
      </div>
    `
    details.prepend(toolbar)
  }

  const heading = toolbar.querySelector('.channel-master-detail-heading strong')
  const subheading = toolbar.querySelector('.channel-master-detail-heading span')
  if (heading && heading.textContent !== channelName) heading.textContent = channelName
  const subheadingText = `${partnerName ? `${partnerName} · ` : ''}${count} 张账单`
  if (subheading && subheading.textContent !== subheadingText) subheading.textContent = subheadingText

  const settlement = toolbar.querySelector('[data-kind="settlement"]')
  const received = toolbar.querySelector('[data-kind="received"]')
  const unpaid = toolbar.querySelector('[data-kind="unpaid"]')
  updateMetric(settlement, '渠道应收', summary.settlement)
  updateMetric(received, '已收', summary.received)
  updateMetric(unpaid, '未收', summary.unpaid)
  unpaid?.classList.toggle('is-zero', Math.abs(parseMoneyText(summary.unpaid)) <= 0.01)
}

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

    card.querySelectorAll('.channel-group-money').forEach((node) => {
      node.classList.toggle('is-zero', Math.abs(parseMoneyText(node.textContent)) <= 0.01)
    })

    const badge = card.querySelector('.channel-group-summary .core-channel-status-badge')
    if (badge) {
      const raw = String(badge.dataset.originalLabel || badge.textContent || '').trim()
      if (!badge.dataset.originalLabel) badge.dataset.originalLabel = raw
      const completed = raw === '已结清' || raw === '已归档' || raw === '已作废'
      const next = completed ? raw : '待处理'
      if (badge.textContent !== next) badge.textContent = next
      badge.classList.toggle('is-master-pending', !completed)
      if (!completed && raw && badge.title !== raw) badge.title = raw
    }

    const details = card.querySelector('.channel-group-details')
    if (details) ensureDetailToolbar(card, details)
  })

  ledger.querySelectorAll('.channel-group-detail-table .core-recon-money').forEach((node) => {
    node.classList.toggle('is-zero', Math.abs(parseMoneyText(node.textContent)) <= 0.01)
  })
}

function CoreChannelReconciliationMasterDetailPage() {
  useEffect(() => {
    const root = document.querySelector('.core-channel-recon-page')
    const ledger = root?.querySelector('.channel-group-ledger')
    if (!root || !ledger) return undefined

    normalizeMasterDetailLedger(root)

    const onLedgerClickCapture = (event) => {
      const back = event.target.closest('.channel-master-detail-back')
      if (back && ledger.contains(back)) {
        event.preventDefault()
        event.stopPropagation()
        const card = back.closest('.channel-group-card')
        card?.querySelector('.channel-group-toggle')?.click()
        return
      }

      const toggle = event.target.closest('.channel-group-toggle')
      if (!toggle || !ledger.contains(toggle)) return

      const card = toggle.closest('.channel-group-card')
      if (!card) return
      const isAlreadyOpen = card.classList.contains('is-expanded')

      if (!isAlreadyOpen) {
        ledger.dataset.overviewScroll = String(ledger.scrollTop || 0)
        ledger.querySelectorAll('.channel-group-card.is-expanded').forEach((openCard) => {
          if (openCard === card) return
          openCard.querySelector('.channel-group-toggle')?.click()
        })
        window.setTimeout(() => {
          ledger.scrollTop = 0
          normalizeMasterDetailLedger(root)
        }, 0)
      } else {
        const previous = Number(ledger.dataset.overviewScroll || 0)
        window.setTimeout(() => {
          ledger.scrollTop = Number.isFinite(previous) ? previous : 0
          normalizeMasterDetailLedger(root)
        }, 0)
      }
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
