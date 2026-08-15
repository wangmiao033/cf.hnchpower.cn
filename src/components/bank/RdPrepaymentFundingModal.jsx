import React, { useEffect, useMemo, useState } from 'react'
import {
  allocateRdPrepaymentInvoice,
  createRdPrepaymentFunding,
  deleteRdPrepaymentFunding,
  deleteRdPrepaymentInvoiceAllocation,
  getRdPrepaymentBankContext
} from '@/lib/api/rdPrepayment.ts'
import './RdPrepaymentFundingModal.css'

function money(value) {
  const amount = Number(value || 0)
  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function RdPrepaymentFundingModal({ open, transaction, onClose, onSaved }) {
  const transactionId = String(transaction?.id || '')
  const preferredAccessItemId = String(transaction?.preferred_access_item_id || '')
  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [accessItemId, setAccessItemId] = useState('')
  const [fundingAmount, setFundingAmount] = useState('')
  const [note, setNote] = useState('')
  const [invoiceChoice, setInvoiceChoice] = useState({})
  const [invoiceAmount, setInvoiceAmount] = useState({})

  const load = async () => {
    if (!transactionId) return
    setLoading(true)
    setError('')
    try {
      const result = await getRdPrepaymentBankContext(transactionId)
      setContext(result)
      const candidates = result.candidates || []
      const preferred = preferredAccessItemId
        ? candidates.find((item) => String(item.access_item_id) === preferredAccessItemId)
        : null
      const currentExists = candidates.some((item) => String(item.access_item_id) === String(accessItemId))
      const next = preferred || (currentExists
        ? candidates.find((item) => String(item.access_item_id) === String(accessItemId))
        : candidates.find((item) => item.recommended && Number(item.max_fundable_amount || 0) > 0) || candidates.find((item) => Number(item.max_fundable_amount || 0) > 0) || candidates[0])
      if (next) setAccessItemId(String(next.access_item_id))
    } catch (err) {
      setError(err instanceof Error ? err.message : '预付款信息读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !transactionId) return
    setContext(null)
    setAccessItemId('')
    setFundingAmount('')
    setNote('')
    setInvoiceChoice({})
    setInvoiceAmount({})
    void load()
  }, [open, transactionId, preferredAccessItemId])

  const candidates = context?.candidates || []
  const selected = useMemo(
    () => candidates.find((item) => String(item.access_item_id) === String(accessItemId)) || null,
    [candidates, accessItemId]
  )
  const bankRemaining = Number(context?.transaction?.prepayment_available_amount || 0)
  const poolRemaining = Number(selected?.max_fundable_amount || 0)
  const maxFunding = Math.max(0, Math.min(bankRemaining, poolRemaining))

  useEffect(() => {
    if (!selected) return
    const current = Number(fundingAmount || 0)
    if (!fundingAmount || current <= 0 || current > maxFunding) {
      setFundingAmount(maxFunding > 0 ? String(maxFunding.toFixed(2)) : '')
    }
  }, [accessItemId, maxFunding])

  if (!open) return null

  const applyContext = (result) => {
    setContext(result)
    setError('')
    onSaved?.(result)
  }

  const createFunding = async () => {
    if (!selected || busy) return
    const amount = Number(fundingAmount || 0)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('请输入有效的预付款入账金额')
      return
    }
    setBusy('create')
    setError('')
    try {
      const result = await createRdPrepaymentFunding({
        bank_transaction_id: transactionId,
        access_item_id: String(selected.access_item_id),
        funded_amount: amount,
        note: note.trim()
      })
      applyContext(result)
      setFundingAmount('')
      setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '预付款登记失败')
    } finally {
      setBusy('')
    }
  }

  const removeFunding = async (funding) => {
    if (busy) return
    if (!window.confirm(`确认解除 ${funding.product_name || '该产品'} ${money(funding.funded_amount)} 的预付款银行入账吗？`)) return
    setBusy(`funding:${funding.id}`)
    try {
      applyContext(await deleteRdPrepaymentFunding(String(funding.id)))
    } catch (err) {
      setError(err instanceof Error ? err.message : '解除预付款失败')
    } finally {
      setBusy('')
    }
  }

  const linkInvoice = async (funding) => {
    if (busy) return
    const invoiceId = invoiceChoice[funding.id]
    const amount = Number(invoiceAmount[funding.id] || 0)
    if (!invoiceId) {
      setError('请先选择进项发票')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('请输入有效的发票关联金额')
      return
    }
    setBusy(`invoice:${funding.id}`)
    try {
      const result = await allocateRdPrepaymentInvoice(String(funding.id), { invoice_id: invoiceId, allocated_amount: amount })
      applyContext(result)
      setInvoiceChoice((current) => ({ ...current, [funding.id]: '' }))
      setInvoiceAmount((current) => ({ ...current, [funding.id]: '' }))
    } catch (err) {
      setError(err instanceof Error ? err.message : '发票关联失败')
    } finally {
      setBusy('')
    }
  }

  const unlinkInvoice = async (funding, allocation) => {
    if (busy) return
    if (!window.confirm(`解除发票 ${allocation.invoice_no} 的 ${money(allocation.allocated_amount)} 关联吗？`)) return
    setBusy(`invoice-delete:${allocation.id}`)
    try {
      applyContext(await deleteRdPrepaymentInvoiceAllocation(String(funding.id), String(allocation.id)))
    } catch (err) {
      setError(err instanceof Error ? err.message : '解除发票关联失败')
    } finally {
      setBusy('')
    }
  }

  const chooseInvoice = (funding, invoiceId) => {
    setInvoiceChoice((current) => ({ ...current, [funding.id]: invoiceId }))
    const invoice = (context?.invoice_candidates || []).find((item) => String(item.id) === String(invoiceId))
    const suggested = Math.min(Number(funding.invoice_unallocated_amount || 0), Number(invoice?.remaining_amount || 0))
    setInvoiceAmount((current) => ({ ...current, [funding.id]: suggested > 0 ? suggested.toFixed(2) : '' }))
  }

  const tx = context?.transaction
  const fundings = context?.fundings || []
  const invoices = context?.invoice_candidates || []

  return (
    <div className="rd-prepay-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose?.() }}>
      <section className="rd-prepay-modal" role="dialog" aria-modal="true" aria-label="研发预付款银行入账">
        <header className="rd-prepay-modal__head">
          <div><span>研发预付款 · 银行事实入账</span><h2>{tx?.payee_name || transaction?.payee_name || '银行支出流水'}</h2><p>{tx?.trade_date || '-'} · {tx?.transaction_no || '无流水号'} · {tx?.summary || '无摘要'}</p></div>
          <button type="button" disabled={Boolean(busy)} onClick={onClose}>×</button>
        </header>

        {loading && !context ? <div className="rd-prepay-modal__loading">正在读取合同、银行预付款与发票台账…</div> : null}
        {error ? <div className="rd-prepay-modal__error">{error}</div> : null}

        {context ? (
          <>
            <div className="rd-prepay-modal__bank-summary">
              <div><span>本笔银行支出</span><strong>{money(tx.expense_amount)}</strong></div>
              <div><span>已登记预付款</span><strong>{money(tx.prepayment_allocated_amount)}</strong></div>
              <div><span>尚可分配</span><strong>{money(tx.prepayment_available_amount)}</strong></div>
              <div className={tx.regular_reconciliation_linked ? 'is-warning' : ''}><span>普通账单核销</span><strong>{tx.regular_reconciliation_linked ? '已占用' : '未占用'}</strong></div>
            </div>

            {fundings.length ? (
              <section className="rd-prepay-modal__section">
                <div className="rd-prepay-modal__section-head"><div><h3>已登记预付款</h3><p>这里的金额已经成为该研发产品真实可追溯的预付款资金来源。</p></div><em>{fundings.length} 条</em></div>
                <div className="rd-prepay-modal__fundings">
                  {fundings.map((funding) => {
                    const pool = candidates.find((item) => String(item.access_item_id) === String(funding.access_item_id))
                    return (
                      <article key={funding.id} className="rd-prepay-funding-card">
                        <div className="rd-prepay-funding-card__title"><div><strong>{funding.product_name || pool?.product_name || '未命名产品'}</strong><span>{funding.contract_name || pool?.contract_name || '未命名合同'}</span></div><b>{money(funding.funded_amount)}</b></div>
                        <div className="rd-prepay-funding-card__metrics">
                          <div><span>合同预付</span><strong>{money(pool?.prepayment_agreed_amount)}</strong></div>
                          <div><span>银行已付</span><strong>{money(pool?.actual_funded_amount)}</strong></div>
                          <div><span>已抵扣</span><strong>{money(pool?.deducted_amount)}</strong></div>
                          <div><span>当前可用</span><strong>{money(pool?.available_balance)}</strong></div>
                        </div>
                        {Number(pool?.funding_shortfall || 0) > 0 ? <div className="rd-prepay-funding-card__warning">历史已抵扣比当前已关联银行资金多 {money(pool.funding_shortfall)}，请继续补齐历史预付款流水。</div> : null}
                        <div className="rd-prepay-funding-card__invoice-list">
                          {(funding.invoice_allocations || []).map((allocation) => (
                            <span key={allocation.id}>发票 {allocation.invoice_no} · {money(allocation.allocated_amount)}<button type="button" disabled={Boolean(busy)} onClick={() => void unlinkInvoice(funding, allocation)}>×</button></span>
                          ))}
                          {!funding.invoice_allocations?.length ? <small>尚未关联进项发票</small> : null}
                        </div>
                        {Number(funding.invoice_unallocated_amount || 0) > 0.01 ? (
                          <div className="rd-prepay-funding-card__invoice-link">
                            <select value={invoiceChoice[funding.id] || ''} onChange={(event) => chooseInvoice(funding, event.target.value)}>
                              <option value="">选择进项发票</option>
                              {invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_no} · {invoice.seller_name || '未填销方'} · 可用 {money(invoice.remaining_amount)}</option>)}
                            </select>
                            <input type="number" min="0" step="0.01" value={invoiceAmount[funding.id] || ''} onChange={(event) => setInvoiceAmount((current) => ({ ...current, [funding.id]: event.target.value }))} placeholder="关联金额" />
                            <button type="button" disabled={Boolean(busy)} onClick={() => void linkInvoice(funding)}>{busy === `invoice:${funding.id}` ? '关联中…' : '关联发票'}</button>
                          </div>
                        ) : null}
                        <div className="rd-prepay-funding-card__foot"><span>发票已覆盖 {money(funding.invoice_allocated_amount)} / {money(funding.funded_amount)}</span><button type="button" className="is-danger" disabled={Boolean(busy)} onClick={() => void removeFunding(funding)}>{busy === `funding:${funding.id}` ? '处理中…' : '解除银行入账'}</button></div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ) : null}

            <section className="rd-prepay-modal__section">
              <div className="rd-prepay-modal__section-head"><div><h3>登记到研发产品</h3><p>只有合同合作清单里配置了“预付款（抵扣研发结算）”的产品才会出现在这里。</p></div></div>
              {tx.regular_reconciliation_linked ? <div className="rd-prepay-modal__blocked">这笔流水已经核销普通账单，不能再重复登记为预付款。</div> : null}
              <div className="rd-prepay-modal__form">
                <label><span>预付款产品</span><select value={accessItemId} onChange={(event) => setAccessItemId(event.target.value)} disabled={tx.regular_reconciliation_linked}><option value="">请选择</option>{candidates.map((item) => <option key={item.access_item_id} value={item.access_item_id} disabled={Number(item.max_fundable_amount || 0) <= 0}>{item.recommended ? '★ ' : ''}{item.product_name || '未命名产品'} · {item.contract_name || '未命名合同'} · 尚可入账 {money(item.max_fundable_amount)}</option>)}</select></label>
                {selected ? <div className="rd-prepay-modal__pool"><div><span>合同约定</span><strong>{money(selected.prepayment_agreed_amount)}</strong></div><div><span>银行已付</span><strong>{money(selected.actual_funded_amount)}</strong></div><div><span>累计抵扣</span><strong>{money(selected.deducted_amount)}</strong></div><div><span>当前可用</span><strong>{money(selected.available_balance)}</strong></div></div> : null}
                <label><span>本次登记金额</span><input type="number" min="0" step="0.01" value={fundingAmount} onChange={(event) => setFundingAmount(event.target.value)} disabled={tx.regular_reconciliation_linked || !selected} /><small>本次最多 {money(maxFunding)}（受银行未分配金额和合同剩余预付款双重限制）</small></label>
                <label><span>备注（可选）</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：合同首笔预付款 / 第二期预付" /></label>
                <button type="button" className="rd-prepay-modal__primary" disabled={Boolean(busy) || tx.regular_reconciliation_linked || !selected || maxFunding <= 0} onClick={() => void createFunding()}>{busy === 'create' ? '登记中…' : '确认登记预付款'}</button>
              </div>
            </section>

            <footer className="rd-prepay-modal__hint">发票这里只建立“预付款资金凭证”关联；研发月度账单的发票覆盖仍按完整研发应结金额独立核算，不会被预付款抵扣冲掉。</footer>
          </>
        ) : null}
      </section>
    </div>
  )
}
