import React, { useEffect, useRef, useState } from 'react'
import { createBillInvoiceAllocation, getInvoiceBillSummary } from '@/lib/api/billInvoiceAllocations.ts'
import './InvoiceMatchPreview.css'

const money = value => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const keyOf = item => `${item.invoice_id}:${item.bill_type}:${item.bill_id}`
const findCandidate = (summary, item) => summary.candidates.find(candidate => candidate.bill.bill_type === item.bill_type && String(candidate.bill.bill_id) === String(item.bill_id))
const isCurrent = (summary, candidate, item) => candidate && Number(item.allocated_gross_amount) > 0 &&
  Number(summary.remaining_amount) + 0.001 >= Number(item.allocated_gross_amount) &&
  Number(candidate.available_amount) + 0.001 >= Number(item.allocated_gross_amount)

export default function InvoiceMatchPreview({ preview, onClose }) {
  const items = preview.items || []
  const [details, setDetails] = useState({})
  const [selected, setSelected] = useState(new Set())
  const [results, setResults] = useState({})
  const [busy, setBusy] = useState(false)
  const [finished, setFinished] = useState(false)
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  const closeButton = useRef(null)
  const dialog = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButton.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus?.() }
  }, [])
  useEffect(() => {
    let active = true
    let next = 0
    async function worker() {
      while (next < items.length && active) {
        const item = items[next++]
        try {
          const summary = await getInvoiceBillSummary(String(item.invoice_id))
          const candidate = findCandidate(summary, item)
          if (active) setDetails(old => ({ ...old, [keyOf(item)]: isCurrent(summary, candidate, item)
            ? { summary, candidate } : { error: '可用金额或推荐账单已变化，请重新扫描' } }))
        } catch {
          if (active) setDetails(old => ({ ...old, [keyOf(item)]: { error: '账单详情读取失败，请关闭后重新扫描' } }))
        }
      }
    }
    for (let i = 0; i < Math.min(5, items.length); i++) void worker()
    return () => { active = false }
  }, [preview])
  const available = items.filter(item => details[keyOf(item)]?.candidate)
  const chosen = items.filter(item => selected.has(keyOf(item)))
  const total = chosen.reduce((sum, item) => sum + Number(item.allocated_gross_amount), 0)
  const toggle = key => setSelected(old => { const next = new Set(old); next.has(key) ? next.delete(key) : next.add(key); return next })
  async function confirm() {
    if (lock.current || !chosen.length || finished) return
    lock.current = true
    setBusy(true)
    let completed = 0
    for (const item of chosen) {
      const key = keyOf(item)
      try {
        // Recheck capacity, but never replace the invoice, bill or reviewed amount.
        const latest = await getInvoiceBillSummary(String(item.invoice_id))
        const current = findCandidate(latest, item)
        const reviewed = details[key]?.candidate?.bill
        const sameBillDetails = reviewed && ['partner_name', 'game_name', 'settlement_month', 'gross_amount'].every(field => current?.bill[field] === reviewed[field])
        if (!isCurrent(latest, current, item) || !sameBillDetails) throw new Error('changed')
        await createBillInvoiceAllocation({ invoice_id: item.invoice_id, bill_type: item.bill_type, bill_id: item.bill_id,
          allocated_gross_amount: item.allocated_gross_amount, match_type: 'suggested', match_score: item.match_score, match_reasons: item.match_reasons })
        completed++
        setResults(old => ({ ...old, [key]: '已关联' }))
      } catch {
        setResults(old => ({ ...old, [key]: '未确认成功，请重新核查' }))
        setNotice(`已确认成功 ${completed} 张。本张数据发生变化或请求失败，后续未执行；请关闭后重新扫描核查，避免重复提交。`)
        break
      }
    }
    if (completed === chosen.length) setNotice(`已按预览关联 ${completed} 张发票，合计 ${money(total)}。未勾选的发票未处理。`)
    setBusy(false)
    setFinished(true)
    lock.current = false
  }
  function trapFocus(event) {
    if (event.key === 'Escape' && !busy) { onClose(); return }
    if (event.key !== 'Tab') return
    const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
    const first = controls[0], last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  return <div className="invoice-preview-backdrop">
    <section ref={dialog} className="invoice-preview" role="dialog" aria-modal="true" aria-labelledby="invoice-preview-title" onKeyDown={trapFocus}>
      <header><div><h2 id="invoice-preview-title">核对扫描匹配结果</h2><p>扫描只生成建议。核对目标账单和金额，勾选后才会关联。</p></div><button ref={closeButton} type="button" disabled={busy} onClick={onClose}>关闭</button></header>
      <div className="invoice-preview-summary">可推荐 {items.length} 张 · 存在歧义 {preview.ambiguous || 0} 张 · 未匹配 {preview.unmatched || 0} 张 · 跳过 {preview.skipped || 0} 张</div>
      <div className="invoice-preview-scroll">
        <label className="invoice-preview-select-all"><input type="checkbox" disabled={busy || finished || !available.length} checked={available.length > 0 && available.every(item => selected.has(keyOf(item)))} onChange={event => setSelected(new Set(event.target.checked ? available.map(keyOf) : []))} />全选已加载且可关联的建议</label>
        {!items.length && <p>没有可直接关联的唯一匹配，请在发票详情中人工核对账单。</p>}
        {items.map(item => {
          const key = keyOf(item), detail = details[key], bill = detail?.candidate?.bill
          const invoice = preview.invoices?.find(record => String(record.id) === String(item.invoice_id))
          const partner = invoice?.invoiceDirection === 'input' ? invoice.sellerName : invoice?.buyerName || invoice?.title
          return <article className="invoice-preview-item" key={key}>
            <div className="invoice-preview-item-head"><label><input type="checkbox" aria-label={`选择匹配 ${item.invoice_number}`} checked={selected.has(key)} disabled={busy || finished || !bill} onChange={() => toggle(key)} />发票 {item.invoice_number}</label><strong>{results[key] || `推荐度 ${Math.round(Number(item.match_score) * 100)}%`}</strong></div>
            <div className="invoice-preview-comparison">
              <div><h3>发票信息</h3><strong>{partner || '未填写往来单位'}</strong><p>开票日期：{invoice?.issueDate || '—'}</p><p>价税合计：{money(invoice?.amountWithTax ?? detail?.summary?.invoice_amount)}</p><p>当前待关联：{detail?.summary ? money(detail.summary.remaining_amount) : detail?.error ? '无法读取' : '读取中…'}</p></div>
              <div><h3>拟关联{item.bill_type === 'rd' ? '研发' : '渠道'}账单</h3><strong>{bill?.partner_name || '正在核对账单详情…'}</strong><p>账单号：{item.bill_number}</p><p>账期：{bill?.settlement_month || '—'} · 游戏：{bill?.game_name || '—'}</p><p>账单金额：{bill ? money(bill.gross_amount) : '—'} · 待覆盖：{bill ? money(detail.candidate.available_amount) : '—'}</p></div>
              <div className="invoice-preview-amount"><span>本次拟关联</span><strong>{money(item.allocated_gross_amount)}</strong><small>仅提交此账单与此金额</small></div>
            </div>
            <div className="invoice-preview-reasons"><b>推荐依据</b>{(item.match_reasons || []).map((reason, index) => <span key={index}>{reason}</span>)}{!item.match_reasons?.length && <span>扫描未提供理由，请人工核对</span>}</div>
            {detail?.error && <p className="invoice-preview-error" role="alert">{detail.error}</p>}
          </article>
        })}
      </div>
      <footer><div aria-live="polite">{notice || `已选 ${chosen.length} 张 · 拟关联合计 ${money(total)}`}</div><button type="button" className="invoice-preview-confirm" disabled={busy || finished || !chosen.length} onClick={() => void confirm()}>{busy ? '正在关联，请勿重复操作…' : `确认所选 ${chosen.length} 张`}</button></footer>
    </section>
  </div>
}
