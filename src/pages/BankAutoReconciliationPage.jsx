import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { VIEWS } from '@/app/routes.js'
import {
  confirmBankAutoReconciliation,
  getBankAutoReconciliationDashboard,
  reverseBankAutoReconciliation
} from '@/lib/api/bankAutoReconciliation.ts'
import './BankAutoReconciliationPage.css'

function money(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function confidenceLabel(value) {
  return { high: '高置信', medium: '需复核', low: '低置信', none: '未匹配' }[value] || value
}

function billTypeLabel(value) {
  return value === 'rd' ? '研发账单' : '渠道账单'
}

function dateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

function candidateKey(candidate) {
  return `${candidate.bill_type}:${candidate.bill_id}`
}

export default function BankAutoReconciliationPage() {
  const { setActiveView, openBill360, showToast } = useAppState()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [direction, setDirection] = useState('all')
  const [confidence, setConfidence] = useState('all')
  const [selection, setSelection] = useState({})
  const [busyId, setBusyId] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)
  const [historyMode, setHistoryMode] = useState('confirmed')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getBankAutoReconciliationDashboard(300)
      .then((result) => {
        if (cancelled) return
        setData(result)
        setSelection((current) => {
          const next = { ...current }
          for (const item of result.suggestions || []) {
            if (!next[item.transaction_id] && item.candidates?.[0]) {
              next[item.transaction_id] = candidateKey(item.candidates[0])
            }
          }
          return next
        })
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '自动核销数据读取失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  const visibleSuggestions = useMemo(
    () => (data?.suggestions || []).filter((item) => {
      if (direction !== 'all' && item.direction !== direction) return false
      if (confidence !== 'all' && item.confidence_level !== confidence) return false
      return true
    }),
    [data?.suggestions, direction, confidence]
  )

  const confirmedHistory = useMemo(
    () => (data?.recent_matches || []).filter((item) => item.status === historyMode),
    [data?.recent_matches, historyMode]
  )

  const highReady = useMemo(
    () => (data?.suggestions || []).filter((item) => item.auto_ready && item.candidates?.[0]),
    [data?.suggestions]
  )

  const refresh = () => setRevision((value) => value + 1)

  const confirmOne = async (item, candidate) => {
    if (!candidate) return
    const confirmed = window.confirm(
      `确认将 ${item.direction_label} ${money(item.amount)} 核销到 ${candidate.bill_number}？\n\n${candidate.partner_name || ''} · 未结 ${money(candidate.outstanding_amount)}`
    )
    if (!confirmed) return
    setBusyId(item.transaction_id)
    try {
      await confirmBankAutoReconciliation(item.transaction_id, candidate.bill_type, candidate.bill_id)
      showToast?.(`已核销到 ${candidate.bill_number}`, 'success')
      refresh()
    } catch (matchError) {
      showToast?.(matchError instanceof Error ? matchError.message : '核销失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  const confirmSelected = (item) => {
    const key = selection[item.transaction_id] || candidateKey(item.candidates?.[0] || {})
    const candidate = (item.candidates || []).find((row) => candidateKey(row) === key) || item.candidates?.[0]
    return confirmOne(item, candidate)
  }

  const bulkConfirmHigh = async () => {
    if (!highReady.length) return
    const amount = highReady.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const confirmed = window.confirm(
      `将自动核销 ${highReady.length} 笔高置信流水，共 ${money(amount)}。\n\n只有“金额 + 合作方/账单号”等证据达到高置信且无明显歧义的流水会执行。是否继续？`
    )
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
    showToast?.(
      failed ? `高置信核销完成：成功 ${success} 笔，失败 ${failed} 笔` : `已自动核销 ${success} 笔高置信流水`,
      failed ? 'info' : 'success'
    )
    refresh()
  }

  const reverseMatch = async (match) => {
    const reason = window.prompt(`撤销 ${match.bill_number || '该账单'} 的银行核销，请填写原因：`, '') || ''
    if (!reason.trim()) return
    const confirmed = window.confirm(`确定撤销 ${money(match.linked_amount)} 的核销吗？账单收付款状态会同步恢复。`)
    if (!confirmed) return
    setBusyId(match.match_id)
    try {
      await reverseBankAutoReconciliation(match.match_id, reason.trim())
      showToast?.('核销已撤销，原流水已恢复为待匹配', 'success')
      refresh()
    } catch (reverseError) {
      showToast?.(reverseError instanceof Error ? reverseError.message : '撤销核销失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  const stats = data?.stats || {}

  return (
    <PageContainer hideHeader className="bank-auto-page">
      <section className="bank-auto-head">
        <div>
          <span className="bank-auto-kicker">BANK RECONCILIATION · V2.3</span>
          <h1>银行流水自动核销</h1>
          <p>先计算匹配置信度，再由你确认；高置信可批量核销，所有自动核销都支持带原因撤销。</p>
        </div>
        <div className="bank-auto-head-actions">
          <button type="button" onClick={() => setActiveView(VIEWS.BANK_STATEMENT_IMPORT)}>+ 录入流水</button>
          <button type="button" onClick={() => setActiveView(VIEWS.BANK_TRANSACTIONS_LEDGER)}>流水台账</button>
          <button type="button" onClick={refresh} disabled={loading}>{loading ? '刷新中…' : '重新匹配'}</button>
          <button type="button" className="is-primary" onClick={bulkConfirmHigh} disabled={batchBusy || highReady.length === 0}>
            {batchBusy ? '核销中…' : `自动核销高置信${highReady.length ? ` (${highReady.length})` : ''}`}
          </button>
        </div>
      </section>

      {error && !data ? (
        <section className="bank-auto-error"><strong>读取失败</strong><span>{error}</span><button type="button" onClick={refresh}>重试</button></section>
      ) : null}

      <section className="bank-auto-stats">
        <article><span>待核销流水</span><strong>{stats.pending_transactions || 0}</strong><small>银行流水原始记录</small></article>
        <article className="is-high"><span>高置信匹配</span><strong>{stats.high_confidence || 0}</strong><small>可批量自动核销</small></article>
        <article className="is-review"><span>需要复核</span><strong>{stats.medium_confidence || 0}</strong><small>存在一定匹配证据</small></article>
        <article className="is-unmatched"><span>未匹配 / 低置信</span><strong>{stats.unmatched || 0}</strong><small>建议人工指定账单</small></article>
        <article className="is-done"><span>当前已核销</span><strong>{stats.confirmed_matches || 0}</strong><small>{money(stats.confirmed_amount || 0)}</small></article>
      </section>

      <section className="bank-auto-card bank-auto-card--suggestions">
        <header className="bank-auto-card-head">
          <div><span>MATCH QUEUE</span><h2>待核销匹配队列</h2><p>高置信需要分数 ≥80 且领先第二候选至少 10 分，避免“金额一样就自动认账”。</p></div>
          <div className="bank-auto-filters">
            <select value={direction} onChange={(event) => setDirection(event.target.value)}>
              <option value="all">全部收支</option><option value="collection">只看回款</option><option value="payment">只看付款</option><option value="unknown">方向待判断</option>
            </select>
            <select value={confidence} onChange={(event) => setConfidence(event.target.value)}>
              <option value="all">全部置信度</option><option value="high">高置信</option><option value="medium">需复核</option><option value="low">低置信</option><option value="none">未匹配</option>
            </select>
          </div>
        </header>

        <div className="bank-auto-queue">
          {!loading && visibleSuggestions.length === 0 ? <div className="bank-auto-empty">当前筛选条件下没有待核销流水。</div> : null}
          {visibleSuggestions.map((item) => {
            const selectedKey = selection[item.transaction_id] || (item.candidates?.[0] ? candidateKey(item.candidates[0]) : '')
            const selectedCandidate = item.candidates?.find((row) => candidateKey(row) === selectedKey) || item.candidates?.[0]
            return (
              <article className={`bank-auto-match is-${item.confidence_level}`} key={item.transaction_id}>
                <div className="bank-auto-match-bank">
                  <div className="bank-auto-match-title"><span className={`direction is-${item.direction}`}>{item.direction_label}</span><strong>{money(item.amount)}</strong><em>{item.currency || 'CNY'}</em></div>
                  <dl>
                    <div><dt>交易日期</dt><dd>{item.trade_date || '-'}</dd></div>
                    <div><dt>对方户名</dt><dd>{item.counterparty_name || '-'}</dd></div>
                    <div><dt>银行流水号</dt><dd>{item.transaction_no || '-'}</dd></div>
                    <div><dt>摘要</dt><dd title={item.summary || ''}>{item.summary || '-'}</dd></div>
                  </dl>
                </div>

                <div className="bank-auto-arrow"><span>→</span><em className={`is-${item.confidence_level}`}>{confidenceLabel(item.confidence_level)}{item.top_score ? ` ${Number(item.top_score).toFixed(0)}` : ''}</em></div>

                <div className="bank-auto-match-bill">
                  {item.candidates?.length ? (
                    <>
                      <label className="bank-auto-candidate-select">
                        <span>匹配账单</span>
                        <select value={selectedKey} onChange={(event) => setSelection((current) => ({ ...current, [item.transaction_id]: event.target.value }))}>
                          {item.candidates.map((candidate) => (
                            <option value={candidateKey(candidate)} key={candidateKey(candidate)}>
                              {candidate.bill_number} · {candidate.partner_name || '未填合作方'} · 未结 {money(candidate.outstanding_amount)} · {candidate.score}分
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedCandidate ? (
                        <div className="bank-auto-candidate-detail">
                          <div><span>{billTypeLabel(selectedCandidate.bill_type)}</span><button type="button" onClick={() => openBill360(selectedCandidate.bill_type, selectedCandidate.bill_id)}>{selectedCandidate.bill_number}</button></div>
                          <strong>{selectedCandidate.partner_name || '-'}</strong>
                          <small>{selectedCandidate.settlement_month || '-'} · {selectedCandidate.game_name || '未填游戏'} · 应结 {money(selectedCandidate.bill_amount)} · 未结 {money(selectedCandidate.outstanding_amount)}</small>
                          <div className="bank-auto-reasons">{(selectedCandidate.reasons || []).map((reason) => <span key={reason}>✓ {reason}</span>)}</div>
                        </div>
                      ) : null}
                    </>
                  ) : <div className="bank-auto-no-candidate"><strong>暂无可用候选</strong><span>{item.blocked_reason || '没有找到匹配账单'}</span></div>}
                </div>

                <div className="bank-auto-match-action">
                  <button type="button" className={item.auto_ready ? 'is-primary' : ''} disabled={!selectedCandidate || busyId === item.transaction_id} onClick={() => confirmSelected(item)}>
                    {busyId === item.transaction_id ? '处理中…' : item.auto_ready ? '确认核销' : '人工确认'}
                  </button>
                  {item.blocked_reason && item.candidates?.length ? <small>{item.blocked_reason}</small> : null}
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="bank-auto-card bank-auto-card--history">
        <header className="bank-auto-card-head">
          <div><span>RECONCILIATION HISTORY</span><h2>核销记录</h2><p>撤销会同步恢复原银行流水和账单收付款状态，并保留撤销原因。</p></div>
          <div className="bank-auto-history-tabs"><button type="button" className={historyMode === 'confirmed' ? 'is-active' : ''} onClick={() => setHistoryMode('confirmed')}>有效核销</button><button type="button" className={historyMode === 'reversed' ? 'is-active' : ''} onClick={() => setHistoryMode('reversed')}>已撤销</button></div>
        </header>
        <div className="bank-auto-table-wrap">
          <table>
            <thead><tr><th>银行日期</th><th>方向</th><th>账单</th><th>金额</th><th>置信度</th><th>确认人 / 时间</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {confirmedHistory.length === 0 ? <tr><td colSpan={8} className="bank-auto-empty-cell">暂无记录。</td></tr> : null}
              {confirmedHistory.map((match) => (
                <tr key={match.match_id}>
                  <td>{match.trade_date || '-'}</td><td>{match.direction_label}</td>
                  <td><button type="button" className="bank-auto-bill-link" onClick={() => openBill360(match.bill_type, match.bill_id)}>{match.bill_number || match.bill_id}</button><small>{billTypeLabel(match.bill_type)}</small></td>
                  <td><strong>{money(match.linked_amount)}</strong></td>
                  <td><span className={`bank-auto-confidence is-${match.confidence_level}`}>{confidenceLabel(match.confidence_level)} {Number(match.confidence_score || 0).toFixed(0)}</span></td>
                  <td>{match.confirmed_email || '-'}<small>{dateTime(match.confirmed_at)}</small></td>
                  <td>{match.status === 'confirmed' ? <span className="bank-auto-status is-confirmed">有效</span> : <span className="bank-auto-status is-reversed">已撤销</span>}{match.reverse_reason ? <small>{match.reverse_reason}</small> : null}</td>
                  <td>{match.status === 'confirmed' ? <button type="button" className="bank-auto-reverse" disabled={busyId === match.match_id} onClick={() => reverseMatch(match)}>{busyId === match.match_id ? '处理中…' : '撤销核销'}</button> : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bank-auto-method">
        <strong>匹配规则</strong>
        <p>金额与未结余额一致 +55；银行对方户名与合作方一致 +25；摘要命中账单编号 +35；交易月份在合理结算窗口 +3～10。只有高分且与第二候选拉开差距时才允许批量自动核销。</p>
        <p>当前 V2.3-1 按“一条银行流水 → 一张账单”处理；金额超过账单未结余额时不会自动拆分，避免误核销。</p>
      </section>
    </PageContainer>
  )
}
