import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import PageContainer from '@/components/layout/PageContainer.jsx'
import BankCenterImportModal from '@/components/bank/BankCenterImportModal.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import {
  confirmBankAutoReconciliation,
  getBankAutoReconciliationDashboard,
  reverseBankAutoReconciliation
} from '@/lib/api/bankAutoReconciliation.ts'
import {
  getBankAccountSummaries,
  getBankImportBatches,
  getBankTransactions
} from '@/lib/api/bankTransaction.ts'
import './BankAutoReconciliationPage.css'
import './BankCenterPage.css'
import './BankCenterV2.css'

const TABS = [
  { key: 'pending', label: '待处理' },
  { key: 'ledger', label: '全部流水' },
  { key: 'history', label: '已核销' },
  { key: 'imports', label: '导入记录' }
]

const PAGE_SIZES = [20, 50, 100]

function money(value, empty = '¥0.00') {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return empty
  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

function monthText(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const normalized = raw.match(/(20\d{2})\D{0,4}(\d{1,2})/)
  if (normalized) return `${normalized[1]}年${Number(normalized[2])}月`
  return raw
}

function historyBillMeta(match, recon) {
  const rows = match?.bill_type === 'rd' ? recon?.records : recon?.channelRecords
  const bill = (rows || []).find((row) => String(row?.id || '') === String(match?.bill_id || ''))
  const partner = String(
    match?.partner_name ||
    bill?.partnerName ||
    bill?.partner_name ||
    bill?.channelName ||
    bill?.channel_name ||
    ''
  ).trim()
  const settlementMonth = match?.settlement_month || bill?.settlementMonth || bill?.settlement_month || ''
  return {
    partnerName: partner || '-',
    settlementMonth: monthText(settlementMonth)
  }
}

function isoDate(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function monthRange(offset = 0) {
  const now = new Date()
  return {
    from: isoDate(new Date(now.getFullYear(), now.getMonth() + offset, 1)),
    to: isoDate(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0))
  }
}

function quickRange(mode) {
  const now = new Date()
  if (mode === '7d') {
    const start = new Date(now)
    start.setDate(now.getDate() - 6)
    return { from: isoDate(start), to: isoDate(now) }
  }
  if (mode === 'this-month') return monthRange(0)
  if (mode === 'last-month') return monthRange(-1)
  return { from: '', to: '' }
}

function confidenceLabel(value) {
  return { high: '高', medium: '中', low: '低', none: '未匹配', manual: '人工' }[value] || value || '-'
}

function candidateKey(candidate) {
  return `${candidate?.bill_type || ''}:${candidate?.bill_id || ''}`
}

function billTypeLabel(value) {
  return value === 'rd' ? '研发账单' : '渠道账单'
}

function directionOf(row) {
  const income = Number(row?.income_amount || 0)
  const expense = Number(row?.expense_amount || 0)
  if (income > 0) return 'income'
  if (expense > 0) return 'expense'
  return 'unknown'
}

function counterpartyOf(row) {
  const direction = directionOf(row)
  if (direction === 'income') return row?.payer_name || row?.payee_name || '-'
  if (direction === 'expense') return row?.payee_name || row?.payer_name || '-'
  return row?.payee_name || row?.payer_name || '-'
}

function linkedOf(row) {
  return Boolean(
    row?.reconciliation_id != null && String(row.reconciliation_id).trim() !== '' ||
    row?.reconciliation_no != null && String(row.reconciliation_no).trim() !== ''
  )
}

function linkedNo(row) {
  return String(row?.reconciliation_no || row?.reconciliation_id || '').trim()
}

function accountTail(value) {
  const text = String(value || '').replace(/\s/g, '')
  return text.length > 6 ? `尾号 ${text.slice(-6)}` : text || '账号未识别'
}

function MetricCard({ icon, label, count, amount, tone = 'neutral', active = false, onClick, hint }) {
  return (
    <button type="button" className={`bank-v2-metric is-${tone} ${active ? 'is-active' : ''}`} onClick={onClick}>
      <i>{icon}</i>
      <div>
        <span>{label}</span>
        <strong>{count} <small>笔</small></strong>
        <em>{money(amount)}</em>
        {hint ? <small className="bank-v2-metric__hint">{hint}</small> : null}
      </div>
      <b aria-hidden>›</b>
    </button>
  )
}

function Pagination({ total, page, pageSize, onPage, onPageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pages)
  const start = total ? (safePage - 1) * pageSize + 1 : 0
  const end = Math.min(total, safePage * pageSize)
  return (
    <footer className="bank-v2-pagination">
      <span>共 <strong>{total}</strong> 条 · 当前 {start}-{end}</span>
      <div>
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
          {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条/页</option>)}
        </select>
        <button type="button" disabled={safePage <= 1} onClick={() => onPage(safePage - 1)}>上一页</button>
        <strong>{safePage} / {pages}</strong>
        <button type="button" disabled={safePage >= pages} onClick={() => onPage(safePage + 1)}>下一页</button>
      </div>
    </footer>
  )
}

