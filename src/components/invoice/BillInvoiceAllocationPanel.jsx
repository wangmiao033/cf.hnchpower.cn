import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
  if (score >= 0.999) return { text: '100% 精确匹配', tone: 'exact' }
  if (score >= 0.8) return { text: `${Math.round(score * 100)}% 高匹配`, tone: 'high' }
  if (score >= 0.6) return { text: `${Math.round(score * 100)}% 可参考`, tone: 'medium' }
  return { text: `${Math.round(score * 100)}% 待核对`, tone: 'low' }
}

function matchReasons(candidate, billType, remainingAmount) {
  const reasons = [...(candidate?.match_reasons || [])]
  if (candidate?.invoice?.direction === expectedDirection(billType) && !reasons.includes('发票方向正确')) {
    reasons.push('发票方向正确')
  }
  if (Math.abs(Number(candidate?.available_amount || 0) - Number(remainingAmount || 0)) <= 0.01 && !reasons.some((reason) => String(reason).includes('金额'))) {
    reasons.push('金额精确一致')
  }
  return reasons
}

export default function BillInvoiceAllocationPanel({ billType, billId, onChanged, showToast }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [amounts, setAmounts] = useState({})
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [batchBusy, setBatchBusy] = useState(false)

  const load = useCallback(async () => {
    if (!billId) return
    setLoading(true)
    try {
      const next = await getBillInvoiceSummary(billType, String(billId))
      setSummary(next)
      setAmounts(Object.fromEntries(next.candidates.map((item) => [item.invoice.id, String(item.suggested_amount)])))
      setSelectedIds([])
    } catch (error) {
      console.error(error)
      showToast?.('无法加载账单发票信息', 'error')
    } finally {
      setLoading(false)
    }
  }, [billId, billType, showToast])

  useEffect(() => {
    void load()
  }, [load])

  const sortedCandidates = useMemo(
    () => [...(summary?.candidates || [])].sort((a, b) => {
      const scoreDiff = effectiveMatchScore(b, billType, summary?.remaining_amount) - effectiveMatchScore(a, billType, summary?.remaining_amount)
      if (Math.abs(scoreDiff) > 0.0001) return scoreDiff
      const amountDiffA = Math.abs(Number(a.available_amount || 0) - Number(summary?.remaining_amount || 0))
      const amountDiffB = Math.abs(Number(b.available_amount || 0) - Number(summary?.remaining_amount || 0))
      if (Math.abs(amountDiffA - amountDiffB) > 0.01) return amountDiffA - amountDiffB
      return String(b.invoice?.issue_date || '').localeCompare(String(a.invoice?.issue_date || ''))
    }),
    [summary, billType]
  )

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

  const linkInvoice = async (candidate) => {
    const raw = Number(amounts[candidate.invoice.id])
    if (!Number.isFinite(raw) || raw <= 0) {
      showToast?.('请输入正确的分配金额', 'error')
      return
    }
    if (raw > Number(candidate.available_amount || 0) + 0.01) {
      showToast?.(`本次关联不能超过发票可用金额 ${money(candidate.available_amount)}`, 'error')
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
      showToast?.(score >= 0.999 ? '100% 精确匹配，发票已关联到账单' : '发票已关联到账单', 'success')
      await load()
      onChanged?.()
    } catch (error) {
      console.error(error)
      showToast?.('关联失败，请检查发票剩余金额', 'error')
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
      showToast?.('解除关联失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  const toggleSelected = (invoiceId) => {
    const id = String(invoiceId)
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const selectAllCandidates = () => {
    setSelectedIds(sortedCandidates.map((item) => String(item.invoice.id)))
  }

  const selectExactCandidates = () => {
    const exactIds = sortedCandidates
      .filter((item) => effectiveMatchScore(item, billType, summary?.remaining_amount) >= 0.999)
      .map((item) => String(item.invoice.id))
    setSelectedIds(exactIds)
    if (!exactIds.length) showToast?.('当前没有100%精确匹配的候选发票', 'info')
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

  if (loading) return <div className="bill-invoice-loading">正在加载发票关联…</div>
  if (!summary) return <div className="bill-invoice-empty">暂时无法读取发票信息</div>

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

      <section className="bill-invoice-section">
        <div className="bill-invoice-section-head">
          <h3>已关联发票</h3><span>{summary.allocations.length} 张</span>
        </div>
        {summary.allocations.length ? (
          <div className="bill-invoice-list">
            {summary.allocations.map((item) => (
              <div className="bill-invoice-item" key={item.id}>
                <div>
                  <strong>{item.invoice.number}</strong>
                  <span>{item.invoice.counterparty_name} · {item.invoice.issue_date || '未填日期'}</span>
                </div>
                <div className="bill-invoice-item-amount">
                  <strong>{money(item.allocated_gross_amount)}</strong>
                  <button type="button" disabled={busyId === item.id || batchBusy} onClick={() => void unlinkInvoice(item)}>
                    解除
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="bill-invoice-empty">当前账单还没有关联发票</p>}
      </section>

      <section className="bill-invoice-section">
        <div className="bill-invoice-section-head bill-invoice-section-head--candidate">
          <div>
            <h3>可关联发票</h3>
            <span>按匹配度排序 · 金额显示区分“发票可用”和“本次关联”</span>
          </div>
          <div className="bill-invoice-batch-head-actions">
            {batchMode ? (
              <>
                <button type="button" onClick={selectExactCandidates} disabled={batchBusy}>选100%匹配</button>
                <button type="button" onClick={selectAllCandidates} disabled={batchBusy}>全选</button>
                <button type="button" onClick={exitBatchMode} disabled={batchBusy}>退出批量</button>
              </>
            ) : (
              <button type="button" className="is-primary" onClick={() => setBatchMode(true)} disabled={!sortedCandidates.length}>
                批量对账
              </button>
            )}
          </div>
        </div>

        {batchMode ? (
          <div className={`bill-invoice-batch-bar ${batchOverflow ? 'is-overflow' : ''}`}>
            <div>
              <strong>已选 {selectedCandidates.length} 张 · {money(selectedTotal)}</strong>
              <span>
                待关联 {money(summary.remaining_amount)} · {batchOverflow ? `超出 ${money(selectedTotal - summary.remaining_amount)}` : `关联后剩 ${money(batchRemaining)}`}
              </span>
            </div>
            <div>
              {selectedIds.length ? <button type="button" onClick={() => setSelectedIds([])} disabled={batchBusy}>清空选择</button> : null}
              <button
                type="button"
                className="is-primary"
                disabled={!selectedCandidates.length || batchOverflow || batchBusy}
                onClick={() => void batchLink()}
              >
                {batchBusy ? '批量关联中…' : `批量关联 ${selectedCandidates.length || ''} 张`}
              </button>
            </div>
          </div>
        ) : null}

        {sortedCandidates.length ? (
          <div className="bill-invoice-list">
            {sortedCandidates.map((item) => {
              const score = effectiveMatchScore(item, billType, summary.remaining_amount)
              const badge = matchLabel(score)
              const selected = selectedIds.includes(String(item.invoice.id))
              return (
                <div className={`bill-invoice-candidate ${selected ? 'is-selected' : ''}`} key={item.invoice.id}>
                  {batchMode ? (
                    <label className="bill-invoice-batch-check" title="选择参与批量对账">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={batchBusy}
                        onChange={() => toggleSelected(item.invoice.id)}
                      />
                    </label>
                  ) : null}
                  <div className="bill-invoice-candidate-main">
                    <div className="bill-invoice-candidate-title">
                      <strong>{item.invoice.number}</strong>
                      <em className={`is-${badge.tone}`}>{badge.text}</em>
                    </div>
                    <span>{item.invoice.counterparty_name}</span>
                    <div className="bill-invoice-candidate-money">
                      <span>发票可用 <b>{money(item.available_amount)}</b></span>
                      <span>本次建议 <b>{money(item.suggested_amount)}</b></span>
                    </div>
                    <small>{matchReasons(item, billType, summary.remaining_amount).length ? matchReasons(item, billType, summary.remaining_amount).join('、') : '手工候选'}</small>
                  </div>
                  <div className="bill-invoice-link-action">
                    <label>
                      <span>本次关联</span>
                      <input
                        type="number"
                        min="0.01"
                        max={Number(item.available_amount || 0)}
                        step="0.01"
                        value={amounts[item.invoice.id] ?? ''}
                        onChange={(event) => setAmounts((prev) => ({ ...prev, [item.invoice.id]: event.target.value }))}
                        aria-label="本次关联金额"
                        disabled={batchBusy}
                      />
                    </label>
                    {!batchMode ? (
                      <button type="button" disabled={busyId === item.invoice.id || batchBusy} onClick={() => void linkInvoice(item)}>
                        {busyId === item.invoice.id ? '关联中…' : '关联'}
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : <p className="bill-invoice-empty">没有可关联发票，请先到发票中心录入进项/销项发票。</p>}
      </section>
    </div>
  )
}
