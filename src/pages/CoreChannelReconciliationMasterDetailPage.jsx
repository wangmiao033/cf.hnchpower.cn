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
      const source = String(period.dataset.fullPeriod || period.textContent || '').trim()
      if (!period.dataset.fullPeriod && source) period.dataset.fullPeriod = source
      const parts = source.split('–')
      const latest = parts.length > 1 ? parts[parts.length - 1].trim() : source
      if (latest && period.textContent !== latest) period.textContent = latest
      period.dataset.detailLabel = '最近账期'
    }

    const count = card.querySelector('.channel-group-count')
    if (count) count.dataset.detailLabel = '账单'

    const moneyCells = card.querySelectorAll('.channel-group-summary .channel-group-money')
    const moneyLabels = ['渠道应收', '已收', '未收']
    moneyCells.forEach((node, index) => {
      if (moneyLabels[index]) node.dataset.detailLabel = moneyLabels[index]
    })

    const badge = card.querySelector('.channel-group-summary .core-channel-status-badge')
    if (badge) {
      const raw = String(badge.dataset.originalLabel || badge.textContent || '').trim()
      if (!badge.dataset.originalLabel) badge.dataset.originalLabel = raw
      const completed = raw === '已结清' || raw === '已归档' || raw === '已作废'
      const countMatch = raw.match(/(\d+)\s*张?/)
      const next = completed ? raw : `待处理${countMatch ? ` ${countMatch[1]}` : ''}`
      if (badge.textContent !== next) badge.textContent = next
      badge.classList.toggle('is-master-pending', !completed)
      if (!completed && raw && badge.title !== raw) badge.title = raw
    }

    const toggle = card.querySelector('.channel-group-toggle')
    if (toggle && !toggle.querySelector('.channel-master-inline-back')) {
      const back = document.createElement('span')
      back.className = 'channel-master-inline-back'
      back.textContent = '返回总览'
      back.setAttribute('aria-hidden', 'true')
      toggle.append(back)
    }

    const details = card.querySelector('.channel-group-details')
    if (!details) return

    const channelName = card.querySelector('.channel-group-identity strong')?.textContent?.trim() || '当前渠道'
    if (details.dataset.channel !== channelName) details.dataset.channel = channelName

    const detailHeaders = details.querySelectorAll('.channel-group-detail-table thead th')
    if (detailHeaders[7] && detailHeaders[7].textContent !== '核对状态') {
      detailHeaders[7].textContent = '核对状态'
    }

    details.querySelectorAll('.channel-group-detail-table tbody tr').forEach((row) => {
      const checkBadge = row.querySelector('.core-channel-status-badge')
      if (!checkBadge) return

      const isAnomaly = checkBadge.classList.contains('is-anomaly')
      const isVoid = checkBadge.classList.contains('is-void')
      const next = isVoid ? '已作废' : isAnomaly ? '数据差异' : '正常'
      if (checkBadge.textContent !== next) checkBadge.textContent = next
      checkBadge.classList.toggle('is-check-normal', !isAnomaly && !isVoid)
      if (isAnomaly) checkBadge.title = '账单数据存在差异，请核对结算依据'
    })
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
