import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createBillInvoiceAllocation,
  getInvoiceBillSummary,
  reverseBillInvoiceAllocation
} from '@/lib/api/billInvoiceAllocations.ts'

const COVERAGE_LABEL = {
  none: '未关联',
  partial: '部分关联',
  complete: '已全部关联',
  over: '关联超额'
}

function money(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function billTypeLabel(type) {
  return type === 'rd' ? '研发账单' : '渠道账单'
}

function billSearchText(item) {
  const bill = item?.bill || {}
  return [bill.number, bill.partner_name, bill.game_name, bill.settlement_month]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('zh-CN')
}

export default function InvoiceBillAllocationPanel({ invoiceId, onChanged, onOpenBill, showToast }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [amounts, setAmounts] = useState({})
  const [keyword, setKeyword] = useState('')

  const load = useCallback(async () => {
    if (!invoiceId) return
    setLoading(true)
    try {
      const next = await getInvoiceBillSummary(String(invoiceId))
      setSummary(next)
      setAmounts(
        Object.fromEntries(
          next.candidates.map((item) => [
            `${item.bill.bill_type}:${item.bill.bill_id}`,
            String(item.suggested_amount)
          ])
        )
      )
    } catch (error) {
      console.error(error)
      showToast?.('无法加载发票的账单关联信息', 'error')
    } finally {
      setLoading(false)
    }
  }, [invoiceId, showToast])

  useEffect(() => {
    void load()
  }, [load])

  const candidates = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase('zh-CN')
    const list = summary?.candidates || []
    if (!normalized) return list
    return list.filter((item) => billSearchText(item).includes(normalized))
  }, [keyword, summary])

  const linkBill = async (candidate) => {
    const key = `${candidate.bill.bill_type}:${candidate.bill.bill_id}`
    const amount = Number(amounts[key])
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast?.('请输入正确的关联金额', 'error')
      return
    }
    setBusyId(key)
    try {
      await createBillInvoiceAllocation({
        bill_type: candidate.bill.bill_type,
        bill_id: candidate.bill.bill_id,
        invoice_id: String(invoiceId),
        allocated_gross_amount: amount,
        match_type: candidate.match_score > 0 ? 'suggested' : 'manual',
        match_score: candidate.match_score,
        match_reasons: candidate.match_reasons
      })
      showToast?.('发票已关联到账单', 'success')
      await load()
      onChanged?.()
    } catch (error) {
      console.error(error)
      showToast?.('关联失败，请检查发票或账单的剩余金额', 'error')
    } finally {
      setBusyId('')
    }
  }

  const unlinkBill = async (allocation) => {
    setBusyId(allocation.id)
    try {
      await reverseBillInvoiceAllocation(allocation.id)
      showToast?.('已解除账单关联', 'success')
      await load()
      onChanged?.()
    } catch (error) {
      console.error(error)
      showToast?.('解除关联失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  if (loading) return <div className="invoice-bill-panel__loading">正在读取账单关联…</div>
  if (!summary) return <div className="invoice-bill-panel__empty">暂时无法读取账单关联</div>

  return (
    <div className="invoice-bill-panel">
      <div className="invoice-bill-panel__summary">
        <article>
          <span>发票价税合计</span>
          <strong>{money(summary.invoice_amount)}</strong>
        </article>
        <article>
          <span>已关联金额</span>
          <strong>{money(summary.allocated_amount)}</strong>
        </article>
        <article>
          <span>待关联金额</span>
          <strong>{money(summary.remaining_amount)}</strong>
        </article>
        <article className={`is-${summary.coverage_status}`}>
          <span>{COVERAGE_LABEL[summary.coverage_status]}</span>
          <strong>{Number(summary.coverage_percent || 0).toFixed(1)}%</strong>
        </article>
      </div>

      <section className="invoice-bill-panel__section">
        <div className="invoice-bill-panel__section-head">
          <div>
            <h3>已关联账单</h3>
            <p>一张发票可以按金额拆分关联多张账单</p>
          </div>
          <span>{summary.allocations.length} 笔</span>
        </div>
        {summary.allocations.length ? (
          <div className="invoice-bill-panel__list">
            {summary.allocations.map((item) => (
              <article className="invoice-bill-card" key={item.id}>
                <div className="invoice-bill-card__main">
                  <div className="invoice-bill-card__title">
                    <span className={`invoice-bill-card__type is-${item.bill_type}`}>
                      {billTypeLabel(item.bill_type)}
                    </span>
                    <strong>{item.bill.number}</strong>
                  </div>
                  <p>{item.bill.partner_name} · {item.bill.settlement_month || '未填账期'}</p>
                  {item.bill.game_name ? <small>{item.bill.game_name}</small> : null}
                </div>
                <div className="invoice-bill-card__action">
                  <strong>{money(item.allocated_gross_amount)}</strong>
                  {onOpenBill ? (
                    <button
                      type="button"
                      className="rec-btn rec-btn--secondary rec-btn--xs"
                      onClick={() => onOpenBill(item.bill)}
                    >
                      查看账单
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rec-btn rec-btn--ghost rec-btn--xs"
                    disabled={busyId === item.id}
                    onClick={() => void unlinkBill(item)}
                  >
                    解除关联
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="invoice-bill-panel__empty invoice-bill-panel__empty--compact">
            还没有关联账单，可从下方推荐结果中选择
          </div>
        )}
      </section>

      <section className="invoice-bill-panel__section">
        <div className="invoice-bill-panel__section-head invoice-bill-panel__section-head--search">
          <div>
            <h3>推荐关联</h3>
            <p>按往来单位、金额和账期自动排序</p>
          </div>
          <input
            type="search"
            className="admin-input invoice-bill-panel__search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索账单号、客户或账期"
            aria-label="搜索可关联账单"
          />
        </div>
        {summary.remaining_amount <= 0.01 ? (
          <div className="invoice-bill-panel__complete">该发票金额已全部关联，无需继续分配。</div>
        ) : candidates.length ? (
          <div className="invoice-bill-panel__list">
            {candidates.map((item) => {
              const key = `${item.bill.bill_type}:${item.bill.bill_id}`
              return (
                <article className="invoice-bill-card invoice-bill-card--candidate" key={key}>
                  <div className="invoice-bill-card__main">
                    <div className="invoice-bill-card__title">
                      <span className={`invoice-bill-card__type is-${item.bill.bill_type}`}>
                        {billTypeLabel(item.bill.bill_type)}
                      </span>
                      <strong>{item.bill.number}</strong>
                    </div>
                    <p>{item.bill.partner_name} · {item.bill.settlement_month || '未填账期'}</p>
                    <small>
                      待覆盖 {money(item.available_amount)}
                      {item.match_reasons.length ? ` · ${item.match_reasons.join(' / ')}` : ' · 手工匹配'}
                    </small>
                  </div>
                  <div className="invoice-bill-card__link">
                    <label>
                      <span>本次关联</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        max={Math.min(item.available_amount, summary.remaining_amount)}
                        value={amounts[key] ?? ''}
                        onChange={(event) => setAmounts((prev) => ({ ...prev, [key]: event.target.value }))}
                        aria-label={`关联金额：${item.bill.number}`}
                      />
                    </label>
                    <button
                      type="button"
                      className="rec-btn rec-btn--primary rec-btn--sm"
                      disabled={busyId === key}
                      onClick={() => void linkBill(item)}
                    >
                      确认关联
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="invoice-bill-panel__empty invoice-bill-panel__empty--compact">
            {keyword ? '没有匹配的账单' : '暂无已完成核对且可关联的账单'}
          </div>
        )}
      </section>
    </div>
  )
}
