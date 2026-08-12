import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  completeContractAdjustment,
  getContractDifferenceCase,
  handleContractDifferenceCase,
  listContractDifferenceCases
} from '@/lib/api/contractDifferences.ts'
import './ContractDifferenceActionPanel.css'

const STATUS_LABELS = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已解决'
}

const HANDLING_LABELS = {
  edit_bill: '待修改账单',
  accept_difference: '已接受差异',
  adjustment: '补差处理中',
  carry_forward: '待下月冲抵'
}

const REASON_OPTIONS = ['商务协商', '四舍五入', '历史遗留', '特殊活动', '其他']

function money(value) {
  const number = Number(value || 0)
  return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dateTime(value) {
  if (!value) return '-'
  return String(value).replace('T', ' ').slice(0, 19)
}

function directionText(item) {
  return item.variance_direction === 'under' ? '少结' : item.variance_direction === 'over' ? '多结' : '差异'
}

function emptyForm() {
  return {
    reasonType: '商务协商',
    description: '',
    owner: '',
    evidenceText: '',
    targetMonth: ''
  }
}

export default function ContractDifferenceActionPanel({
  billType,
  billId,
  onEditBill,
  onChanged
}) {
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [workingId, setWorkingId] = useState('')
  const [expandedId, setExpandedId] = useState('')
  const [detail, setDetail] = useState(null)
  const [editor, setEditor] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [completeForm, setCompleteForm] = useState({
    invoiceId: '',
    bankTransactionId: '',
    note: ''
  })
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (!billId) return
    setLoading(true)
    try {
      const result = await listContractDifferenceCases({ billType, billId, limit: 100 })
      setItems(result.items || [])
      setSummary(result.summary || null)
    } catch (error) {
      console.error(error)
      setMessage('差异处置记录读取失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [billId, billType])

  useEffect(() => {
    setItems([])
    setSummary(null)
    setExpandedId('')
    setDetail(null)
    setEditor(null)
    setForm(emptyForm())
    setMessage('')
    void load()
  }, [load])

  const loadDetail = useCallback(async (caseId) => {
    if (!caseId) {
      setDetail(null)
      return
    }
    try {
      const result = await getContractDifferenceCase(caseId)
      setDetail(result)
      const openAdjustment = (result.adjustments || []).find((item) => item.status === 'open')
      setCompleteForm({
        invoiceId: openAdjustment?.invoice_id || '',
        bankTransactionId: openAdjustment?.bank_transaction_id || '',
        note: openAdjustment?.reconciliation_note || ''
      })
    } catch (error) {
      console.error(error)
      setMessage('差异时间线读取失败。')
    }
  }, [])

  const toggleDetail = (caseId) => {
    if (expandedId === caseId) {
      setExpandedId('')
      setDetail(null)
      return
    }
    setExpandedId(caseId)
    void loadDetail(caseId)
  }

  const refreshAfterAction = async (caseId) => {
    await load()
    if (caseId && expandedId === caseId) await loadDetail(caseId)
    await onChanged?.()
  }

  const startEditor = (item, action) => {
    setEditor({ caseId: item.id, action })
    setForm({
      ...emptyForm(),
      owner: item.owner || '',
      description:
        action === 'create_adjustment'
          ? '合同应结与账单实际差异'
          : action === 'carry_forward'
            ? '本期差额转下月冲抵'
            : ''
    })
    setMessage('')
  }

  const submitEditor = async () => {
    if (!editor) return
    const { caseId, action } = editor
    const evidence = form.evidenceText
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
    setWorkingId(caseId)
    setMessage('')
    try {
      await handleContractDifferenceCase(caseId, {
        action,
        reason_type: form.reasonType,
        description: form.description,
        owner: form.owner,
        evidence,
        target_month: form.targetMonth
      })
      setEditor(null)
      setForm(emptyForm())
      setMessage(
        action === 'accept_difference'
          ? '差异已接受并留痕。'
          : action === 'create_adjustment'
            ? '补差单已生成。'
            : '已登记下月冲抵。'
      )
      await refreshAfterAction(caseId)
    } catch (error) {
      console.error(error)
      setMessage(error instanceof Error ? error.message : '差异处置失败。')
    } finally {
      setWorkingId('')
    }
  }

  const markEditBill = async (item) => {
    setWorkingId(item.id)
    setMessage('')
    try {
      await handleContractDifferenceCase(item.id, {
        action: 'edit_bill',
        owner: item.owner || '',
        description: '财务选择修改当前账单后重新核验合同金额。'
      })
      await refreshAfterAction(item.id)
      onEditBill?.()
    } catch (error) {
      console.error(error)
      setMessage(error instanceof Error ? error.message : '无法进入账单修改流程。')
    } finally {
      setWorkingId('')
    }
  }

  const reopen = async (item) => {
    setWorkingId(item.id)
    try {
      await handleContractDifferenceCase(item.id, {
        action: 'reopen',
        description: '重新打开合同差异。'
      })
      await refreshAfterAction(item.id)
    } catch (error) {
      console.error(error)
      setMessage(error instanceof Error ? error.message : '重新打开失败。')
    } finally {
      setWorkingId('')
    }
  }

  const openAdjustment = useMemo(
    () => (detail?.adjustments || []).find((item) => item.status === 'open') || null,
    [detail]
  )

  const completeAdjustment = async () => {
    if (!openAdjustment) return
    setWorkingId(detail.id)
    try {
      await completeContractAdjustment(openAdjustment.id, {
        invoice_id: completeForm.invoiceId,
        bank_transaction_id: completeForm.bankTransactionId,
        reconciliation_note: completeForm.note
      })
      setMessage('补差已完成，原合同差异已关闭。')
      await refreshAfterAction(detail.id)
    } catch (error) {
      console.error(error)
      setMessage(error instanceof Error ? error.message : '补差完成状态保存失败。')
    } finally {
      setWorkingId('')
    }
  }

  if (loading && !items.length) {
    return <section className="contract-difference-panel is-loading">正在读取合同差异处置状态…</section>
  }

  if (!items.length) {
    return null
  }

  return (
    <section className="contract-difference-panel">
      <header className="contract-difference-panel__head">
        <div>
          <span>V3.0 · 差异处置闭环</span>
          <h3>合同差异处理</h3>
          <p>系统负责算清楚和生成处理动作，不会自动修改账单历史金额。</p>
        </div>
        {summary ? (
          <div className="contract-difference-panel__summary">
            <strong>{summary.pending_count + summary.processing_count} 笔未闭环</strong>
            <small>处理中 {summary.processing_count} · 已解决 {summary.resolved_count}</small>
          </div>
        ) : null}
      </header>

      {message ? <div className="contract-difference-message">{message}</div> : null}

      <div className="contract-difference-list">
        {items.map((item) => {
          const isEditing = editor?.caseId === item.id
          const isExpanded = expandedId === item.id
          return (
            <article key={item.id} className={`contract-difference-card is-${item.status}`}>
              <div className="contract-difference-card__top">
                <div>
                  <span>{item.game_name || '账单明细'} · {item.settlement_cycle || '-'}</span>
                  <strong>{directionText(item)} {money(item.variance_abs)}</strong>
                  <small>
                    合同应结 {money(item.expected_amount)} · 账单实际 {money(item.actual_amount)}
                  </small>
                </div>
                <div className="contract-difference-card__status">
                  <em>{STATUS_LABELS[item.status] || item.status}</em>
                  {item.handling_type ? <small>{HANDLING_LABELS[item.handling_type] || item.handling_type}</small> : null}
                </div>
              </div>

              {item.reason_type || item.description || item.owner ? (
                <div className="contract-difference-card__trace">
                  {item.reason_type ? <span>原因：{item.reason_type}</span> : null}
                  {item.owner ? <span>负责人：{item.owner}</span> : null}
                  {item.description ? <span>{item.description}</span> : null}
                </div>
              ) : null}

              <div className="contract-difference-card__actions">
                {item.status === 'pending' ? (
                  <>
                    <button type="button" disabled={workingId === item.id} onClick={() => void markEditBill(item)}>修改当前账单</button>
                    <button type="button" disabled={workingId === item.id} onClick={() => startEditor(item, 'accept_difference')}>接受差异</button>
                    <button type="button" disabled={workingId === item.id} onClick={() => startEditor(item, 'create_adjustment')}>生成补差项</button>
                    <button type="button" disabled={workingId === item.id} onClick={() => startEditor(item, 'carry_forward')}>转下月冲抵</button>
                  </>
                ) : null}
                {item.status === 'resolved' ? (
                  <button type="button" className="is-muted" disabled={workingId === item.id} onClick={() => void reopen(item)}>重新打开</button>
                ) : null}
                <button type="button" className="is-muted" onClick={() => toggleDetail(item.id)}>
                  {isExpanded ? '收起处理记录' : '处理记录'}
                </button>
              </div>

              {isEditing ? (
                <div className="contract-difference-editor">
                  {editor.action === 'accept_difference' ? (
                    <label>
                      <span>原因类型</span>
                      <select value={form.reasonType} onChange={(event) => setForm((current) => ({ ...current, reasonType: event.target.value }))}>
                        {REASON_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {editor.action === 'carry_forward' ? (
                    <label>
                      <span>目标月份</span>
                      <input type="month" value={form.targetMonth} onChange={(event) => setForm((current) => ({ ...current, targetMonth: event.target.value }))} />
                    </label>
                  ) : null}
                  <label>
                    <span>负责人</span>
                    <input value={form.owner} onChange={(event) => setForm((current) => ({ ...current, owner: event.target.value }))} placeholder="例如：王淼 / 财务" />
                  </label>
                  <label className="is-wide">
                    <span>处理说明</span>
                    <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="说明为什么接受、补差或冲抵" />
                  </label>
                  <label className="is-wide">
                    <span>附件 / 聊天记录</span>
                    <textarea value={form.evidenceText} onChange={(event) => setForm((current) => ({ ...current, evidenceText: event.target.value }))} placeholder="每行一条：附件链接、聊天记录说明、文件编号等" />
                  </label>
                  <div className="contract-difference-editor__actions">
                    <button type="button" className="is-muted" onClick={() => setEditor(null)}>取消</button>
                    <button type="button" className="is-primary" disabled={workingId === item.id} onClick={() => void submitEditor()}>
                      {workingId === item.id ? '保存中…' : '确认处理'}
                    </button>
                  </div>
                </div>
              ) : null}

              {isExpanded && detail?.id === item.id ? (
                <div className="contract-difference-detail">
                  {(detail.adjustments || []).length ? (
                    <div className="contract-difference-adjustments">
                      <strong>补差项</strong>
                      {detail.adjustments.map((adjustment) => (
                        <div key={adjustment.id}>
                          <span>{adjustment.adjustment_no}</span>
                          <span>{adjustment.direction_label} {money(adjustment.amount)}</span>
                          <em>{adjustment.status === 'completed' ? '已完成' : '待核销'}</em>
                        </div>
                      ))}
                      {openAdjustment ? (
                        <div className="contract-difference-complete">
                          <label><span>发票 ID</span><input value={completeForm.invoiceId} onChange={(event) => setCompleteForm((current) => ({ ...current, invoiceId: event.target.value }))} /></label>
                          <label><span>银行流水 ID</span><input value={completeForm.bankTransactionId} onChange={(event) => setCompleteForm((current) => ({ ...current, bankTransactionId: event.target.value }))} /></label>
                          <label className="is-wide"><span>核销说明</span><input value={completeForm.note} onChange={(event) => setCompleteForm((current) => ({ ...current, note: event.target.value }))} /></label>
                          <button type="button" onClick={() => void completeAdjustment()} disabled={workingId === item.id}>完成补差并关闭差异</button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {(detail.carry_forwards || []).length ? (
                    <div className="contract-difference-carries">
                      <strong>下月冲抵</strong>
                      {detail.carry_forwards.map((carry) => (
                        <div key={carry.id}>
                          <span>{carry.source_month || '-'} → {carry.target_month}</span>
                          <span>{carry.direction === 'next_period_deduct' ? '下期扣减' : '下期补加'} {money(carry.amount)}</span>
                          <em>{carry.status === 'applied' ? '已完成' : '待冲抵'}</em>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="contract-difference-timeline">
                    <strong>差异处理时间线</strong>
                    {(detail.events || []).length ? detail.events.map((event) => (
                      <div key={event.id} className="contract-difference-timeline__item">
                        <span aria-hidden />
                        <div>
                          <strong>{event.title}</strong>
                          <p>{event.detail}</p>
                          <small>{dateTime(event.created_at)} · {event.actor || '系统'}</small>
                        </div>
                      </div>
                    )) : <p>暂无处理记录。</p>}
                  </div>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