export default function BankCenterPageV2() {
  const { recon, setActiveView, openBill360, showToast } = useAppState()
  const { can } = useAuth()
  const canManage = can('funds.manage')

  const [activeTab, setActiveTab] = useState('pending')
  const [dashboard, setDashboard] = useState(null)
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [dashboardError, setDashboardError] = useState('')
  const [dashboardRevision, setDashboardRevision] = useState(0)
  const [dataRevision, setDataRevision] = useState(0)
  const [selection, setSelection] = useState({})
  const [busyId, setBusyId] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)
  const [expandedId, setExpandedId] = useState('')
  const [historyMode, setHistoryMode] = useState('confirmed')
  const [importOpen, setImportOpen] = useState(false)

  const [queueSearch, setQueueSearch] = useState('')
  const [queueDirection, setQueueDirection] = useState('all')
  const [queueFilter, setQueueFilter] = useState('all')
  const [queueRangeMode, setQueueRangeMode] = useState('all')
  const [queueDateFrom, setQueueDateFrom] = useState(monthRange(0).from)
  const [queueDateTo, setQueueDateTo] = useState(monthRange(0).to)
  const [queuePage, setQueuePage] = useState(1)
  const [queuePageSize, setQueuePageSize] = useState(20)

  const [ledgerRows, setLedgerRows] = useState([])
  const [ledgerTotal, setLedgerTotal] = useState(0)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError, setLedgerError] = useState('')
  const [ledgerSearch, setLedgerSearch] = useState('')
  const [ledgerDirection, setLedgerDirection] = useState('all')
  const [ledgerLinked, setLedgerLinked] = useState('all')
  const [ledgerRangeMode, setLedgerRangeMode] = useState('all')
  const [ledgerDateFrom, setLedgerDateFrom] = useState(monthRange(0).from)
  const [ledgerDateTo, setLedgerDateTo] = useState(monthRange(0).to)
  const [accountFilter, setAccountFilter] = useState('')
  const [ledgerPage, setLedgerPage] = useState(1)
  const [ledgerPageSize, setLedgerPageSize] = useState(50)

  const [accounts, setAccounts] = useState([])
  const [accountsError, setAccountsError] = useState('')
  const [importBatches, setImportBatches] = useState([])
  const [importBatchTotal, setImportBatchTotal] = useState(0)
  const [importsLoading, setImportsLoading] = useState(false)
  const [importsError, setImportsError] = useState('')

  const refreshDashboard = () => setDashboardRevision((value) => value + 1)
  const refreshBankData = () => setDataRevision((value) => value + 1)

  useEffect(() => {
    let cancelled = false
    setDashboardLoading(true)
    setDashboardError('')
    getBankAutoReconciliationDashboard(500)
      .then((result) => {
        if (cancelled) return
        setDashboard(result)
        setSelection((current) => {
          const next = { ...current }
          for (const item of result.suggestions || []) {
            if (!next[item.transaction_id] && item.candidates?.[0]) next[item.transaction_id] = candidateKey(item.candidates[0])
          }
          return next
        })
      })
      .catch((error) => {
        if (!cancelled) setDashboardError(error instanceof Error ? error.message : '银行核销数据读取失败')
      })
      .finally(() => {
        if (!cancelled) setDashboardLoading(false)
      })
    return () => { cancelled = true }
  }, [dashboardRevision])

  useEffect(() => {
    let cancelled = false
    getBankAccountSummaries()
      .then((result) => { if (!cancelled) setAccounts(result.items || []) })
      .catch((error) => { if (!cancelled) setAccountsError(error instanceof Error ? error.message : '银行账户读取失败') })
    return () => { cancelled = true }
  }, [dataRevision])

  const ledgerRange = useMemo(() => {
    if (ledgerRangeMode === 'custom') return { from: ledgerDateFrom, to: ledgerDateTo }
    return quickRange(ledgerRangeMode)
  }, [ledgerRangeMode, ledgerDateFrom, ledgerDateTo])

  useEffect(() => {
    if (activeTab !== 'ledger') return undefined
    let cancelled = false
    setLedgerLoading(true)
    setLedgerError('')
    getBankTransactions({
      q: ledgerSearch.trim() || undefined,
      date_from: ledgerRange.from || undefined,
      date_to: ledgerRange.to || undefined,
      bank_account: accountFilter || undefined,
      limit: 500,
      offset: 0
    })
      .then((result) => {
        if (cancelled) return
        setLedgerRows(result.items || [])
        setLedgerTotal(result.total || 0)
      })
      .catch((error) => {
        if (cancelled) return
        setLedgerError(error instanceof Error ? error.message : '流水台账读取失败')
        setLedgerRows([])
        setLedgerTotal(0)
      })
      .finally(() => { if (!cancelled) setLedgerLoading(false) })
    return () => { cancelled = true }
  }, [activeTab, dataRevision, ledgerSearch, ledgerRange.from, ledgerRange.to, accountFilter])

  useEffect(() => {
    if (activeTab !== 'imports') return undefined
    let cancelled = false
    setImportsLoading(true)
    setImportsError('')
    getBankImportBatches({ limit: 200, offset: 0 })
      .then((result) => {
        if (cancelled) return
        setImportBatches(result.items || [])
        setImportBatchTotal(result.total || 0)
      })
      .catch((error) => {
        if (!cancelled) setImportsError(error instanceof Error ? error.message : '导入记录读取失败')
      })
      .finally(() => { if (!cancelled) setImportsLoading(false) })
    return () => { cancelled = true }
  }, [activeTab, dataRevision])

  const suggestions = dashboard?.suggestions || []
  const queueRange = useMemo(() => {
    if (queueRangeMode === 'custom') return { from: queueDateFrom, to: queueDateTo }
    return quickRange(queueRangeMode)
  }, [queueRangeMode, queueDateFrom, queueDateTo])

  const queueBase = useMemo(() => {
    const term = queueSearch.trim().toLowerCase()
    return suggestions.filter((item) => {
      if (queueDirection !== 'all' && item.direction !== queueDirection) return false
      const tradeDate = String(item.trade_date || '')
      if (queueRange.from && tradeDate && tradeDate < queueRange.from) return false
      if (queueRange.to && tradeDate && tradeDate > queueRange.to) return false
      if (!term) return true
      const candidateText = (item.candidates || []).map((candidate) => [
        candidate.bill_number,
        candidate.partner_name,
        candidate.game_name,
        candidate.settlement_month
      ].filter(Boolean).join(' ')).join(' ')
      const haystack = [
        item.counterparty_name,
        item.summary,
        item.transaction_no,
        item.amount,
        candidateText
      ].filter((value) => value != null).join(' ').toLowerCase()
      return haystack.includes(term)
    })
  }, [suggestions, queueSearch, queueDirection, queueRange.from, queueRange.to])

  const queueMetrics = useMemo(() => {
    const groups = {
      all: queueBase,
      high: queueBase.filter((item) => item.confidence_level === 'high'),
      review: queueBase.filter((item) => item.confidence_level === 'medium'),
      unmatched: queueBase.filter((item) => item.confidence_level === 'low' || item.confidence_level === 'none')
    }
    const summarize = (rows) => ({
      count: rows.length,
      amount: rows.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    })
    return Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, summarize(rows)]))
  }, [queueBase])

  const filteredQueue = useMemo(() => queueBase.filter((item) => {
    if (queueFilter === 'high') return item.confidence_level === 'high'
    if (queueFilter === 'review') return item.confidence_level === 'medium'
    if (queueFilter === 'unmatched') return item.confidence_level === 'low' || item.confidence_level === 'none'
    return true
  }), [queueBase, queueFilter])

  const highReady = useMemo(() => queueBase.filter((item) => item.auto_ready && item.candidates?.[0]), [queueBase])
  const queuePageCount = Math.max(1, Math.ceil(filteredQueue.length / queuePageSize))
  const safeQueuePage = Math.min(queuePage, queuePageCount)
  const pagedQueue = filteredQueue.slice((safeQueuePage - 1) * queuePageSize, safeQueuePage * queuePageSize)
  const filteredQueueAmount = filteredQueue.reduce((sum, item) => sum + Number(item.amount || 0), 0)

  useEffect(() => {
    setQueuePage(1)
  }, [queueSearch, queueDirection, queueFilter, queueRangeMode, queueDateFrom, queueDateTo, queuePageSize])

  const visibleHistory = useMemo(
    () => (dashboard?.recent_matches || [])
      .filter((item) => item.status === historyMode)
      .map((item) => ({ ...item, ...historyBillMeta(item, recon) })),
    [dashboard?.recent_matches, historyMode, recon?.records, recon?.channelRecords]
  )
  const visibleHistoryAmount = useMemo(
    () => visibleHistory.reduce((sum, item) => sum + Number(item.linked_amount || 0), 0),
    [visibleHistory]
  )

  const filteredLedger = useMemo(() => ledgerRows.filter((row) => {
    const direction = directionOf(row)
    if (ledgerDirection !== 'all' && direction !== ledgerDirection) return false
    const linked = linkedOf(row)
    if (ledgerLinked === 'linked' && !linked) return false
    if (ledgerLinked === 'unlinked' && linked) return false
    return true
  }), [ledgerRows, ledgerDirection, ledgerLinked])

  const ledgerPageCount = Math.max(1, Math.ceil(filteredLedger.length / ledgerPageSize))
  const safeLedgerPage = Math.min(ledgerPage, ledgerPageCount)
  const pagedLedger = filteredLedger.slice((safeLedgerPage - 1) * ledgerPageSize, safeLedgerPage * ledgerPageSize)

  useEffect(() => {
    setLedgerPage(1)
  }, [ledgerSearch, ledgerDirection, ledgerLinked, ledgerRangeMode, ledgerDateFrom, ledgerDateTo, accountFilter, ledgerPageSize])

  const confirmOne = async (item, candidate) => {
    if (!canManage || !candidate) return
    if (!window.confirm(`确认将 ${item.direction_label} ${money(item.amount)} 核销到 ${candidate.bill_number}？\n\n${candidate.partner_name || ''} · 未结 ${money(candidate.outstanding_amount)}`)) return
    setBusyId(item.transaction_id)
    try {
      await confirmBankAutoReconciliation(item.transaction_id, candidate.bill_type, candidate.bill_id)
      showToast?.(`已核销到 ${candidate.bill_number}`, 'success')
      refreshDashboard()
      refreshBankData()
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : '核销失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  const confirmSelected = (item) => {
    const key = selection[item.transaction_id] || candidateKey(item.candidates?.[0])
    const candidate = (item.candidates || []).find((row) => candidateKey(row) === key) || item.candidates?.[0]
    return confirmOne(item, candidate)
  }

  const bulkConfirmHigh = async () => {
    if (!canManage || !highReady.length) return
    const amount = highReady.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    if (!window.confirm(`将核销当前筛选范围内 ${highReady.length} 笔高置信流水，共 ${money(amount)}。\n\n只处理无明显歧义的高置信推荐，是否继续？`)) return
    setBatchBusy(true)
    let success = 0
    let failed = 0
    for (const item of highReady) {
      const candidate = item.candidates?.[0]
      if (!candidate) continue
      try {
        await confirmBankAutoReconciliation(item.transaction_id, candidate.bill_type, candidate.bill_id)
        success += 1
      } catch {
        failed += 1
      }
    }
    setBatchBusy(false)
    showToast?.(failed ? `批量核销完成：成功 ${success} 笔，失败 ${failed} 笔` : `已核销 ${success} 笔高置信流水`, failed ? 'info' : 'success')
    refreshDashboard()
    refreshBankData()
  }

  const reverseMatch = async (match) => {
    if (!canManage) return
    const reason = window.prompt(`撤销 ${match.bill_number || '该账单'} 的银行核销，请填写原因：`, '') || ''
    if (!reason.trim()) return
    if (!window.confirm(`确定撤销 ${money(match.linked_amount)} 的核销吗？账单收付款状态会同步恢复。`)) return
    setBusyId(match.match_id)
    try {
      await reverseBankAutoReconciliation(match.match_id, reason.trim())
      showToast?.('核销已撤销，原流水已恢复为待处理', 'success')
      refreshDashboard()
      refreshBankData()
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : '撤销核销失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  const resetQueueFilters = () => {
    const current = monthRange(0)
    setQueueSearch('')
    setQueueDirection('all')
    setQueueFilter('all')
    setQueueRangeMode('all')
    setQueueDateFrom(current.from)
    setQueueDateTo(current.to)
  }

  const resetLedgerFilters = () => {
    const current = monthRange(0)
    setLedgerSearch('')
    setLedgerDirection('all')
    setLedgerLinked('all')
    setLedgerRangeMode('all')
    setLedgerDateFrom(current.from)
    setLedgerDateTo(current.to)
    setAccountFilter('')
  }

  const openBatchLedger = (batch) => {
    setLedgerSearch('')
    setLedgerRangeMode('custom')
    setLedgerDateFrom(batch.date_from || '')
    setLedgerDateTo(batch.date_to || '')
    setAccountFilter(batch.bank_account || '')
    setLedgerDirection('all')
    setLedgerLinked('all')
    setActiveTab('ledger')
  }

  const handleImported = () => {
    refreshDashboard()
    refreshBankData()
  }

  const primaryAccount = accounts.length === 1 ? accounts[0] : null
  const activeQueueRangeText = queueRange.from || queueRange.to
    ? `${queueRange.from || '最早'} ～ ${queueRange.to || '今天'}`
    : '全部日期'

  return (
    <PageContainer hideHeader className="bank-center-page bank-center-v2">
      <section className="bank-v2-head">
        <div>
          <span className="bank-v2-eyebrow">BANK RECONCILIATION CENTER</span>
          <h1>银行中心</h1>
          <p>围绕“原始流水 → 自动匹配 → 人工复核 → 多对多核销 → 账单资金闭环”处理日常银行业务。</p>
          {primaryAccount ? (
            <div className="bank-v2-account-note">
              <b>{primaryAccount.source_bank || 'BANK'}</b>
              <span>{accountTail(primaryAccount.bank_account)}</span>
              <span>{primaryAccount.transaction_count} 笔流水</span>
              <span>最近交易 {primaryAccount.latest_trade_date || '-'}</span>
              <strong>{money(primaryAccount.latest_balance, '余额未知')}</strong>
            </div>
          ) : null}
        </div>
        <div className="bank-center-head__actions">
          <button type="button" onClick={refreshDashboard} disabled={dashboardLoading}>{dashboardLoading ? '匹配中…' : '重新匹配'}</button>
          {canManage ? <button type="button" className="is-primary" onClick={() => setImportOpen(true)}>＋ 导入银行流水</button> : null}
        </div>
      </section>

      <nav className="bank-center-tabs bank-v2-tabs" aria-label="银行中心">
        {TABS.map((tab) => (
          <button key={tab.key} type="button" className={activeTab === tab.key ? 'is-active' : ''} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
            {tab.key === 'pending' && suggestions.length ? <em>{suggestions.length}</em> : null}
            {tab.key === 'imports' && importBatchTotal ? <em>{importBatchTotal}</em> : null}
          </button>
        ))}
      </nav>

      {activeTab === 'pending' ? (
        <div className="bank-center-pane bank-v2-pane">
          {dashboardError && !dashboard ? <div className="bank-center-error"><strong>读取失败</strong><span>{dashboardError}</span><button type="button" onClick={refreshDashboard}>重试</button></div> : null}

          <section className="bank-v2-filterbar">
            <div className="bank-v2-filterbar__row">
              <label className="bank-v2-search">
                <span>搜索流水</span>
                <div><i>⌕</i><input value={queueSearch} onChange={(event) => setQueueSearch(event.target.value)} placeholder="对方单位 / 摘要 / 流水号 / 账单号" /></div>
              </label>
              <label className="bank-v2-date-field">
                <span>交易日期</span>
                <div>
                  <input type="date" value={queueDateFrom} onChange={(event) => { setQueueDateFrom(event.target.value); setQueueRangeMode('custom') }} />
                  <b>至</b>
                  <input type="date" value={queueDateTo} onChange={(event) => { setQueueDateTo(event.target.value); setQueueRangeMode('custom') }} />
                </div>
              </label>
              <label className="bank-v2-select-field"><span>收支方向</span><select value={queueDirection} onChange={(event) => setQueueDirection(event.target.value)}><option value="all">全部方向</option><option value="collection">收入</option><option value="payment">支出</option><option value="unknown">待判断</option></select></label>
              <label className="bank-v2-select-field"><span>匹配状态</span><select value={queueFilter} onChange={(event) => setQueueFilter(event.target.value)}><option value="all">全部状态</option><option value="high">高置信</option><option value="review">需人工确认</option><option value="unmatched">未匹配 / 低置信</option></select></label>
              <button type="button" className="bank-v2-reset" onClick={resetQueueFilters}>重置</button>
            </div>
            <div className="bank-v2-presets">
              <span>快捷日期</span>
              {[['all', '全部'], ['7d', '近7天'], ['this-month', '本月'], ['last-month', '上月']].map(([key, label]) => (
                <button key={key} type="button" className={queueRangeMode === key ? 'is-active' : ''} onClick={() => setQueueRangeMode(key)}>{label}</button>
              ))}
              <i />
              <small>当前：{activeQueueRangeText}</small>
              <em>筛选结果 {filteredQueue.length} 笔 · {money(filteredQueueAmount)}</em>
            </div>
          </section>

          <section className="bank-v2-metrics">
            <MetricCard icon="核" label="待核销" count={queueMetrics.all.count} amount={queueMetrics.all.amount} active={queueFilter === 'all'} onClick={() => setQueueFilter('all')} hint="当前搜索与日期范围" />
            <MetricCard icon="✓" label="高置信匹配" count={queueMetrics.high.count} amount={queueMetrics.high.amount} tone="high" active={queueFilter === 'high'} onClick={() => setQueueFilter('high')} hint="可优先批量核销" />
            <MetricCard icon="人" label="需人工确认" count={queueMetrics.review.count} amount={queueMetrics.review.amount} tone="review" active={queueFilter === 'review'} onClick={() => setQueueFilter('review')} hint="建议核对合同与账单" />
            <MetricCard icon="!" label="未匹配 / 低置信" count={queueMetrics.unmatched.count} amount={queueMetrics.unmatched.amount} tone="unmatched" active={queueFilter === 'unmatched'} onClick={() => setQueueFilter('unmatched')} hint="暂不自动处理" />
          </section>

          <section className="bank-center-card bank-v2-card">
            <header className="bank-v2-card-head">
              <div>
                <h2>待核销流水</h2>
                <p>优先处理高置信流水；低置信只给建议，不自动写入资金事实。</p>
              </div>
              <div className="bank-v2-card-actions">
                <span>已筛选 <strong>{filteredQueue.length}</strong> / {suggestions.length} 笔</span>
                {canManage ? <button type="button" className="is-primary" disabled={batchBusy || highReady.length === 0} onClick={bulkConfirmHigh}>{batchBusy ? '核销中…' : `批量核销高置信 (${highReady.length})`}</button> : null}
              </div>
            </header>

            <div className="bank-center-table-wrap">
              <table className="bank-center-table bank-center-table--queue bank-v2-table">
                <thead><tr><th>日期</th><th>收 / 支</th><th>对方单位</th><th>摘要</th><th className="is-right">金额</th><th>推荐账单</th><th>匹配度</th><th>操作</th></tr></thead>
                <tbody>
                  {!dashboardLoading && pagedQueue.length === 0 ? <tr><td colSpan={8} className="bank-center-empty">当前筛选下没有待处理流水。</td></tr> : null}
                  {pagedQueue.map((item) => {
                    const selectedKey = selection[item.transaction_id] || candidateKey(item.candidates?.[0])
                    const candidate = item.candidates?.find((row) => candidateKey(row) === selectedKey) || item.candidates?.[0]
                    const expanded = expandedId === item.transaction_id
                    return (
                      <React.Fragment key={item.transaction_id}>
                        <tr className={`is-confidence-${item.confidence_level}`}>
                          <td className="bank-v2-date">{item.trade_date || '-'}</td>
                          <td><span className={`bank-center-direction is-${item.direction}`}>{item.direction === 'collection' ? '收入' : item.direction === 'payment' ? '支出' : '待判定'}</span></td>
                          <td className="bank-center-strong bank-v2-counterparty">{item.counterparty_name || '-'}</td>
                          <td className="bank-center-summary" title={item.summary || ''}>{item.summary || '-'}</td>
                          <td className="is-right"><strong className={item.direction === 'collection' ? 'is-income' : item.direction === 'payment' ? 'is-expense' : ''}>{item.direction === 'payment' ? '-' : '+'}{money(item.amount)}</strong></td>
                          <td>
                            {item.candidates?.length ? (
                              <select className="bank-center-candidate-select bank-v2-candidate" value={selectedKey} onChange={(event) => setSelection((current) => ({ ...current, [item.transaction_id]: event.target.value }))}>
                                {item.candidates.map((row) => <option key={candidateKey(row)} value={candidateKey(row)}>{row.bill_number} · {row.partner_name || '未填合作方'} · {Number(row.score || 0).toFixed(0)}分</option>)}
                              </select>
                            ) : <span className="bank-center-muted">暂无候选</span>}
                          </td>
                          <td><span className={`bank-center-confidence is-${item.confidence_level}`}>{confidenceLabel(item.confidence_level)}{item.top_score ? ` ${Number(item.top_score).toFixed(0)}` : ''}</span></td>
                          <td>
                            <div className="bank-center-row-actions">
                              <button type="button" onClick={() => setExpandedId(expanded ? '' : item.transaction_id)}>{expanded ? '收起' : '详情'}</button>
                              {canManage ? <button type="button" className={item.auto_ready ? 'is-primary' : ''} disabled={!candidate || busyId === item.transaction_id} onClick={() => confirmSelected(item)}>{busyId === item.transaction_id ? '处理中…' : item.auto_ready ? '确认核销' : '人工确认'}</button> : null}
                            </div>
                          </td>
                        </tr>
                        {expanded ? (
                          <tr className="bank-center-expand-row">
                            <td colSpan={8}>
                              <div className="bank-center-expand bank-v2-expand">
                                <div><span>银行流水号</span><strong>{item.transaction_no || '-'}</strong></div>
                                <div><span>币种</span><strong>{item.currency || 'CNY'}</strong></div>
                                <div><span>匹配状态</span><strong>{confidenceLabel(item.confidence_level)}置信</strong></div>
                                <div><span>阻断原因</span><strong>{item.blocked_reason || '无'}</strong></div>
                                {candidate ? (
                                  <div className="bank-center-expand__candidate">
                                    <span>当前推荐账单</span>
                                    <button type="button" onClick={() => openBill360(candidate.bill_type, candidate.bill_id)}>{candidate.bill_number}</button>
                                    <small>{billTypeLabel(candidate.bill_type)} · {candidate.partner_name || '-'} · {candidate.settlement_month || '-'} · {candidate.game_name || '未填游戏'} · 应结 {money(candidate.bill_amount)} · 未结 {money(candidate.outstanding_amount)}</small>
                                    <div>{(candidate.reasons || []).map((reason) => <em key={reason}>✓ {reason}</em>)}</div>
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination total={filteredQueue.length} page={safeQueuePage} pageSize={queuePageSize} onPage={setQueuePage} onPageSize={setQueuePageSize} />
          </section>
        </div>
      ) : null}

      {activeTab === 'ledger' ? (
        <div className="bank-center-pane bank-v2-pane">
          <section className="bank-v2-ledger-toolbar">
            <label className="bank-v2-search"><span>搜索流水</span><div><i>⌕</i><input value={ledgerSearch} onChange={(event) => setLedgerSearch(event.target.value)} placeholder="户名 / 摘要 / 流水号 / 账单号" /></div></label>
            <label className="bank-v2-date-field"><span>交易日期</span><div><input type="date" value={ledgerDateFrom} onChange={(event) => { setLedgerDateFrom(event.target.value); setLedgerRangeMode('custom') }} /><b>至</b><input type="date" value={ledgerDateTo} onChange={(event) => { setLedgerDateTo(event.target.value); setLedgerRangeMode('custom') }} /></div></label>
            <label className="bank-v2-select-field"><span>银行账户</span><select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}><option value="">全部账户</option>{accounts.map((account) => <option key={account.bank_account} value={account.bank_account}>{account.source_bank || 'BANK'} · {accountTail(account.bank_account)}</option>)}</select></label>
            <label className="bank-v2-select-field"><span>核销状态</span><select value={ledgerLinked} onChange={(event) => setLedgerLinked(event.target.value)}><option value="all">全部状态</option><option value="unlinked">待核销</option><option value="linked">已核销</option></select></label>
            <button type="button" className="bank-v2-reset" onClick={resetLedgerFilters}>重置</button>
            <div className="bank-v2-ledger-presets">
              {[['all', '全部'], ['7d', '近7天'], ['this-month', '本月'], ['last-month', '上月']].map(([key, label]) => <button key={key} type="button" className={ledgerRangeMode === key ? 'is-active' : ''} onClick={() => setLedgerRangeMode(key)}>{label}</button>)}
              <i />
              <button type="button" className={ledgerDirection === 'income' ? 'is-active' : ''} onClick={() => setLedgerDirection(ledgerDirection === 'income' ? 'all' : 'income')}>收入</button>
              <button type="button" className={ledgerDirection === 'expense' ? 'is-active' : ''} onClick={() => setLedgerDirection(ledgerDirection === 'expense' ? 'all' : 'expense')}>支出</button>
            </div>
          </section>
          {accountsError ? <div className="bank-center-inline-error">{accountsError}</div> : null}
          {ledgerError ? <div className="bank-center-inline-error">{ledgerError}</div> : null}

          <section className="bank-center-card bank-v2-card">
            <header className="bank-v2-card-head"><div><h2>全部银行流水</h2><p>原始流水不改写；来源 Excel、行号、余额和核销状态保持可追溯。</p></div><span className="bank-v2-total">服务端命中 {ledgerTotal} 条 · 当前筛选 {filteredLedger.length} 条</span></header>
            <div className="bank-center-table-wrap">
              <table className="bank-center-table bank-center-table--ledger bank-v2-table bank-v2-ledger-table">
                <thead><tr><th>日期</th><th>方向</th><th>对方户名</th><th>摘要 / 用途</th><th>来源</th><th className="is-right">收入</th><th className="is-right">支出</th><th className="is-right">余额</th><th>核销状态</th><th>对应账单</th></tr></thead>
                <tbody>
                  {!ledgerLoading && pagedLedger.length === 0 ? <tr><td colSpan={10} className="bank-center-empty">当前条件下暂无流水。</td></tr> : null}
                  {pagedLedger.map((row) => {
                    const direction = directionOf(row)
                    const linked = linkedOf(row)
                    return (
                      <tr key={row.id}>
                        <td>{row.trade_date || '-'}</td>
                        <td><span className={`bank-center-direction is-${direction === 'income' ? 'collection' : direction === 'expense' ? 'payment' : 'unknown'}`}>{direction === 'income' ? '收入' : direction === 'expense' ? '支出' : '待判定'}</span></td>
                        <td className="bank-center-strong">{counterpartyOf(row)}</td>
                        <td className="bank-center-summary" title={[row.summary, row.purpose, row.remark].filter(Boolean).join('；')}>{row.summary || row.purpose || row.remark || '-'}</td>
                        <td className="bank-center-source-cell"><strong>{row.source_bank || (row.type === 'statement_import' ? 'BANK' : '手工')}</strong><small title={row.source_file_name || ''}>{row.source_file_name || '手工录入'}{row.source_row_no ? ` · 行 ${row.source_row_no}` : ''}</small></td>
                        <td className="is-right is-income">{Number(row.income_amount || 0) > 0 ? money(row.income_amount) : '-'}</td>
                        <td className="is-right is-expense">{Number(row.expense_amount || 0) > 0 ? money(row.expense_amount) : '-'}</td>
                        <td className="is-right">{row.balance != null ? money(row.balance, '-') : '-'}</td>
                        <td><span className={`bank-center-ledger-status ${linked ? 'is-linked' : 'is-unlinked'}`}>{linked ? '已核销' : '待核销'}</span></td>
                        <td>{linked ? <span className="bank-center-linked-no">{linkedNo(row)}</span> : <span className="bank-center-muted">-</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination total={filteredLedger.length} page={safeLedgerPage} pageSize={ledgerPageSize} onPage={setLedgerPage} onPageSize={setLedgerPageSize} />
          </section>
        </div>
      ) : null}

      {activeTab === 'history' ? (
        <div className="bank-center-pane bank-v2-pane">
          <section className="bank-center-card bank-v2-card">
            <header className="bank-v2-card-head">
              <div><h2>核销记录</h2><p>资金事实、收/付主体、账单月份和账单编号统一展示；撤销后原流水自动回到待处理。</p></div>
              <div className="bank-v2-card-actions">
                <span>{historyMode === 'confirmed' ? '有效核销' : '已撤销'} <strong>{visibleHistory.length}</strong> 笔 · {money(visibleHistoryAmount)}</span>
                <div className="bank-center-segments"><button type="button" className={historyMode === 'confirmed' ? 'is-active' : ''} onClick={() => setHistoryMode('confirmed')}>有效核销</button><button type="button" className={historyMode === 'reversed' ? 'is-active' : ''} onClick={() => setHistoryMode('reversed')}>已撤销</button></div>
              </div>
            </header>
            <div className="bank-center-table-wrap">
              <table className="bank-center-table bank-center-table--history bank-v2-table" style={{ minWidth: 1280, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 105 }} />
                  <col style={{ width: 70 }} />
                  <col style={{ width: 220 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 180 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 175 }} />
                  <col style={{ width: 95 }} />
                  <col style={{ width: 105 }} />
                </colgroup>
                <thead><tr><th>银行日期</th><th>方向</th><th>收 / 付主体</th><th>账单月份</th><th>账单编号</th><th className="is-right">金额</th><th>匹配度</th><th>操作人 / 时间</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                  {visibleHistory.length === 0 ? <tr><td colSpan={10} className="bank-center-empty">暂无记录。</td></tr> : null}
                  {visibleHistory.map((match) => {
                    const operator = match.status === 'reversed' ? (match.reversed_email || match.confirmed_email) : match.confirmed_email
                    const operatedAt = match.status === 'reversed' ? (match.reversed_at || match.confirmed_at) : match.confirmed_at
                    return (
                      <tr key={match.match_id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{match.trade_date || '-'}</td>
                        <td><span className={`bank-center-direction is-${match.direction}`}>{match.direction_label || '-'}</span></td>
                        <td className="bank-center-strong bank-v2-counterparty" title={match.partnerName}>{match.partnerName}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{match.settlementMonth}</td>
                        <td><button type="button" className="bank-center-bill-link" onClick={() => openBill360(match.bill_type, match.bill_id)}>{match.bill_number || match.bill_id}</button><small>{billTypeLabel(match.bill_type)}</small></td>
                        <td className="is-right"><strong>{money(match.linked_amount)}</strong></td>
                        <td><span className={`bank-center-confidence is-${match.confidence_level}`}>{confidenceLabel(match.confidence_level)} {Number(match.confidence_score || 0).toFixed(0)}</span></td>
                        <td><strong>{operator || '-'}</strong><small>{dateTime(operatedAt)}</small></td>
                        <td>{match.status === 'confirmed' ? <span className="bank-center-ledger-status is-linked">有效</span> : <span className="bank-center-ledger-status">已撤销</span>}{match.reverse_reason ? <small title={match.reverse_reason}>{match.reverse_reason}</small> : null}</td>
                        <td>{canManage && match.status === 'confirmed' ? <button type="button" className="bank-center-more-action" disabled={busyId === match.match_id} onClick={() => reverseMatch(match)}>{busyId === match.match_id ? '处理中…' : '撤销核销'}</button> : '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === 'imports' ? (
        <div className="bank-center-pane bank-v2-pane">
          <section className="bank-center-card bank-v2-card">
            <header className="bank-v2-card-head"><div><h2>导入记录</h2><p>每次 Excel 导入保留来源、日期范围、新增/重复/异常数量，方便审计和追溯。</p></div><button type="button" className="bank-v2-refresh" onClick={refreshBankData} disabled={importsLoading}>{importsLoading ? '刷新中…' : '刷新记录'}</button></header>
            {importsError ? <div className="bank-center-inline-error">{importsError}</div> : null}
            <div className="bank-center-table-wrap">
              <table className="bank-center-table bank-center-table--imports bank-v2-table">
                <thead><tr><th>导入时间</th><th>银行账户</th><th>来源文件</th><th>流水日期</th><th>处理结果</th><th className="is-right">收入合计</th><th className="is-right">支出合计</th><th>操作</th></tr></thead>
                <tbody>
                  {!importsLoading && importBatches.length === 0 ? <tr><td colSpan={8} className="bank-center-empty">暂无导入批次。</td></tr> : null}
                  {importBatches.map((batch) => (
                    <tr key={batch.id}>
                      <td>{dateTime(batch.created_at)}{batch.legacy_backfill ? <small className="bank-center-legacy-tag">历史汇总</small> : null}</td>
                      <td><strong>{batch.source_bank || 'BANK'}</strong><small>{accountTail(batch.bank_account)}</small></td>
                      <td className="bank-center-import-file"><strong title={batch.source_file_name || ''}>{batch.source_file_name || '-'}</strong><small>{batch.source_sheet_name ? `工作表：${batch.source_sheet_name}` : '工作表未记录'}</small></td>
                      <td>{batch.date_from || '-'}<small>{batch.date_to && batch.date_to !== batch.date_from ? `至 ${batch.date_to}` : ''}</small></td>
                      <td><div className="bank-center-batch-result"><span>共 {batch.total} 笔</span><strong>新增 {batch.inserted}</strong><em>重复 {batch.duplicates}</em><em>异常 {batch.invalid}</em></div></td>
                      <td className="is-right is-income">{money(batch.income_total)}</td>
                      <td className="is-right is-expense">{money(batch.expense_total)}</td>
                      <td><button type="button" className="bank-center-more-action" onClick={() => openBatchLedger(batch)}>查看流水</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="bank-center-list-foot">共 {importBatchTotal} 个导入批次；当前显示 {importBatches.length} 个。</footer>
          </section>
        </div>
      ) : null}

      <BankCenterImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={handleImported}
        onMoreImport={() => { setImportOpen(false); setActiveView(VIEWS.BANK_STATEMENT_IMPORT) }}
        onGoPending={() => { setImportOpen(false); setActiveTab('pending') }}
        onViewImports={() => { setImportOpen(false); setActiveTab('imports') }}
      />
    </PageContainer>
  )
}