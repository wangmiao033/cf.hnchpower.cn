import React, { useEffect } from 'react'
import CoreChannelReconciliationGroupedPage from './CoreChannelReconciliationGroupedPage.jsx'
import './ChannelMasterDetailLedger.css'
import './ChannelMasterDetailSorting.css'

const SORTABLE_HEADERS = [
  { index: 2, key: 'period', label: '最近账期', defaultDir: 'desc' },
  { index: 3, key: 'settlement', label: '渠道应收', defaultDir: 'desc' },
  { index: 4, key: 'received', label: '已收', defaultDir: 'desc' },
  { index: 5, key: 'unpaid', label: '未收', defaultDir: 'desc' },
  { index: 6, key: 'pending', label: '待处理', defaultDir: 'desc' }
]

function parseMoneyText(value) {
  const parsed = Number(String(value || '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function parsePeriodValue(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/(20\d{2})\D*(\d{1,2})/)
  if (!match) return 0
  return Number(match[1]) * 100 + Number(match[2])
}

function pendingCount(card) {
  const badge = card.querySelector('.channel-group-summary .core-channel-status-badge')
  if (!badge) return 0
  const raw = String(badge.dataset.originalLabel || badge.textContent || '').trim()
  if (raw === '已结清' || raw === '已归档' || raw === '已作废') return 0
  const match = raw.match(/(\d+)\s*张?/)
  return match ? Number(match[1]) : 1
}

function cardSortValue(card, key) {
  if (key === 'period') {
    const period = card.querySelector('.channel-group-period')
    return parsePeriodValue(period?.dataset.fullPeriod || period?.textContent)
  }

  if (key === 'pending') return pendingCount(card)

  const moneyCells = card.querySelectorAll('.channel-group-summary .channel-group-money')
  const index = key === 'settlement' ? 0 : key === 'received' ? 1 : 2
  return parseMoneyText(moneyCells[index]?.textContent)
}

function applyOverviewSort(ledger) {
  if (!ledger) return
  if (!ledger.dataset.sortKey) ledger.dataset.sortKey = 'unpaid'
  if (!ledger.dataset.sortDir) ledger.dataset.sortDir = 'desc'

  const key = ledger.dataset.sortKey
  const dir = ledger.dataset.sortDir === 'asc' ? 1 : -1
  const cards = [...ledger.querySelectorAll(':scope > .channel-group-card')]
  const sorted = [...cards].sort((left, right) => {
    const leftValue = cardSortValue(left, key)
    const rightValue = cardSortValue(right, key)
    if (leftValue !== rightValue) return (leftValue - rightValue) * dir

    const leftUnpaid = cardSortValue(left, 'unpaid')
    const rightUnpaid = cardSortValue(right, 'unpaid')
    if (leftUnpaid !== rightUnpaid) return rightUnpaid - leftUnpaid

    const leftName = left.querySelector('.channel-group-identity strong')?.textContent?.trim() || ''
    const rightName = right.querySelector('.channel-group-identity strong')?.textContent?.trim() || ''
    return leftName.localeCompare(rightName, 'zh-CN')
  })

  sorted.forEach((card, index) => {
    card.style.order = String(index + 1)
  })

  const head = ledger.querySelector('.channel-group-summary-head')
  if (head) head.style.order = '0'

  const headers = head?.querySelectorAll(':scope > span') || []
  SORTABLE_HEADERS.forEach((config) => {
    const header = headers[config.index]
    if (!header) return
    const active = config.key === key
    header.dataset.sortActive = active ? 'true' : 'false'
    header.dataset.sortDirection = active ? ledger.dataset.sortDir : ''
    header.setAttribute('aria-label', `${config.label}，${active ? (ledger.dataset.sortDir === 'desc' ? '当前降序' : '当前升序') : '点击排序'}`)
  })
}

function setupSortableHeaders(ledger) {
  const head = ledger?.querySelector('.channel-group-summary-head')
  if (!head) return
  const headers = head.querySelectorAll(':scope > span')

  SORTABLE_HEADERS.forEach((config) => {
    const header = headers[config.index]
    if (!header) return
    if (header.textContent !== config.label) header.textContent = config.label
    header.classList.add('channel-sort-head')
    header.dataset.sortKey = config.key
    header.dataset.defaultDir = config.defaultDir
    header.setAttribute('role', 'button')
    header.setAttribute('tabindex', '0')
  })
}

function rowIsPending(row) {
  const badge = row.querySelector('.core-channel-status-badge')
  if (!badge) return false
  if (badge.classList.contains('is-anomaly')) return true
  if (badge.classList.contains('is-unpaid')) return true
  if (badge.classList.contains('is-partial')) return true
  return false
}

function applyPendingDetailFilter(card) {
  const details = card.querySelector('.channel-group-details')
  if (!details) return

  const rows = [...details.querySelectorAll('.channel-group-detail-table tbody tr')]
  const pendingOnly = card.dataset.pendingOnly === 'true'
  let pending = 0

  rows.forEach((row) => {
    const isPending = rowIsPending(row)
    row.dataset.pending = isPending ? 'true' : 'false'
    if (isPending) pending += 1
    row.hidden = pendingOnly && !isPending
  })

  let note = details.querySelector(':scope > .channel-pending-filter-note')
  if (!pendingOnly) {
    note?.remove()
    return
  }

  if (!note) {
    note = document.createElement('div')
    note.className = 'channel-pending-filter-note'
    note.innerHTML = '<span></span><button type="button" class="channel-pending-show-all">显示全部账单</button>'
    details.prepend(note)
  }

  const label = note.querySelector('span')
  if (label) label.textContent = `仅显示待处理账单 ${pending} / ${rows.length}`
}

function normalizeMasterDetailLedger(root) {
  const ledger = root?.querySelector('.channel-group-ledger')
  if (!ledger) return

  setupSortableHeaders(ledger)

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
      if (!completed) {
        badge.title = `${raw || '存在待处理账单'}；点击只查看该渠道待处理账单`
        badge.setAttribute('role', 'button')
        badge.setAttribute('tabindex', '0')
      } else {
        badge.removeAttribute('role')
        badge.removeAttribute('tabindex')
      }
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

    applyPendingDetailFilter(card)
  })

  applyOverviewSort(ledger)
}

