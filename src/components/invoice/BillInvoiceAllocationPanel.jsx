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

export default function BillInvoiceAllocationPanel({ billType, billId, onChanged, showToast }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [amounts, setAmounts] = useState({})

  const load = useCallback(async () => {
    if (!billId) return
    setLoading(true)
    try {
      const next = await getBillInvoiceSummary(billType, String(billId))
      setSummary(next)
      setAmounts(Object.fromEntries(next.candidates.map((item) => [item.invoice.id, String(item.suggested_amount)])))
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
    () => [...(summary?.candidates || [])].sort((a, b) => b.match_score - a.match_score),
    [summary]
  )

  const linkInvoice = async (candidate) => {
    const raw = Number(amounts[candidate.invoice.id])
    if (!Number.isFinite(raw) || raw <= 0) {
      showToast?.('请输入正确的分配金额', 'error')
      return
    }
    setBusyId(candidate.invoice.id)
    try {
      await createBillInvoiceAllocation({
        bill_type: billType,
        bill_id: String(billId),
        invoice_id: candidate.invoice.id,
        allocated_gross_amount: raw,
        match_type: candidate.match_score > 0 ? 'suggested' : 'manual',
        match_score: candidate.match_score,
        match_reasons: candidate.match_reasons
      })
      showToast?.('发票已关联到账单', 'success')
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
                  <button type="button" disabled={busyId === item.id} onClick={() => void unlinkInvoice(item)}>
                    解除
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="bill-invoice-empty">当前账单还没有关联发票</p>}
      </section>

      <section className="bill-invoice-section">
        <div className="bill-invoice-section-head">
          <h3>可关联发票</h3><span>按匹配度排序</span>
        </div>
        {sortedCandidates.length ? (
          <div className="bill-invoice-list">
            {sortedCandidates.map((item) => (
              <div className="bill-invoice-candidate" key={item.invoice.id}>
                <div className="bill-invoice-candidate-main">
                  <strong>{item.invoice.number}</strong>
                  <span>{item.invoice.counterparty_name} · 可用 {money(item.available_amount)}</span>
                  <small>{item.match_reasons.length ? item.match_reasons.join('、') : '手工候选'}</small>
                </div>
                <div className="bill-invoice-link-action">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amounts[item.invoice.id] ?? ''}
                    onChange={(event) => setAmounts((prev) => ({ ...prev, [item.invoice.id]: event.target.value }))}
                    aria-label="分配金额"
                  />
                  <button type="button" disabled={busyId === item.invoice.id} onClick={() => void linkInvoice(item)}>
                    关联
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="bill-invoice-empty">没有可关联发票，请先到发票中心录入进项/销项发票。</p>}
      </section>
    </div>
  )
}
