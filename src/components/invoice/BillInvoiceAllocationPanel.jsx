import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import {
  createBillInvoiceAllocation,
  getBillInvoiceSummary,
  reverseBillInvoiceAllocation
} from '@/lib/api/billInvoiceAllocations.ts'
import './BillInvoiceAllocationPanel.css'

function money(value) {
  return `¥ ${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

const COVERAGE_LABEL = {
  none: '未关联',
  partial: '部分覆盖',
  complete: '已覆盖',
  over: '超额'
}

function expectedDirection(billType) {
  return billType === 'rd' ? 'input' : 'output'
}

function effectiveMatchScore(candidate, billType, remainingAmount) {
  const reasons = candidate?.match_reasons || []
  const counterpartyMatched = reasons.some((reason) => String(reason).includes('往来单位匹配'))
  const directionMatched = candidate?.invoice?.direction === expectedDirection(billType)
  const amountMatched = Math.abs(Number(candidate?.available_amount || 0) - Number(remainingAmount || 0)) <= 0.01
  if (counterpartyMatched && directionMatched && amountMatched) return 1
  return Math.max(0, Math.min(1, Number(candidate?.match_score || 0)))
}

function matchLabel(score) {
  if (score >= 0.999) return { text: '100% 精确匹配', short: '精确匹配', tone: 'exact' }
  if (score >= 0.8) return { text: `${Math.round(score * 100)}% 高度匹配`, short: '高度匹配', tone: 'high' }
  if (score >= 0.6) return { text: `${Math.round(score * 100)}% 可参考`, short: '可参考', tone: 'medium' }
  return { text: `${Math.round(score * 100)}% 待核对`, short: '待核对', tone: 'low' }
}

function matchReasons(candidate, billType, remainingAmount) {
  const reasons = [...(candidate?.match_reasons || [])]
  if (candidate?.invoice?.direction === expectedDirection(billType) && !reasons.includes('发票方向正确')) {
    reasons.push('发票方向正确')
  }
  if (
    Math.abs(Number(candidate?.available_amount || 0) - Number(remainingAmount || 0)) <= 0.01 &&
    !reasons.some((reason) => String(reason).includes('金额'))
  ) {
    reasons.push('金额精确一致')
  }
  return [...new Set(reasons)]
}

function candidateNote(candidate, score, remainingAmount) {
  const available = Number(candidate?.available_amount || 0)
  const remaining = Number(remainingAmount || 0)
  if (score >= 0.999) return '金额、往来单位和发票方向均一致，可直接关联。'
  if (available > remaining + 0.01) return `发票可用金额大于账单待关联金额，可部分关联 ${money(remaining)}。`
  if (available + 0.01 < remaining) return `关联后账单仍剩 ${money(Math.max(0, remaining - available))}，可继续匹配其他发票。`
  if (score < 0.6) return '匹配度较低，建议核对往来单位、金额和开票信息后再关联。'
  return '系统已按往来单位、金额和账期排序，建议确认后关联。'
}

export default function BillInvoiceAllocationPanel({ billType, billId, onChanged, showToast }) {
  const { setActiveView } = useAppState()
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [amounts, setAmounts] = useState({})
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [batchBusy, setBatchBusy] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)

  const load = useCallback(async () => {
    if (!billId) return
    setLoading(true)
    setLoadError('')
    try {
      const next = await getBillInvoiceSummary(billType, String(billId))
      setSummary(next)
      setAmounts(Object.fromEntries(
        (next.candidates || []).map((item) => [item.invoice.id, String(item.suggested_amount)])
      ))
      setSelectedIds([])
    } catch (error) {
      console.error(error)
      setLoadError(error instanceof Error ? error.message : '发票匹配读取失败')
      showToast?.('无法加载账单发票信息', 'error')
    } finally {
      setLoading(false)
    }
  }, [billId, billType, showToast])

  useEffect(() => {
    setBatchMode(false)
    setSelectedIds([])
    setManualOpen(false)
    void load()
  }, [billId, billType, load])

  const sortedCandidates = useMemo(
    () => [...(summary?.candidates || [])].sort((a, b) => {
      const scoreDiff = effectiveMatchScore(b, billType, summary?.remaining_amount) -
        effectiveMatchScore(a, billType, summary?.remaining_amount)
      if (Math.abs(scoreDiff) > 0.0001) return scoreDiff
      const amountDiffA = Math.abs(Number(a.available_amount || 0) - Number(summary?.remaining_amount || 0))
      const amountDiffB = Math.abs(Number(b.available_amount || 0) - Number(summary?.remaining_amount || 0))
      if (Math.abs(amountDiffA - amountDiffB) > 0.01) return amountDiffA - amountDiffB
      return String(b.invoice?.issue_date || '').localeCompare(String(a.invoice?.issue_date || ''))
    }),
    [summary, billType]
  )

  const visibleSmartCandidates = batchMode ? sortedCandidates : sortedCandidates.slice(0, 6)
  const selectedCandidates = useMemo(
    () => sortedCandidates.filter((item) => selectedIds.includes(String(item.invoice.id))),
    [sortedCandidates, selectedIds]
  )

  const selectedTotal = useMemo(
    () => selectedCandidates.reduce((sum, item) => {
      const raw = Number(amounts[item.invoice.id] || 0)
      return sum + (Number.isFinite(raw) && raw > 0 ? raw : 0)
    }, 0),
    [selectedCandidates, amounts]
  )

  const batchOverflow = selectedTotal > Number(summary?.remaining_amount || 0) + 0.01
  const batchRemaining = Math.max(0, Number(summary?.remaining_amount || 0) - selectedTotal)

  const applySelection = useCallback((requestedIds) => {
    const wanted = new Set(requestedIds.map(String))
    let remaining = Math.max(0, Number(summary?.remaining_amount || 0))
    const nextIds = []
    const nextAmounts = { ...amounts }
    for (const candidate of sortedCandidates) {
      const id = String(candidate.invoice.id)
      if (!wanted.has(id) || remaining <= 0.01) continue
      const planned = Math.min(Number(candidate.available_amount || 0), remaining)
      if (planned <= 0.01) continue
      nextIds.push(id)
      nextAmounts[id] = planned.toFixed(2)
      remaining = Math.max(0, remaining - planned)
    }
    setSelectedIds(nextIds)
    setAmounts(nextAmounts)
  }, [amounts, sortedCandidates, summary?.remaining_amount])

  const linkInvoice = async (candidate, overrideAmount = null) => {
    const raw = overrideAmount == null
      ? Number(amounts[candidate.invoice.id])
      : Number(overrideAmount)
    if (!Number.isFinite(raw) || raw <= 0) {
      showToast?.('请输入正确的关联金额', 'error')
      return
    }
    if (raw > Number(candidate.available_amount || 0) + 0.01) {
      showToast?.(`本次关联不能超过发票可用金额 ${money(candidate.available_amount)}`, 'error')
      return
    }
    if (raw > Number(summary?.remaining_amount || 0) + 0.01) {
      showToast?.(`本次关联不能超过账单待关联金额 ${money(summary?.remaining_amount)}`, 'error')
      return
    }
    const score = effectiveMatchScore(candidate, billType, summary?.remaining_amount)
    setBusyId(candidate.invoice.id)
    try {
      await createBillInvoiceAllocation({
        bill_type: billType,
        bill_id: String(billId),
        invoice_id: candidate.invoice.id,
        allocated_gross_amount: raw,
        match_type: score >= 0.999 ? 'exact' : score > 0 ? 'suggested' : 'manual',
        match_score: score,
        match_reasons: matchReasons(candidate, billType, summary?.remaining_amount)
      })
      showToast?.(
        score >= 0.999
          ? `100% 精确匹配，已关联 ${money(raw)}`
          : `发票已关联到账单 ${money(raw)}`,
        'success'
      )
      await load()
      onChanged?.()
    } catch (error) {
      console.error(error)
      showToast?.(error instanceof Error ? error.message : '关联失败，请检查发票剩余金额', 'error')
    } finally {
      setBusyId('')
    }
  }

  const unlinkInvoice = async (allocation) => {
    setBusyId(allocation.id)
    try {
      await reverseBillInvoiceAllocation(allocation.id)
      showToast?.('已解除发票关联', 'success')
      await load()
      onChanged?.()
    } catch (error) {
      console.error(error)
      showToast?.(error instanceof Error ? error.message : '解除关联失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  const toggleSelected = (invoiceId) => {
    const id = String(invoiceId)
    const requested = selectedIds.includes(id)
      ? selectedIds.filter((item) => item !== id)
      : [...selectedIds, id]
    applySelection(requested)
  }

  const selectAllCandidates = () => {
    applySelection(sortedCandidates.map((item) => String(item.invoice.id)))
  }

  const selectExactCandidates = () => {
    const exactIds = sortedCandidates
      .filter((item) => effectiveMatchScore(item, billType, summary?.remaining_amount) >= 0.999)
      .map((item) => String(item.invoice.id))
    if (!exactIds.length) {
      showToast?.('当前没有100%精确匹配的候选发票', 'info')
      return
    }
    applySelection(exactIds)
  }

  const exitBatchMode = () => {
    setBatchMode(false)
    setSelectedIds([])
  }

  const batchLink = async () => {
    if (!selectedCandidates.length || batchBusy) {
      showToast?.('请先选择要关联的发票', 'error')
      return
    }
    if (batchOverflow) {
      showToast?.(`已选金额超过待关联金额 ${money(summary?.remaining_amount)}，请调整关联金额`, 'error')
      return
    }

    const prepared = []
    for (const candidate of selectedCandidates) {
      const raw = Number(amounts[candidate.invoice.id])
      if (!Number.isFinite(raw) || raw <= 0) {
        showToast?.(`发票 ${candidate.invoice.number} 的关联金额不正确`, 'error')
        return
      }
      if (raw > Number(candidate.available_amount || 0) + 0.01) {
        showToast?.(`发票 ${candidate.invoice.number} 超过可用金额 ${money(candidate.available_amount)}`, 'error')
        return
      }
      const score = effectiveMatchScore(candidate, billType, summary?.remaining_amount)
      prepared.push({ candidate, raw, score })
    }

    const exactCount = prepared.filter((item) => item.score >= 0.999).length
    const confirmed = window.confirm(
      `确认批量关联 ${prepared.length} 张发票吗？\n\n` +
      `本次关联：${money(selectedTotal)}\n` +
      `其中100%精确匹配：${exactCount} 张\n` +
      `关联后账单剩余：${money(batchRemaining)}`
    )
    if (!confirmed) return

    setBatchBusy(true)
    let success = 0
    let failed = 0
    let firstError = ''
    for (const { candidate, raw, score } of prepared) {
      try {
        await createBillInvoiceAllocation({
          bill_type: billType,
          bill_id: String(billId),
          invoice_id: candidate.invoice.id,
          allocated_gross_amount: raw,
          match_type: score >= 0.999 ? 'exact' : score > 0 ? 'suggested' : 'manual',
          match_score: score,
          match_reasons: matchReasons(candidate, billType, summary?.remaining_amount)
        })
        success += 1
      } catch (error) {
        failed += 1
        if (!firstError) firstError = error instanceof Error ? error.message : '关联失败'
      }
    }

    try {
      await load()
      onChanged?.()
      if (failed) {
        showToast?.(`批量对账完成：成功 ${success} 张，失败 ${failed} 张${firstError ? ` · ${firstError}` : ''}`, 'info')
      } else {
        showToast?.(`批量对账完成：已关联 ${success} 张发票，共 ${money(selectedTotal)}`, 'success')
        setBatchMode(false)
      }
    } finally {
      setBatchBusy(false)
    }
  }

  const openInvoiceCenter = () => {
    setActiveView?.(billType === 'rd' ? VIEWS.INVOICE_INPUT : VIEWS.INVOICE_MANAGE)
  }

  if (!summary && loading) {
    return (
      <div className="bill-invoice-panel">
        <section className="bill-invoice-smart-section">
          <div className="bill-invoice-smart-head">
            <div><h3>发票智能匹配</h3><p>正在从发票中心筛选未关联或未完全关联的发票。</p></div>
            <span className="bill-invoice-match-status is-loading">匹配中…</span>
          </div>
          <div className="bill-invoice-match-loading">
            <span />
            <div><strong>正在匹配发票</strong><small>核对往来单位、金额、发票方向与账期…</small></div>
          </div>
          <button type="button" className="bill-invoice-center-button" onClick={openInvoiceCenter}>去发票中心查看</button>
        </section>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="bill-invoice-panel">
        <section className="bill-invoice-smart-section">
          <div className="bill-invoice-smart-head"><div><h3>发票智能匹配</h3><p>暂时无法读取匹配结果。</p></div></div>
          <div className="bill-invoice-match-empty is-error">
            <strong>发票匹配读取失败</strong><span>{loadError || '请稍后重试'}</span>
            <button type="button" onClick={() => void load()}>重新匹配</button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="bill-invoice-panel">
      <div className="bill-invoice-summary">
        <article><span>账单金额</span><strong>{money(summary.bill_amount)}</strong></article>
        <article><span>已关联</span><strong>{money(summary.allocated_amount)}</strong></article>
        <article><span>待关联</span><strong>{money(summary.remaining_amount)}</strong></article>
        <article className={`is-${summary.coverage_status}`}>
          <span>{COVERAGE_LABEL[summary.coverage_status]}</span>
          <strong>{summary.coverage_percent.toFixed(1)}%</strong>
        </article>
      </div>

      <section className="bill-invoice-smart-section">
        <div className="bill-invoice-smart-head">
          <div>
            <h3>发票智能匹配</h3>
            <p>系统从发票中心未关联或未完全关联的发票中，按匹配度自动排序。</p>
          </div>
          <div className="bill-invoice-smart-head-actions">
            <span className={`bill-invoice-match-status ${loading ? 'is-loading' : 'is-ready'}`}>
              {loading ? '匹配中…' : `找到 ${sortedCandidates.length} 张候选`}
            </span>
            <button type="button" onClick={() => void load()} disabled={loading || batchBusy}>重新匹配</button>
          </div>
        </div>

        {summary.allocations.length ? (
          <div className="bill-invoice-linked-block">
            <div className="bill-invoice-linked-block-head">
              <div><strong>已关联发票</strong><span>{summary.allocations.length} 张 · {money(summary.allocated_amount)}</span></div>
            </div>
            {summary.allocations.slice(0, 3).map((item) => (
              <div className="bill-invoice-linked-row" key={item.id}>
                <div>
                  <strong>{item.invoice.number}</strong>
                  <span>{item.invoice.counterparty_name} · {item.invoice.issue_date || '未填日期'}</span>
                </div>
                <div>
                  <b>{money(item.allocated_gross_amount)}</b>
                  <button type="button" disabled={busyId === item.id || batchBusy} onClick={() => void unlinkInvoice(item)}>
                    {busyId === item.id ? '处理中…' : '解除'}
                  </button>
                </div>
              </div>
            ))}
            {summary.allocations.length > 3 ? <small>另有 {summary.allocations.length - 3} 张已关联发票。</small> : null}
          </div>
        ) : null}

        {loading ? (
          <div className="bill-invoice-match-loading">
            <span />
            <div><strong>正在重新匹配发票</strong><small>核对往来单位、金额、发票方向与账期…</small></div>
          </div>
        ) : null}

        {!loading && loadError ? (
          <div className="bill-invoice-match-empty is-error">
            <strong>发票匹配读取失败</strong><span>{loadError}</span>
            <button type="button" onClick={() => void load()}>重试</button>
          </div>
        ) : null}

        {batchMode ? (
          <div className={`bill-invoice-batch-bar ${batchOverflow ? 'is-overflow' : ''}`}>
            <div>
              <strong>已选 {selectedCandidates.length} 张 · {money(selectedTotal)}</strong>
              <span>
                待关联 {money(summary.remaining_amount)} · {batchOverflow
                  ? `超出 ${money(selectedTotal - summary.remaining_amount)}`
                  : `关联后剩 ${money(batchRemaining)}`}
              </span>
            </div>
            <div>
              <button type="button" onClick={selectExactCandidates} disabled={batchBusy}>选100%匹配</button>
              <button type="button" onClick={selectAllCandidates} disabled={batchBusy}>智能全选</button>
              {selectedIds.length ? <button type="button" onClick={() => applySelection([])} disabled={batchBusy}>清空</button> : null}
              <button
                type="button"
                className="is-primary"
                disabled={!selectedCandidates.length || batchOverflow || batchBusy}
                onClick={() => void batchLink()}
              >
                {batchBusy ? '批量关联中…' : `批量关联 ${selectedCandidates.length || ''} 张`}
              </button>
              <button type="button" onClick={exitBatchMode} disabled={batchBusy}>退出批量</button>
            </div>
          </div>
        ) : null}

        {!loading && !loadError && visibleSmartCandidates.length ? (
          <div className="bill-invoice-smart-list">
            {visibleSmartCandidates.map((item) => {
              const score = effectiveMatchScore(item, billType, summary.remaining_amount)
              const badge = matchLabel(score)
              const reasons = matchReasons(item, billType, summary.remaining_amount)
              const selected = selectedIds.includes(String(item.invoice.id))
              const smartAmount = Math.min(Number(item.suggested_amount || 0), Number(summary.remaining_amount || 0))
              return (
                <article className={`bill-invoice-smart-card is-${badge.tone} ${selected ? 'is-selected' : ''}`} key={item.invoice.id}>
                  <div className="bill-invoice-smart-card-head">
                    {batchMode ? (
                      <label className="bill-invoice-batch-check" title="选择参与批量对账">
                        <input type="checkbox" checked={selected} disabled={batchBusy} onChange={() => toggleSelected(item.invoice.id)} />
                      </label>
                    ) : null}
                    <div>
                      <strong>{item.invoice.number}</strong>
                      <span>{item.invoice.counterparty_name} · {item.invoice.issue_date || '未填日期'}</span>
                    </div>
                    <em className={`bill-invoice-match-badge is-${badge.tone}`}>{badge.text}</em>
                  </div>

                  <div className="bill-invoice-smart-amounts">
                    <span>发票可用<b>{money(item.available_amount)}</b></span>
                    <span>本次建议<strong>{money(smartAmount)}</strong></span>
                  </div>

                  <div className="bill-invoice-match-reasons">
                    {reasons.slice(0, 4).map((reason) => <span key={reason}>{reason}</span>)}
                  </div>
                  <div className={`bill-invoice-match-note is-${badge.tone}`}>{candidateNote(item, score, summary.remaining_amount)}</div>

                  {batchMode ? (
                    <div className="bill-invoice-smart-batch-amount">
                      <label>
                        <span>本次关联金额</span>
                        <input
                          type="number"
                          min="0.01"
                          max={Number(item.available_amount || 0)}
                          step="0.01"
                          value={amounts[item.invoice.id] ?? ''}
                          onChange={(event) => setAmounts((prev) => ({ ...prev, [item.invoice.id]: event.target.value }))}
                          disabled={!selected || batchBusy}
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="bill-invoice-smart-card-actions">
                      <button
                        type="button"
                        className="is-primary"
                        disabled={busyId === item.invoice.id || batchBusy || smartAmount <= 0.01}
                        onClick={() => void linkInvoice(item, smartAmount)}
                      >
                        {busyId === item.invoice.id ? '关联中…' : `确认关联发票 ${money(smartAmount)}`}
                      </button>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        ) : null}

        {!loading && !loadError && !visibleSmartCandidates.length ? (
          <div className="bill-invoice-match-empty">
            <strong>暂未找到可关联发票</strong>
            <span>可能尚未录入发票，或现有发票已经全部关联完成。</span>
          </div>
        ) : null}

        <div className="bill-invoice-smart-footer">
          <button type="button" className="bill-invoice-center-button" onClick={openInvoiceCenter}>去发票中心查看</button>
          {sortedCandidates.length && summary.remaining_amount > 0.01 ? (
            <>
              {!batchMode ? <button type="button" className="bill-invoice-batch-trigger" onClick={() => setBatchMode(true)}>批量对账</button> : null}
              <button type="button" className="bill-invoice-manual-trigger" onClick={() => setManualOpen((value) => !value)}>
                {manualOpen ? '收起手工关联' : '没有合适推荐？手工关联'}
              </button>
            </>
          ) : null}
        </div>
      </section>

      {sortedCandidates.length && summary.remaining_amount > 0.01 ? (
        <details
          className="bill-invoice-manual-details"
          open={manualOpen}
          onToggle={(event) => setManualOpen(event.currentTarget.open)}
        >
          <summary>
            <span><strong>手工关联发票</strong><small>需要自定义金额或查看全部候选时使用</small></span>
            <b>{manualOpen ? '收起' : '展开'}</b>
          </summary>
          <div className="bill-invoice-manual-body">
            <div className="bill-invoice-manual-warning">
              智能匹配优先。手工关联仍会校验发票方向、发票可用金额和账单待关联金额，不能超额关联。
            </div>
            <div className="bill-invoice-manual-list">
              {sortedCandidates.map((item) => {
                const score = effectiveMatchScore(item, billType, summary.remaining_amount)
                const badge = matchLabel(score)
                return (
                  <div className="bill-invoice-manual-row" key={item.invoice.id}>
                    <div>
                      <strong>{item.invoice.number}</strong>
                      <span>{item.invoice.counterparty_name} · 可用 {money(item.available_amount)}</span>
                      <small>{badge.text} · {matchReasons(item, billType, summary.remaining_amount).join('、') || '手工候选'}</small>
                    </div>
                    <div>
                      <label><span>本次关联</span><input
                        type="number"
                        min="0.01"
                        max={Number(item.available_amount || 0)}
                        step="0.01"
                        value={amounts[item.invoice.id] ?? ''}
                        onChange={(event) => setAmounts((prev) => ({ ...prev, [item.invoice.id]: event.target.value }))}
                        disabled={batchBusy}
                      /></label>
                      <button type="button" disabled={busyId === item.invoice.id || batchBusy} onClick={() => void linkInvoice(item)}>
                        {busyId === item.invoice.id ? '关联中…' : '关联'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </details>
      ) : null}
    </div>
  )
}