function setSortFromHeader(ledger, header) {
  const key = header.dataset.sortKey
  if (!key) return

  if (ledger.dataset.sortKey === key) {
    ledger.dataset.sortDir = ledger.dataset.sortDir === 'desc' ? 'asc' : 'desc'
  } else {
    ledger.dataset.sortKey = key
    ledger.dataset.sortDir = header.dataset.defaultDir || 'desc'
  }

  applyOverviewSort(ledger)
}

function CoreChannelReconciliationMasterDetailPage() {
  useEffect(() => {
    const root = document.querySelector('.core-channel-recon-page')
    const ledger = root?.querySelector('.channel-group-ledger')
    if (!root || !ledger) return undefined

    normalizeMasterDetailLedger(root)

    const onLedgerClickCapture = (event) => {
      const showAll = event.target.closest('.channel-pending-show-all')
      if (showAll && ledger.contains(showAll)) {
        event.preventDefault()
        event.stopPropagation()
        const card = showAll.closest('.channel-group-card')
        if (card) {
          card.dataset.pendingOnly = 'false'
          applyPendingDetailFilter(card)
        }
        return
      }

      const sortHeader = event.target.closest('.channel-sort-head')
      if (sortHeader && ledger.contains(sortHeader)) {
        event.preventDefault()
        event.stopPropagation()
        setSortFromHeader(ledger, sortHeader)
        return
      }

      const pendingBadge = event.target.closest('.core-channel-status-badge.is-master-pending')
      if (pendingBadge && ledger.contains(pendingBadge)) {
        event.preventDefault()
        event.stopPropagation()
        const card = pendingBadge.closest('.channel-group-card')
        const toggle = card?.querySelector('.channel-group-toggle')
        if (!card || !toggle) return

        card.dataset.pendingOnly = 'true'
        card.dataset.pendingIntent = 'true'
        if (!card.classList.contains('is-expanded')) toggle.click()
        else applyPendingDetailFilter(card)
        return
      }

      const toggle = event.target.closest('.channel-group-toggle')
      if (!toggle || !ledger.contains(toggle)) return

      const card = toggle.closest('.channel-group-card')
      if (!card) return
      const isAlreadyOpen = card.classList.contains('is-expanded')
      const pendingIntent = card.dataset.pendingIntent === 'true'
      delete card.dataset.pendingIntent

      if (!isAlreadyOpen) {
        if (!pendingIntent) card.dataset.pendingOnly = 'false'
        ledger.querySelectorAll('.channel-group-card.is-expanded').forEach((openCard) => {
          if (openCard === card) return
          openCard.querySelector('.channel-group-toggle')?.click()
        })
      } else {
        card.dataset.pendingOnly = 'false'
      }

      window.setTimeout(() => normalizeMasterDetailLedger(root), 0)
    }

    const onLedgerKeyDown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return

      const sortHeader = event.target.closest('.channel-sort-head')
      if (sortHeader && ledger.contains(sortHeader)) {
        event.preventDefault()
        setSortFromHeader(ledger, sortHeader)
        return
      }

      const pendingBadge = event.target.closest('.core-channel-status-badge.is-master-pending')
      if (pendingBadge && ledger.contains(pendingBadge)) {
        event.preventDefault()
        pendingBadge.click()
      }
    }

    ledger.addEventListener('click', onLedgerClickCapture, true)
    ledger.addEventListener('keydown', onLedgerKeyDown)
    const observer = new MutationObserver(() => normalizeMasterDetailLedger(root))
    observer.observe(ledger, { childList: true, subtree: true, characterData: true })

    return () => {
      ledger.removeEventListener('click', onLedgerClickCapture, true)
      ledger.removeEventListener('keydown', onLedgerKeyDown)
      observer.disconnect()
    }
  }, [])

  return <CoreChannelReconciliationGroupedPage />
}

export default CoreChannelReconciliationMasterDetailPage
