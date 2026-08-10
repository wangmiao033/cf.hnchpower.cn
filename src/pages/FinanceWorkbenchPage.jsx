import React, { useCallback, useEffect, useMemo, useState } from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { getBillInvoiceSummary } from '@/lib/api/billInvoiceAllocations.ts'
import {
  completeFinanceInvoiceTask,
  getFinanceTaskSummary,
  listFinanceInvoiceTasks,
  rejectFinanceInvoiceTask,
  startFinanceInvoiceTask
} from '@/lib/api/financeTasks.ts'
import './FinanceWorkbenchPage.css'

const STATUS_TABS = [
  ['all', '全部任务'],
  ['pending', '待开票'],
  ['processing', '开票中'],
  ['completed', '已完成'],
  ['rejected', '已驳回']
]

function money(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

function statusLabel(status) {
  return { pending: '待开票', processing: '开票中', completed: '已开票', rejected: '已驳回' }[status] || status
}

function FinanceWorkbenchPage() {
  const { user } = useAuth()
  const { showToast, setActiveView, openBill360 } = useAppState()
  const [status, setStatus] = useState('all')
  const [summary, setSummary] = useState(null)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState(null)
  const [billSummary, setBillSummary] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [invoiceId, setInvoiceId] = useState('')
  const [allocatedAmount, setAllocatedAmount] = useState('')
  const [busy, setBusy] = useState('')

  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([getFinanceTaskSummary(), listFinanceInvoiceTasks(status)])
      .then(([summaryRow, list]) => {
        if (cancelled) return
        setSummary(summaryRow)
        setTasks(list.items || [])
      })
      .catch((error) => {
        if (!cancelled) showToast(error instanceof Error ? error.message : '财务任务读取失败', 'error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [revision, showToast, status])

  useEffect(() => {
    if (!selected) {
      setBillSummary(null)
      setInvoiceId('')
      setAllocatedAmount('')
      return
    }
    let cancelled = false
    setDetailLoading(true)
    getBillInvoiceSummary(selected.bill_type, selected.bill_id)
      .then((value) => {
        if (cancelled) return
        setBillSummary(value)
        const candidate = value.candidates?.[0]
        if (candidate) {
          setInvoiceId(candidate.invoice.id)
          setAllocatedAmount(String(Math.min(
            Number(selected.requested_amount || 0),
            Number(candidate.available_amount || 0),
            Number(value.remaining_amount || 0)
          ).toFixed(2)))
        } else {
          setInvoiceId('')
          setAllocatedAmount('')
        }
      })
      .catch(() => {
        if (!cancelled) setBillSummary(null)
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => { cancelled = true }
  }, [selected, revision])

  const selectedCandidate = useMemo(
    () => billSummary?.candidates?.find((item) => String(item.invoice.id) === String(invoiceId)) || null,
    [billSummary, invoiceId]
  )

  const handleStart = async (task) => {
    setBusy(task.id)
    try {
      const updated = await startFinanceInvoiceTask(task.id)
      showToast(`已领取 ${task.task_no}`, 'success')
      setSelected(updated)
      refresh()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '领取任务失败', 'error')
    } finally {
      setBusy('')
    }
  }

  const handleReject = async (task) => {
    const reason = window.prompt('请输入驳回原因，业务会看到这条说明：', '') || ''
    if (reason.trim().length < 2) return
    if (!window.confirm('确认驳回这条开票任务吗？业务需要修正后重新提交。')) return
    setBusy(task.id)
    try {
      await rejectFinanceInvoiceTask(task.id, reason.trim())
      showToast('开票任务已驳回', 'success')
      setSelected(null)
      refresh()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '驳回失败', 'error')
    } finally {
      setBusy('')
    }
  }

  const handleComplete = async () => {
    if (!selected || !invoiceId) return showToast('请先选择已录入的销项发票', 'error')
    const amount = Number(allocatedAmount)
    if (!Number.isFinite(amount) || amount <= 0) return showToast('请输入有效关联金额', 'error')
    if (!window.confirm(`确认用该销项发票完成任务？\n\n本次关联：${money(amount)}\n完成后会自动关联回来源账单。`)) return
    setBusy(selected.id)
    try {
      await completeFinanceInvoiceTask(selected.id, { invoice_id: invoiceId, allocated_amount: amount })
      showToast('开票任务已完成，发票已自动关联到账单', 'success')
      setSelected(null)
      refresh()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '完成任务失败', 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <PageContainer hideHeader className="finance-workbench-page">
      <section className="finance-workbench-head">
        <div>
          <span>FINANCE OPERATIONS</span>
          <h1>财务工作台</h1>
          <p>{user?.display_name || user?.email || '财务'} · 业务确认后的开票任务统一在这里处理。</p>
        </div>
        <div className="finance-workbench-head__actions">
          <button type="button" onClick={() => setActiveView(VIEWS.INVOICE_MANAGE)}>销项发票</button>
          <button type="button" onClick={() => setActiveView(VIEWS.BANK_RECONCILIATION)}>银行中心</button>
          <button type="button" className="is-primary" onClick={refresh}>刷新任务</button>
        </div>
      </section>

      <section className="finance-workbench-metrics">
        <article className="is-pending"><span>待开票</span><strong>{summary?.pending_count || 0} 笔</strong><small>{money(summary?.pending_amount)}</small></article>
        <article className="is-processing"><span>开票中</span><strong>{summary?.processing_count || 0} 笔</strong><small>{money(summary?.processing_amount)}</small></article>
        <article className="is-completed"><span>已完成</span><strong>{summary?.completed_count || 0} 笔</strong><small>{money(summary?.completed_amount)}</small></article>
        <article className="is-rejected"><span>已驳回</span><strong>{summary?.rejected_count || 0} 笔</strong><small>{money(summary?.rejected_amount)}</small></article>
      </section>

      <section className="finance-task-card">
        <header>
          <div><span>开票任务</span><h2>业务提交给财务的待办</h2></div>
          <nav>{STATUS_TABS.map(([key, label]) => <button type="button" key={key} className={status === key ? 'is-active' : ''} onClick={() => setStatus(key)}>{label}</button>)}</nav>
        </header>
        <div className="finance-task-table-wrap">
          <table className="finance-task-table">
            <thead><tr><th>任务</th><th>合作方</th><th>账期 / 产品</th><th className="is-right">申请金额</th><th>提交人</th><th>处理人</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan="8" className="finance-task-empty">正在读取财务任务…</td></tr> : null}
              {!loading && tasks.length === 0 ? <tr><td colSpan="8" className="finance-task-empty">当前没有任务。</td></tr> : null}
              {!loading && tasks.map((task) => (
                <tr key={task.id}>
                  <td><strong>{task.task_no}</strong><small>{task.bill_number || task.bill_id}<br />{formatTime(task.submitted_at)}</small></td>
                  <td><strong>{task.partner_name || '未填写合作方'}</strong></td>
                  <td>{task.settlement_month || '—'}<small>{task.game_name || '—'}</small></td>
                  <td className="is-right"><strong>{money(task.requested_amount)}</strong>{task.allocated_amount > 0 ? <small>已关联 {money(task.allocated_amount)}</small> : null}</td>
                  <td>{task.submitted_by_name || task.submitted_by_email || '—'}</td>
                  <td>{task.assigned_to_name || <span className="finance-muted">未领取</span>}</td>
                  <td><span className={`finance-task-status is-${task.status}`}>{statusLabel(task.status)}</span>{task.reject_reason ? <small title={task.reject_reason}>{task.reject_reason}</small> : null}</td>
                  <td><div className="finance-task-actions">
                    <button type="button" onClick={() => setSelected(task)}>详情</button>
                    {task.status === 'pending' ? <button type="button" className="is-primary" disabled={busy === task.id} onClick={() => void handleStart(task)}>领取处理</button> : null}
                    {task.status === 'processing' ? <button type="button" className="is-primary" onClick={() => setSelected(task)}>继续处理</button> : null}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <div className="finance-task-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}>
          <aside className="finance-task-drawer" role="dialog" aria-modal="true" aria-label="开票任务详情">
            <header>
              <div><span>{selected.task_no}</span><h2>{selected.partner_name || '开票任务'}</h2><p>来源账单 {selected.bill_number || selected.bill_id} · {money(selected.requested_amount)}</p></div>
              <button type="button" onClick={() => setSelected(null)}>×</button>
            </header>
            <main>
              <section className="finance-task-facts">
                <div><span>任务状态</span><strong>{statusLabel(selected.status)}</strong></div>
                <div><span>账期</span><strong>{selected.settlement_month || '—'}</strong></div>
                <div><span>提交人</span><strong>{selected.submitted_by_name || selected.submitted_by_email || '—'}</strong></div>
                <div><span>处理人</span><strong>{selected.assigned_to_name || '尚未领取'}</strong></div>
              </section>

              <section className="finance-task-source">
                <header><div><span>开票依据</span><h3>已核对渠道账单</h3></div><button type="button" onClick={() => openBill360?.(selected.bill_type, selected.bill_id)}>查看账单360</button></header>
                <p>{selected.game_name || '未填写产品'} · 申请开票 {money(selected.requested_amount)}</p>
              </section>

              {selected.status === 'completed' ? (
                <section className="finance-task-success"><strong>已完成开票</strong><span>关联金额 {money(selected.allocated_amount)} · 发票 {selected.invoice_id || '—'}</span><small>{formatTime(selected.completed_at)}</small></section>
              ) : selected.status === 'rejected' ? (
                <section className="finance-task-rejected"><strong>已驳回</strong><span>{selected.reject_reason || '未填写原因'}</span></section>
              ) : (
                <section className="finance-task-process">
                  <header><div><span>实际发票</span><h3>录票后完成并自动关联</h3></div><button type="button" onClick={() => setActiveView(VIEWS.INVOICE_CREATE)}>＋ 录入销项发票</button></header>
                  {detailLoading ? <div className="finance-task-loading">正在查找可关联销项发票…</div> : null}
                  {!detailLoading && !billSummary?.candidates?.length ? <div className="finance-task-hint">暂未找到可关联的销项发票。先点击“录入销项发票”，保存后回到这里刷新即可。</div> : null}
                  {billSummary?.candidates?.length ? (
                    <>
                      <label><span>选择已开销项发票</span><select value={invoiceId} onChange={(event) => {
                        const nextId = event.target.value
                        setInvoiceId(nextId)
                        const candidate = billSummary.candidates.find((item) => String(item.invoice.id) === nextId)
                        if (candidate) setAllocatedAmount(String(Math.min(Number(selected.requested_amount || 0), Number(candidate.available_amount || 0), Number(billSummary.remaining_amount || 0)).toFixed(2)))
                      }}><option value="">请选择</option>{billSummary.candidates.map((candidate) => <option key={candidate.invoice.id} value={candidate.invoice.id}>{candidate.invoice.number} · {candidate.invoice.counterparty_name} · 可分配 {money(candidate.available_amount)}</option>)}</select></label>
                      {selectedCandidate ? <div className="finance-task-candidate"><span>{selectedCandidate.invoice.number}</span><strong>{money(selectedCandidate.invoice.gross_amount)}</strong><small>{selectedCandidate.match_reasons?.join(' · ') || '候选销项发票'}</small></div> : null}
                      <label><span>本次关联金额</span><input type="number" step="0.01" min="0.01" value={allocatedAmount} onChange={(event) => setAllocatedAmount(event.target.value)} /></label>
                    </>
                  ) : null}
                </section>
              )}
            </main>
            {selected.status === 'pending' || selected.status === 'processing' ? (
              <footer>
                <button type="button" className="is-danger" disabled={busy === selected.id} onClick={() => void handleReject(selected)}>驳回资料</button>
                {selected.status === 'pending' ? <button type="button" disabled={busy === selected.id} onClick={() => void handleStart(selected)}>领取任务</button> : null}
                <button type="button" className="is-primary" disabled={busy === selected.id || !invoiceId} onClick={() => void handleComplete()}>{busy === selected.id ? '处理中…' : '完成开票并关联'}</button>
              </footer>
            ) : null}
          </aside>
        </div>
      ) : null}
    </PageContainer>
  )
}

export default FinanceWorkbenchPage
