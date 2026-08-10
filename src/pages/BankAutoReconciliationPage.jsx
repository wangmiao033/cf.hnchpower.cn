import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { ApiError } from '@/lib/api/client.ts'
import {
  confirmBankAutoReconciliation,
  getBankAutoReconciliationDashboard,
  reverseBankAutoReconciliation
} from '@/lib/api/bankAutoReconciliation.ts'
import { bulkImportBankTransactions, getBankTransactions } from '@/lib/api/bankTransaction.ts'
import { icbcRowToBankTransaction, parseIcbcStatementExcel } from '@/utils/icbcStatementExcel.js'
import './BankAutoReconciliationPage.css'

const TABS = [
  { key: 'pending', label: '待处理' },
  { key: 'ledger', label: '全部流水' },
  { key: 'history', label: '已核销' }
]

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

function confidenceLabel(value) {
  return { high: '高', medium: '中', low: '低', none: '未匹配' }[value] || value || '-'
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

function monthRange(offset = 0) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)
  const fmt = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  return { from: fmt(start), to: fmt(end) }
}

function MetricCard({ label, count, amount, tone = 'neutral', active = false, onClick, hint }) {
  return (
    <button type="button" className={`bank-center-metric is-${tone} ${active ? 'is-active' : ''}`} onClick={onClick}>
      <span>{label}</span>
      <strong>{count}</strong>
      <small>{amount != null ? money(amount) : hint}</small>
    </button>
  )
}

