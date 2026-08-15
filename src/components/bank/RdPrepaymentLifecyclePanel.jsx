import React, { useEffect, useMemo, useState } from 'react'
import {
  createRdPrepaymentInstallment,
  deleteRdPrepaymentInstallment,
  freezeRdPrepaymentPool,
  getRdPrepaymentLifecycleDetail,
  markRdPrepaymentInstallmentInvoiceReady,
  registerRdPrepaymentRefund,
  releaseRdPrepaymentInvoices,
  saveRdPrepaymentLifecycleSettings,
  triggerRdPrepaymentInstallment,
  unfreezeRdPrepaymentPool
} from '@/lib/api/rdPrepaymentLifecycle.ts'
import './RdPrepaymentLifecyclePanel.css'

function money(value) {
  const amount = Number(value || 0)
  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function todayText() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

const TRIGGER_LABELS = {
  manual: '手动确认',
  contract_effective: '合同生效',
  game_launch: '游戏正式上线',
  fixed_date: '指定日期',
  other: '其他条件'
}

const EMPTY_INSTALLMENT = {
  installment_name: '',
  planned_amount: '',
  trigger_type: 'manual',
  trigger_note: '',
  payment_due_days: '5',
  requires_invoice: true
}

export default function RdPrepaymentLifecyclePanel({ accessItemId, canManage, onChanged }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY_INSTALLMENT)
  const [settings, setSettings] = useState({ strict_mode: false, display_name: '研发预付款', invoice_policy: 'separate' })

  const load = async () => {
    if (!accessItemId) return
    setLoading(true)
    setError('')
    try {
      const result = await getRdPrepaymentLifecycleDetail(accessItemId)
      setDetail(result)
      setSettings({
        strict_mode: Boolean(result.pool?.strict_mode),
        display_name: result.pool?.display_name || '研发预付款',
        invoice_policy: result.pool?.invoice_policy || 'separate'
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '履约信息读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [accessItemId])

  const pool = detail?.pool || {}
  const remainingPlanAmount = useMemo(
    () => Math.max(0, Number(pool.prepayment_agreed_amount || 0) - Number(pool.plan_total || 0)),
    [pool.prepayment_agreed_amount, pool.plan_total]
  )

  const mutate = async (task) => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const result = await task()
      if (result?.pool) setDetail(result)
      else if (result?.detail?.pool) setDetail(result.detail)
      else await load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setSaving(false)
    }
  }

  const saveSettings = () => mutate(() => saveRdPrepaymentLifecycleSettings(accessItemId, settings))

  const addInstallment = () => {
    const amount = Number(form.planned_amount || 0)
    if (!(amount > 0)) {
      setError('请填写本期预付金额')
      return
    }
    void mutate(async () => {
      const result = await createRdPrepaymentInstallment(accessItemId, {
        ...form,
        planned_amount: amount,
        payment_due_days: Number(form.payment_due_days || 0)
      })
      setForm(EMPTY_INSTALLMENT)
      return result
    })
  }

  const triggerInstallment = (item) => {
    const triggerDate = window.prompt('请输入实际触发日期（YYYY-MM-DD）', todayText())
    if (!triggerDate) return
    void mutate(() => triggerRdPrepaymentInstallment(item.id, triggerDate))
  }

  const markInvoiceReady = (item) => {
    const reference = window.prompt('填写已取得的发票号码/凭证说明（可留空）', item.invoice_reference || '')
    if (reference === null) return
    void mutate(() => markRdPrepaymentInstallmentInvoiceReady(item.id, reference))
  }

  const removeInstallment = (item) => {
    if (!window.confirm(`确定删除「${item.installment_name || `第${item.installment_no}期`}」吗？`)) return
    void mutate(async () => {
      await deleteRdPrepaymentInstallment(item.id)
      return getRdPrepaymentLifecycleDetail(accessItemId)
    })
  }

  const freezePool = () => {
    const reason = window.prompt('填写冻结原因', '合同终止 / 预付款退款处理')
    if (!reason) return
    if (!window.confirm(`冻结后将停止继续抵扣，当前预计待退 ${money(Math.max(0, Number(pool.actual_funded_amount || 0) - Number(pool.deducted_amount || 0) - Number(pool.refunded_amount || 0)))}。确定继续吗？`)) return
    void mutate(() => freezeRdPrepaymentPool(accessItemId, reason))
  }

  const unfreezePool = () => {
    if (!window.confirm('确定解除冻结并恢复后续预付款抵扣吗？')) return
    void mutate(() => unfreezeRdPrepaymentPool(accessItemId))
  }

  const registerRefund = (candidate) => {
    const suggested = Number(candidate.suggested_refund_amount || 0)
    const raw = window.prompt('登记本次退款金额', String(suggested.toFixed(2)))
    if (raw === null) return
    const amount = Number(raw)
    if (!(amount > 0)) return
    void mutate(() => registerRdPrepaymentRefund(accessItemId, {
      bank_transaction_id: candidate.id,
      refund_amount: amount,
      note: '预付款退款银行收入核销'
    }))
  }

  const releaseInvoices = () => {
    if (!window.confirm('将预付款阶段已取得的发票按历史抵扣金额释放到对应研发账单。确定执行吗？')) return
    void mutate(() => releaseRdPrepaymentInvoices(accessItemId))
  }

  if (loading && !detail) return <div className="rd-prepay-life-loading">正在读取合同预付履约计划…</div>
  if (!detail) return <div className="rd-prepay-life-error">{error || '履约信息暂不可用'}</div>

  const installments = detail.installments || []
  const refunds = detail.refunds || []
  const candidates = detail.refund_candidates || []
  const releases = detail.invoice_releases || []

  return (
    <section className="rd-prepay-life-panel">
      <header className="rd-prepay-life-title">
        <div>
          <span>V3.2 · CONTRACT PERFORMANCE</span>
          <strong>合同预付履约</strong>
          <small>{pool.legacy_mode ? '历史兼容模式：旧账不强制银行实付；启用严格模式后按真实付款控制。' : '严格模式：未触发、未满足发票前置条件的期次不能提前付款。'}</small>
        </div>
        <em className={`is-${pool.status_tone || 'neutral'}`}>{pool.status_label || '-'}</em>
      </header>

      {error ? <div className="rd-prepay-life-error">{error}</div> : null}

      <div className="rd-prepay-life-summary">
        <article><span>合同总预付</span><strong>{money(pool.prepayment_agreed_amount)}</strong></article>
        <article><span>已触发</span><strong>{money(pool.triggered_amount)}</strong></article>
        <article><span>未触发</span><strong>{money(pool.untriggered_amount)}</strong></article>
        <article><span>银行已付</span><strong>{money(pool.actual_funded_amount)}</strong></article>
        <article><span>累计抵扣</span><strong>{money(pool.deducted_amount)}</strong></article>
        <article><span>当前可用</span><strong>{money(pool.available_balance)}</strong></article>
        {Number(pool.refund_due || 0) > 0.01 ? <article className="is-danger"><span>待退款</span><strong>{money(pool.refund_due)}</strong></article> : null}
      </div>

      <div className="rd-prepay-life-settings">
        <label><span>合同原文名称</span><input disabled={!canManage || saving} value={settings.display_name} onChange={(event) => setSettings((current) => ({ ...current, display_name: event.target.value }))} placeholder="如：预付分成款" /></label>
        <label><span>发票处理</span><select disabled={!canManage || saving} value={settings.invoice_policy} onChange={(event) => setSettings((current) => ({ ...current, invoice_policy: event.target.value }))}>
          <option value="separate">预付款凭证与月结分开</option>
          <option value="release_by_deduction">预付发票随月度抵扣释放</option>
          <option value="manual">人工判断 / 不自动处理</option>
        </select></label>
        <label className="is-switch"><input type="checkbox" disabled={!canManage || saving} checked={settings.strict_mode} onChange={(event) => setSettings((current) => ({ ...current, strict_mode: event.target.checked }))} /><span>严格履约模式</span></label>
        <button type="button" disabled={!canManage || saving} onClick={saveSettings}>保存履约设置</button>
      </div>

      <div className="rd-prepay-life-block">
        <div className="rd-prepay-life-block-head"><div><strong>预付付款计划</strong><small>合同约定 → 节点触发 → 发票前置 → 到期付款</small></div><span>已计划 {money(pool.plan_total)} / {money(pool.prepayment_agreed_amount)}</span></div>
        {installments.length === 0 ? <p className="rd-prepay-life-empty">尚未建立分期计划。新合同建议先建立计划，再启用严格履约。</p> : null}
        <div className="rd-prepay-life-installments">
          {installments.map((item) => (
            <article key={item.id} className={`is-${item.status_tone || 'neutral'}`}>
              <div className="rd-prepay-life-installment-name"><strong>{item.installment_name || `第${item.installment_no}期`}</strong><small>{TRIGGER_LABELS[item.trigger_type] || item.trigger_type}{item.trigger_note ? ` · ${item.trigger_note}` : ''}</small></div>
              <div><span>本期金额</span><strong>{money(item.planned_amount)}</strong></div>
              <div><span>触发日期</span><strong>{item.trigger_date || '未触发'}</strong><small>{item.due_date ? `应付 ${item.due_date}` : `触发后 ${item.payment_due_days || 0} 个工作日`}</small></div>
              <div><span>付款进度</span><strong>{money(item.funded_amount)} / {money(item.planned_amount)}</strong></div>
              <em className={`is-${item.status_tone || 'neutral'}`}>{item.status_label}</em>
              <div className="rd-prepay-life-row-actions">
                {!item.triggered ? <button type="button" disabled={!canManage || saving || pool.frozen} onClick={() => triggerInstallment(item)}>确认触发</button> : null}
                {item.triggered && item.requires_invoice && !item.invoice_ready ? <button type="button" disabled={!canManage || saving || pool.frozen} onClick={() => markInvoiceReady(item)}>确认已取得发票</button> : null}
                {!item.triggered ? <button type="button" className="is-ghost" disabled={!canManage || saving} onClick={() => removeInstallment(item)}>删除</button> : null}
              </div>
            </article>
          ))}
        </div>

        {remainingPlanAmount > 0.01 ? (
          <div className="rd-prepay-life-add">
            <input disabled={!canManage || saving} value={form.installment_name} onChange={(event) => setForm((current) => ({ ...current, installment_name: event.target.value }))} placeholder={`期次名称，如：第${installments.length + 1}期`} />
            <input disabled={!canManage || saving} type="number" min="0" step="0.01" value={form.planned_amount} onChange={(event) => setForm((current) => ({ ...current, planned_amount: event.target.value }))} placeholder={`金额，剩余 ${money(remainingPlanAmount)}`} />
            <select disabled={!canManage || saving} value={form.trigger_type} onChange={(event) => setForm((current) => ({ ...current, trigger_type: event.target.value }))}>
              {Object.entries(TRIGGER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input disabled={!canManage || saving} value={form.trigger_note} onChange={(event) => setForm((current) => ({ ...current, trigger_note: event.target.value }))} placeholder="触发说明，如：游戏正式上线" />
            <input disabled={!canManage || saving} type="number" min="0" max="365" value={form.payment_due_days} onChange={(event) => setForm((current) => ({ ...current, payment_due_days: event.target.value }))} title="触发后工作日" />
            <label><input disabled={!canManage || saving} type="checkbox" checked={form.requires_invoice} onChange={(event) => setForm((current) => ({ ...current, requires_invoice: event.target.checked }))} />付款前需发票</label>
            <button type="button" disabled={!canManage || saving} onClick={addInstallment}>新增期次</button>
          </div>
        ) : null}
      </div>

      <div className="rd-prepay-life-block">
        <div className="rd-prepay-life-block-head"><div><strong>终止 / 退款闭环</strong><small>冻结余额后停止抵扣，退款必须关联真实银行收入</small></div>{pool.frozen ? <span className="is-danger">已冻结 · {pool.freeze_reason || '待处理'}</span> : <span>正常抵扣中</span>}</div>
        {!pool.frozen ? <button type="button" className="rd-prepay-life-danger-btn" disabled={!canManage || saving || Number(pool.actual_funded_amount || 0) <= Number(pool.deducted_amount || 0)} onClick={freezePool}>冻结余额并进入退款处理</button> : null}
        {pool.frozen && refunds.length === 0 ? <button type="button" className="rd-prepay-life-ghost-btn" disabled={!canManage || saving} onClick={unfreezePool}>解除冻结</button> : null}
        {pool.frozen ? (
          <div className="rd-prepay-life-refund">
            <div className="rd-prepay-life-refund-total"><span>银行已付 {money(pool.actual_funded_amount)}</span><span>已抵扣 {money(pool.deducted_amount)}</span><span>已退款 {money(pool.refunded_amount)}</span><strong>仍待退款 {money(pool.refund_due)}</strong></div>
            {Number(pool.refund_due || 0) > 0.01 && candidates.length === 0 ? <p className="rd-prepay-life-empty">暂未识别到匹配的银行退款收入。导入/登记退款流水后刷新即可自动推荐。</p> : null}
            {candidates.map((candidate) => <button key={candidate.id} type="button" className="rd-prepay-life-refund-candidate" disabled={!canManage || saving} onClick={() => registerRefund(candidate)}><strong>{candidate.trade_date || '-'} · {candidate.payer_name || '未识别退款方'} · {money(candidate.available_amount)}</strong><small>{candidate.transaction_no || candidate.summary || '无流水摘要'} · 匹配 {candidate.match_score}</small><em>登记退款 {money(candidate.suggested_refund_amount)}</em></button>)}
            {refunds.map((item) => <div key={item.id} className="rd-prepay-life-refund-row"><span>{item.refund_date || item.trade_date || '-'}</span><span>{item.payer_name || item.payee_name || '-'}</span><strong>+{money(item.refund_amount)}</strong><small>{item.transaction_no || item.bank_summary || ''}</small></div>)}
          </div>
        ) : null}
      </div>

      <div className="rd-prepay-life-block">
        <div className="rd-prepay-life-block-head"><div><strong>预付发票释放</strong><small>避免预付款阶段已取得发票，月结时再次形成完整发票缺口</small></div><span>已释放 {money(pool.invoice_released_amount)}</span></div>
        <div className="rd-prepay-life-invoice-summary"><span>预付阶段已取得 {money(pool.invoice_received_amount)}</span><span>当前仍留在预付池 {money(pool.invoice_held_amount)}</span><span>付款凭证缺口 {money(pool.invoice_gap)}</span></div>
        {settings.invoice_policy === 'release_by_deduction' ? <button type="button" disabled={!canManage || saving || Number(pool.deducted_amount || 0) <= Number(pool.invoice_released_amount || 0)} onClick={releaseInvoices}>按已发生抵扣自动释放发票</button> : <p className="rd-prepay-life-empty">当前策略不会自动把预付发票转入月度研发账单；可在上方切换策略。</p>}
        {releases.slice(0, 6).map((item) => <div key={item.id} className="rd-prepay-life-release-row"><span>{item.settlement_month || '-'}</span><span>{item.statement_no || item.bill_id}</span><span>{item.invoice_no || item.digital_invoice_no || item.invoice_id}</span><strong>{money(item.released_amount)}</strong></div>)}
      </div>
    </section>
  )
}