function ImportModal({ open, onClose, onImported, onMoreImport }) {
  const { showToast } = useAppState()
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [bankAccount, setBankAccount] = useState('')
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  const reset = useCallback(() => {
    setFile(null)
    setParsed(null)
    setBankAccount('')
    setDragging(false)
    setParsing(false)
    setImporting(false)
    setResult(null)
  }, [])

  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  if (!open) return null

  const parseFile = async (nextFile) => {
    if (!nextFile) return
    const lower = nextFile.name.toLowerCase()
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
      showToast('请选择工商银行导出的 .xlsx 或 .xls 文件', 'info')
      return
    }
    if (nextFile.size > 20 * 1024 * 1024) {
      showToast('文件超过 20MB，请拆分后再导入', 'info')
      return
    }
    setParsing(true)
    setResult(null)
    try {
      const data = await parseIcbcStatementExcel(nextFile)
      setFile(nextFile)
      setParsed(data)
      setBankAccount(data.metadata?.bankAccount || '')
      showToast(`已识别 ${data.rows.length} 笔有效流水，请确认后导入`, 'success')
    } catch (error) {
      setFile(null)
      setParsed(null)
      showToast(error instanceof Error ? error.message : 'Excel 解析失败', 'info')
    } finally {
      setParsing(false)
    }
  }

  const confirmImport = async () => {
    if (!file || !parsed?.rows?.length) return
    setImporting(true)
    setResult(null)
    try {
      const items = parsed.rows.map((row) => icbcRowToBankTransaction(row, {
        bankAccount,
        sourceBank: 'ICBC',
        fileName: file.name
      }))
      const response = await bulkImportBankTransactions({
        source_bank: 'ICBC',
        source_file_name: file.name,
        bank_account: bankAccount.trim() || null,
        items
      })
      setResult(response)
      if (response.inserted > 0) {
        showToast(`导入完成：新增 ${response.inserted} 笔，重复跳过 ${response.duplicates} 笔`, 'success')
      } else if (response.duplicates > 0) {
        showToast(`没有新增流水：${response.duplicates} 笔均已存在，系统已自动防重复`, 'info')
      } else {
        showToast('没有可导入的有效流水', 'info')
      }
      onImported?.(response)
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : '批量导入失败，请稍后重试', 'info')
    } finally {
      setImporting(false)
    }
  }

  const preview = parsed?.rows?.slice(0, 30) || []
  return (
    <div className="bank-center-modal-mask" role="presentation" onMouseDown={onClose}>
      <section className="bank-center-import" role="dialog" aria-modal="true" aria-label="导入银行流水" onMouseDown={(event) => event.stopPropagation()}>
        <header className="bank-center-import__head">
          <div>
            <span>导入银行流水</span>
            <h2>工商银行 Excel 批量导入</h2>
            <p>保留现有工行解析与防重复逻辑。选择文件后先预览，再确认写入。</p>
          </div>
          <button type="button" className="bank-center-icon-btn" onClick={onClose} aria-label="关闭">×</button>
        </header>

        <div className="bank-center-import__body">
          {!parsed ? (
            <div
              className={`bank-center-dropzone ${dragging ? 'is-dragging' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => !parsing && fileRef.current?.click()}
              onKeyDown={(event) => {
                if ((event.key === 'Enter' || event.key === ' ') && !parsing) fileRef.current?.click()
              }}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                void parseFile(event.dataTransfer?.files?.[0])
              }}
            >
              <input
                ref={fileRef}
                type="file"
                hidden
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={(event) => {
                  const selected = event.target.files?.[0]
                  event.target.value = ''
                  void parseFile(selected)
                }}
              />
              <span className="bank-center-dropzone__icon">⇩</span>
              <strong>{parsing ? '正在读取并识别 Excel…' : '拖拽工商银行 Excel 到这里'}</strong>
              <small>支持 .xlsx / .xls · 单文件不超过 20MB</small>
              <button type="button" disabled={parsing}>{parsing ? '识别中…' : '选择 Excel 文件'}</button>
            </div>
          ) : (
            <>
              <div className="bank-center-import__filebar">
                <div><span>当前文件</span><strong>{file?.name}</strong></div>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={parsing || importing}>更换文件</button>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={(event) => {
                    const selected = event.target.files?.[0]
                    event.target.value = ''
                    void parseFile(selected)
                  }}
                />
              </div>

              <div className="bank-center-import__metrics">
                <article><span>有效流水</span><strong>{parsed.summary.validRows} 笔</strong><small>{parsed.summary.invalidRows ? `${parsed.summary.invalidRows} 行异常` : '格式校验通过'}</small></article>
                <article className="is-income"><span>收入</span><strong>{money(parsed.summary.incomeTotal)}</strong><small>{parsed.summary.incomeRows} 笔</small></article>
                <article className="is-expense"><span>支出</span><strong>{money(parsed.summary.expenseTotal)}</strong><small>{parsed.summary.expenseRows} 笔</small></article>
                <article><span>净流入</span><strong>{money(parsed.summary.netAmount)}</strong><small>{parsed.summary.dateFrom || '-'} 至 {parsed.summary.dateTo || '-'}</small></article>
                <article><span>期末余额</span><strong>{money(parsed.summary.lastBalance)}</strong><small>{parsed.sheetName}</small></article>
              </div>

              <label className="bank-center-account-field">
                <span>本方银行账号（选填）</span>
                <input value={bankAccount} onChange={(event) => setBankAccount(event.target.value)} placeholder="Excel 如包含账号会自动识别" />
                <small>防重复仍使用现有稳定指纹规则，重复流水不会再次写入。</small>
              </label>

              {parsed.invalidRows?.length ? (
                <div className="bank-center-import__warning">有 {parsed.invalidRows.length} 行无法安全识别，将自动跳过；示例：第 {parsed.invalidRows.slice(0, 4).map((row) => row.sourceRowNo).join('、')} 行。</div>
              ) : null}

              <div className="bank-center-import__preview">
                <table>
                  <thead><tr><th>Excel 行</th><th>日期</th><th>方向</th><th>对方单位</th><th>用途 / 摘要</th><th>收入</th><th>支出</th><th>余额</th></tr></thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={`${row.sourceRowNo}-${row.tradeDate}-${row.balance ?? ''}`}>
                        <td>{row.sourceRowNo}</td><td>{row.tradeDate || '-'}</td><td>{row.direction === 'credit' ? '收入' : '支出'}</td>
                        <td>{row.counterparty || '-'}</td><td title={row.purpose || row.summary || row.remark || ''}>{row.purpose || row.summary || row.remark || '-'}</td>
                        <td className="is-income">{row.incomeAmount != null ? money(row.incomeAmount) : '-'}</td>
                        <td className="is-expense">{row.expenseAmount != null ? money(row.expenseAmount) : '-'}</td>
                        <td>{money(row.balance, '-')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.rows.length > preview.length ? <small className="bank-center-import__preview-note">这里只预览前 {preview.length} 笔，确认导入会处理全部 {parsed.rows.length} 笔。</small> : null}

              {result ? (
                <div className="bank-center-import__result">
                  <strong>导入完成</strong>
                  <span>新增 {result.inserted} 笔</span><span>重复跳过 {result.duplicates} 笔</span><span>异常跳过 {result.invalid} 笔</span>
                </div>
              ) : null}
            </>
          )}
        </div>

        <footer className="bank-center-import__foot">
          <button type="button" className="is-ghost" onClick={onMoreImport}>更多导入方式</button>
          <div>
            <button type="button" onClick={onClose}>{result ? '关闭' : '取消'}</button>
            {parsed && !result ? <button type="button" className="is-primary" disabled={importing || !parsed.rows.length} onClick={confirmImport}>{importing ? '正在批量写入…' : `确认导入 ${parsed.rows.length} 笔`}</button> : null}
          </div>
        </footer>
      </section>
    </div>
  )
}

export default function BankAutoReconciliationPage() {
  const { setActiveView, openBill360, showToast } = useAppState()
  const { can } = useAuth()
  const canManage = can('funds.manage')
  const [activeTab, setActiveTab] = useState('pending')
  const [dashboard, setDashboard] = useState(null)
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [dashboardError, setDashboardError] = useState('')
  const [dashboardRevision, setDashboardRevision] = useState(0)
  const [queueFilter, setQueueFilter] = useState('all')
  const [queueDirection, setQueueDirection] = useState('all')
  const [selection, setSelection] = useState({})
  const [busyId, setBusyId] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)
  const [expandedId, setExpandedId] = useState('')
  const [historyMode, setHistoryMode] = useState('confirmed')
  const [importOpen, setImportOpen] = useState(false)

  const [ledgerRows, setLedgerRows] = useState([])
  const [ledgerTotal, setLedgerTotal] = useState(0)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError, setLedgerError] = useState('')
  const [ledgerRevision, setLedgerRevision] = useState(0)
  const [ledgerSearch, setLedgerSearch] = useState('')
  const [rangeMode, setRangeMode] = useState('this-month')
  const [ledgerDirection, setLedgerDirection] = useState('all')
  const [ledgerLinked, setLedgerLinked] = useState('all')
  const [advanced, setAdvanced] = useState(false)
  const [dateFrom, setDateFrom] = useState(monthRange(0).from)
  const [dateTo, setDateTo] = useState(monthRange(0).to)
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')

  const refreshDashboard = () => setDashboardRevision((value) => value + 1)
  const refreshLedger = () => setLedgerRevision((value) => value + 1)

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

  const serverDateRange = useMemo(() => {
    if (rangeMode === 'this-month') return monthRange(0)
    if (rangeMode === 'last-month') return monthRange(-1)
    if (rangeMode === 'custom') return { from: dateFrom, to: dateTo }
    return { from: '', to: '' }
  }, [rangeMode, dateFrom, dateTo])

  useEffect(() => {
    if (activeTab !== 'ledger') return undefined
    let cancelled = false
    setLedgerLoading(true)
    setLedgerError('')
    getBankTransactions({
      q: ledgerSearch.trim() || undefined,
      date_from: serverDateRange.from || undefined,
      date_to: serverDateRange.to || undefined,
      amount_min: amountMin.trim() || undefined,
      amount_max: amountMax.trim() || undefined,
      limit: 300,
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
      .finally(() => {
        if (!cancelled) setLedgerLoading(false)
      })
    return () => { cancelled = true }
  }, [activeTab, ledgerRevision, ledgerSearch, serverDateRange.from, serverDateRange.to, amountMin, amountMax])

  const suggestions = dashboard?.suggestions || []
  const queueMetrics = useMemo(() => {
    const high = suggestions.filter((item) => item.confidence_level === 'high')
    const review = suggestions.filter((item) => item.confidence_level === 'medium')
    const unmatched = suggestions.filter((item) => item.confidence_level === 'low' || item.confidence_level === 'none')
    const sum = (items) => items.reduce((total, item) => total + Number(item.amount || 0), 0)
    return {
      all: { count: suggestions.length, amount: sum(suggestions) },
      high: { count: high.length, amount: sum(high) },
      review: { count: review.length, amount: sum(review) },
      unmatched: { count: unmatched.length, amount: sum(unmatched) }
    }
  }, [suggestions])

  const visibleSuggestions = useMemo(() => suggestions.filter((item) => {
    if (queueDirection !== 'all' && item.direction !== queueDirection) return false
    if (queueFilter === 'high') return item.confidence_level === 'high'
    if (queueFilter === 'review') return item.confidence_level === 'medium'
    if (queueFilter === 'unmatched') return item.confidence_level === 'low' || item.confidence_level === 'none'
    return true
  }), [suggestions, queueFilter, queueDirection])

  const highReady = useMemo(() => suggestions.filter((item) => item.auto_ready && item.candidates?.[0]), [suggestions])

  const visibleHistory = useMemo(
    () => (dashboard?.recent_matches || []).filter((item) => item.status === historyMode),
    [dashboard?.recent_matches, historyMode]
  )

  const visibleLedger = useMemo(() => ledgerRows.filter((row) => {
    const direction = directionOf(row)
    if (ledgerDirection !== 'all' && direction !== ledgerDirection) return false
    const linked = linkedOf(row)
    if (ledgerLinked === 'linked' && !linked) return false
    if (ledgerLinked === 'unlinked' && linked) return false
    return true
  }), [ledgerRows, ledgerDirection, ledgerLinked])

  const confirmOne = async (item, candidate) => {
    if (!canManage || !candidate) return
    const confirmed = window.confirm(`确认将 ${item.direction_label} ${money(item.amount)} 核销到 ${candidate.bill_number}？\n\n${candidate.partner_name || ''} · 未结 ${money(candidate.outstanding_amount)}`)
    if (!confirmed) return
    setBusyId(item.transaction_id)
    try {
      await confirmBankAutoReconciliation(item.transaction_id, candidate.bill_type, candidate.bill_id)
      showToast?.(`已核销到 ${candidate.bill_number}`, 'success')
      refreshDashboard()
      refreshLedger()
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
    const confirmed = window.confirm(`将核销 ${highReady.length} 笔高置信流水，共 ${money(amount)}。\n\n只处理当前已达到高置信且无明显歧义的流水，是否继续？`)
    if (!confirmed) return
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
    showToast?.(failed ? `高置信核销完成：成功 ${success} 笔，失败 ${failed} 笔` : `已核销 ${success} 笔高置信流水`, failed ? 'info' : 'success')
    refreshDashboard()
    refreshLedger()
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
      refreshLedger()
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : '撤销核销失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  const resetLedgerFilters = () => {
    const current = monthRange(0)
    setLedgerSearch('')
    setRangeMode('this-month')
    setDateFrom(current.from)
    setDateTo(current.to)
    setAmountMin('')
    setAmountMax('')
    setLedgerDirection('all')
    setLedgerLinked('all')
  }

  return (
    <PageContainer hideHeader className="bank-center-page">
      <section className="bank-center-head">
        <div className="bank-center-head__copy">
          <h1>银行中心</h1>
          <p>导入银行流水后，系统自动匹配研发/渠道账单；优先处理待核销，再回看完整流水和核销记录。</p>
        </div>
        <div className="bank-center-head__actions">
          <button type="button" onClick={refreshDashboard} disabled={dashboardLoading}>{dashboardLoading ? '刷新中…' : '重新匹配'}</button>
          {canManage ? <button type="button" className="is-primary" onClick={() => setImportOpen(true)}>＋ 导入银行流水</button> : null}
        </div>
      </section>

      <nav className="bank-center-tabs" aria-label="银行中心">
        {TABS.map((tab) => (
          <button key={tab.key} type="button" className={activeTab === tab.key ? 'is-active' : ''} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
            {tab.key === 'pending' && queueMetrics.all.count ? <em>{queueMetrics.all.count}</em> : null}
          </button>
        ))}
      </nav>

      {activeTab === 'pending' ? (
        <div className="bank-center-pane">
          {dashboardError && !dashboard ? <div className="bank-center-error"><strong>读取失败</strong><span>{dashboardError}</span><button type="button" onClick={refreshDashboard}>重试</button></div> : null}

          <section className="bank-center-metrics">
            <MetricCard label="待核销" count={`${queueMetrics.all.count} 笔`} amount={queueMetrics.all.amount} active={queueFilter === 'all'} onClick={() => setQueueFilter('all')} />
            <MetricCard label="高置信匹配" count={`${queueMetrics.high.count} 笔`} amount={queueMetrics.high.amount} tone="high" active={queueFilter === 'high'} onClick={() => setQueueFilter('high')} />
            <MetricCard label="需要人工确认" count={`${queueMetrics.review.count} 笔`} amount={queueMetrics.review.amount} tone="review" active={queueFilter === 'review'} onClick={() => setQueueFilter('review')} />
            <MetricCard label="未匹配 / 低置信" count={`${queueMetrics.unmatched.count} 笔`} amount={queueMetrics.unmatched.amount} tone="unmatched" active={queueFilter === 'unmatched'} onClick={() => setQueueFilter('unmatched')} />
          </section>

          <section className="bank-center-card">
            <header className="bank-center-card__head">
              <div>
                <h2>待核销流水</h2>
                <p>系统给出推荐账单和匹配依据；高置信可以批量处理，其他流水建议逐笔确认。</p>
              </div>
              <div className="bank-center-card__tools">
                <select value={queueDirection} onChange={(event) => setQueueDirection(event.target.value)}>
                  <option value="all">全部收支</option><option value="collection">只看收入</option><option value="payment">只看支出</option><option value="unknown">方向待判断</option>
                </select>
                {canManage ? <button type="button" className="is-primary" disabled={batchBusy || highReady.length === 0} onClick={bulkConfirmHigh}>{batchBusy ? '核销中…' : `批量核销高置信${highReady.length ? ` (${highReady.length})` : ''}`}</button> : null}
              </div>
            </header>

            <div className="bank-center-table-wrap">
              <table className="bank-center-table bank-center-table--queue">
                <thead><tr><th>日期</th><th>收 / 支</th><th>对方单位</th><th>摘要</th><th className="is-right">金额</th><th>推荐账单</th><th>匹配度</th><th>操作</th></tr></thead>
                <tbody>
                  {!dashboardLoading && visibleSuggestions.length === 0 ? <tr><td colSpan={8} className="bank-center-empty">当前筛选下没有待处理流水。</td></tr> : null}
                  {visibleSuggestions.map((item) => {
                    const selectedKey = selection[item.transaction_id] || candidateKey(item.candidates?.[0])
                    const candidate = item.candidates?.find((row) => candidateKey(row) === selectedKey) || item.candidates?.[0]
                    const expanded = expandedId === item.transaction_id
                    return (
                      <React.Fragment key={item.transaction_id}>
                        <tr className={`is-confidence-${item.confidence_level}`}>
                          <td>{item.trade_date || '-'}</td>
                          <td><span className={`bank-center-direction is-${item.direction}`}>{item.direction === 'collection' ? '收入' : item.direction === 'payment' ? '支出' : '待判定'}</span></td>
                          <td className="bank-center-strong">{item.counterparty_name || '-'}</td>
                          <td className="bank-center-summary" title={item.summary || ''}>{item.summary || '-'}</td>
                          <td className="is-right"><strong className={item.direction === 'collection' ? 'is-income' : item.direction === 'payment' ? 'is-expense' : ''}>{item.direction === 'payment' ? '-' : '+'}{money(item.amount)}</strong></td>
                          <td>
                            {item.candidates?.length ? (
                              <select className="bank-center-candidate-select" value={selectedKey} onChange={(event) => setSelection((current) => ({ ...current, [item.transaction_id]: event.target.value }))}>
                                {item.candidates.map((row) => <option key={candidateKey(row)} value={candidateKey(row)}>{row.bill_number} · {row.partner_name || '未填合作方'} · {row.score}分</option>)}
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
                              <div className="bank-center-expand">
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
          </section>
        </div>
      ) : null}

      {activeTab === 'ledger' ? (
        <div className="bank-center-pane">
          <section className="bank-center-card">
            <header className="bank-center-ledger-head">
              <div>
                <h2>全部银行流水</h2>
                <p>按财务视角展示日期、交易对象、收支、余额和核销状态；来源类型、指令编号等细节不再长期占主表。</p>
              </div>
              <div className="bank-center-ledger-search">
                <input value={ledgerSearch} onChange={(event) => setLedgerSearch(event.target.value)} placeholder="搜索户名 / 摘要 / 流水号 / 账单号" />
                <button type="button" onClick={refreshLedger} disabled={ledgerLoading}>{ledgerLoading ? '查询中…' : '查询'}</button>
              </div>
            </header>

            <div className="bank-center-quick-filters">
              <button type="button" className={rangeMode === 'this-month' ? 'is-active' : ''} onClick={() => setRangeMode('this-month')}>本月</button>
              <button type="button" className={rangeMode === 'last-month' ? 'is-active' : ''} onClick={() => setRangeMode('last-month')}>上月</button>
              <i />
              <button type="button" className={ledgerLinked === 'unlinked' ? 'is-active' : ''} onClick={() => setLedgerLinked(ledgerLinked === 'unlinked' ? 'all' : 'unlinked')}>未核销</button>
              <button type="button" className={ledgerLinked === 'linked' ? 'is-active' : ''} onClick={() => setLedgerLinked(ledgerLinked === 'linked' ? 'all' : 'linked')}>已核销</button>
              <button type="button" className={ledgerDirection === 'income' ? 'is-active' : ''} onClick={() => setLedgerDirection(ledgerDirection === 'income' ? 'all' : 'income')}>收入</button>
              <button type="button" className={ledgerDirection === 'expense' ? 'is-active' : ''} onClick={() => setLedgerDirection(ledgerDirection === 'expense' ? 'all' : 'expense')}>支出</button>
              <button type="button" className="is-more" onClick={() => setAdvanced((value) => !value)}>{advanced ? '收起筛选' : '高级筛选'}</button>
            </div>

            {advanced ? (
              <div className="bank-center-advanced">
                <label><span>日期起</span><input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setRangeMode('custom') }} /></label>
                <label><span>日期止</span><input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setRangeMode('custom') }} /></label>
                <label><span>金额下限</span><input value={amountMin} onChange={(event) => setAmountMin(event.target.value)} placeholder="如 100" /></label>
                <label><span>金额上限</span><input value={amountMax} onChange={(event) => setAmountMax(event.target.value)} placeholder="如 50000" /></label>
                <button type="button" onClick={resetLedgerFilters}>重置</button>
              </div>
            ) : null}

            {ledgerError ? <div className="bank-center-inline-error">{ledgerError}</div> : null}
            <div className="bank-center-table-wrap">
              <table className="bank-center-table bank-center-table--ledger">
                <thead><tr><th>日期</th><th>方向</th><th>对方户名</th><th>摘要 / 用途</th><th className="is-right">收入</th><th className="is-right">支出</th><th className="is-right">余额</th><th>核销状态</th><th>对应账单</th></tr></thead>
                <tbody>
                  {!ledgerLoading && visibleLedger.length === 0 ? <tr><td colSpan={9} className="bank-center-empty">当前条件下暂无流水。</td></tr> : null}
                  {visibleLedger.map((row) => {
                    const direction = directionOf(row)
                    const linked = linkedOf(row)
                    return (
                      <tr key={row.id}>
                        <td>{row.trade_date || '-'}</td>
                        <td><span className={`bank-center-direction is-${direction === 'income' ? 'collection' : direction === 'expense' ? 'payment' : 'unknown'}`}>{direction === 'income' ? '收入' : direction === 'expense' ? '支出' : '待判定'}</span></td>
                        <td className="bank-center-strong">{counterpartyOf(row)}</td>
                        <td className="bank-center-summary" title={[row.summary, row.purpose, row.remark].filter(Boolean).join('；')}>{row.summary || row.purpose || row.remark || '-'}</td>
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
            <footer className="bank-center-list-foot">共 {ledgerTotal} 条；当前显示 {visibleLedger.length} 条（单次最多读取 300 条，可通过筛选缩小范围）。</footer>
          </section>
        </div>
      ) : null}

      {activeTab === 'history' ? (
        <div className="bank-center-pane">
          <section className="bank-center-card">
            <header className="bank-center-card__head">
              <div><h2>核销记录</h2><p>核销和撤销都保留操作人、时间和原因；撤销后原银行流水会重新回到待处理。</p></div>
              <div className="bank-center-segments">
                <button type="button" className={historyMode === 'confirmed' ? 'is-active' : ''} onClick={() => setHistoryMode('confirmed')}>有效核销</button>
                <button type="button" className={historyMode === 'reversed' ? 'is-active' : ''} onClick={() => setHistoryMode('reversed')}>已撤销</button>
              </div>
            </header>
            <div className="bank-center-table-wrap">
              <table className="bank-center-table bank-center-table--history">
                <thead><tr><th>银行日期</th><th>方向</th><th>账单</th><th className="is-right">金额</th><th>匹配度</th><th>确认人 / 时间</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                  {visibleHistory.length === 0 ? <tr><td colSpan={8} className="bank-center-empty">暂无记录。</td></tr> : null}
                  {visibleHistory.map((match) => (
                    <tr key={match.match_id}>
                      <td>{match.trade_date || '-'}</td>
                      <td>{match.direction_label || '-'}</td>
                      <td><button type="button" className="bank-center-bill-link" onClick={() => openBill360(match.bill_type, match.bill_id)}>{match.bill_number || match.bill_id}</button><small>{billTypeLabel(match.bill_type)}</small></td>
                      <td className="is-right"><strong>{money(match.linked_amount)}</strong></td>
                      <td><span className={`bank-center-confidence is-${match.confidence_level}`}>{confidenceLabel(match.confidence_level)} {Number(match.confidence_score || 0).toFixed(0)}</span></td>
                      <td>{match.confirmed_email || '-'}<small>{dateTime(match.confirmed_at)}</small></td>
                      <td>{match.status === 'confirmed' ? <span className="bank-center-ledger-status is-linked">有效</span> : <span className="bank-center-ledger-status">已撤销</span>}{match.reverse_reason ? <small>{match.reverse_reason}</small> : null}</td>
                      <td>{canManage && match.status === 'confirmed' ? <button type="button" className="bank-center-more-action" disabled={busyId === match.match_id} onClick={() => reverseMatch(match)}>{busyId === match.match_id ? '处理中…' : '撤销核销'}</button> : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          refreshDashboard()
          refreshLedger()
        }}
        onMoreImport={() => {
          setImportOpen(false)
          setActiveView(VIEWS.BANK_STATEMENT_IMPORT)
        }}
      />
    </PageContainer>
  )
}
