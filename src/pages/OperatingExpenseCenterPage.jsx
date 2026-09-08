import React, { useCallback, useEffect, useMemo, useState } from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { VIEWS } from '@/app/routes.js'
import { useAppState } from '@/app/AppStateContext.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { getProfitAnalysis } from '@/lib/api/profitAnalysis.ts'
import {
  createOperatingDeposit,
  createOperatingExpense,
  deleteOperatingDeposit,
  deleteOperatingExpense,
  listOperatingDeposits,
  listOperatingExpenses,
  updateOperatingDeposit,
  updateOperatingExpense
} from '@/lib/api/operatingExpenses.ts'
import './OperatingExpenseCenterPage.css'

const EXPENSE_MODES = {
  [VIEWS.OFFICE_RENT]: {
    kind: 'office_rent', category: 'office', kicker: 'OFFICE RENT', title: '办公室租金',
    description: '按费用月份管理办公室租金、应付日、支付状态、发票和付款凭证。',
    addLabel: '+ 新增租金', vendorLabel: '收款方 / 房东', emptyLabel: '本月尚未录入办公室租金。'
  },
  [VIEWS.SOFTWARE_EXPENSES]: {
    kind: 'software_subscription', category: 'platform', kicker: 'SOFTWARE SUBSCRIPTIONS', title: '软件订阅',
    description: '集中维护 WPS、邮箱、域名工具、SaaS 等持续性软件与平台费用。',
    addLabel: '+ 新增订阅', vendorLabel: '软件 / 平台', emptyLabel: '本月尚未录入软件订阅。'
  },
  [VIEWS.PAYROLL_EXPENSES]: {
    kind: 'payroll', category: 'payroll', kicker: 'PAYROLL', title: '人工费用',
    description: '维护工资、劳务、社保及其他人工相关经营支出。',
    addLabel: '+ 新增人工费用', vendorLabel: '人员 / 项目', emptyLabel: '本月尚未录入人工费用。'
  },
  [VIEWS.OTHER_EXPENSES]: {
    kind: 'other', category: 'other', kicker: 'OTHER EXPENSES', title: '其他费用',
    description: '维护无法归入租金、服务器、软件或人工的其他日常经营费用。',
    addLabel: '+ 新增费用', vendorLabel: '费用项目 / 往来方', emptyLabel: '本月尚未录入其他费用。'
  }
}

const SHORTCUTS = [
  [VIEWS.OFFICE_RENT, '租', '办公室租金', 'office_rent'],
  [VIEWS.SERVER_COSTS, '云', '服务器 / 云服务', 'server'],
  [VIEWS.SOFTWARE_EXPENSES, '软', '软件订阅', 'software_subscription'],
  [VIEWS.PAYROLL_EXPENSES, '人', '人工费用', 'payroll'],
  [VIEWS.DEPOSITS, '押', '押金 / 保证金', 'deposit'],
  [VIEWS.OTHER_EXPENSES, '其', '其他费用', 'other']
]

function currentMonth() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function money(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function sum(rows, predicate = () => true) {
  return rows.filter(predicate).reduce((total, row) => total + Number(row.amount || 0), 0)
}

function emptyExpenseForm(month) {
  return {
    expenseMonth: month || currentMonth(),
    amount: '',
    dueDate: '',
    vendorName: '',
    paymentStatus: 'unpaid',
    paymentDate: '',
    invoiceStatus: 'pending',
    invoiceNumber: '',
    voucherNote: '',
    remark: ''
  }
}

function emptyDepositForm() {
  return {
    depositType: 'office',
    title: '办公室保证金',
    counterparty: '',
    amount: '',
    paidDate: '',
    expectedRefundDate: '',
    status: 'held',
    refundDate: '',
    remark: ''
  }
}

function StatusBadge({ type, children }) {
  return <span className={`opex-status is-${type}`}>{children}</span>
}

export default function OperatingExpenseCenterPage() {
  const { activeView, setActiveView, showToast } = useAppState()
  const { can } = useAuth()
  const canManage = can('analytics.manage')
  const mode = EXPENSE_MODES[activeView] || null
  const isOverview = activeView === VIEWS.OPERATING_EXPENSES
  const isDeposits = activeView === VIEWS.DEPOSITS

  const [month, setMonth] = useState(currentMonth)
  const [query, setQuery] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [depositStatus, setDepositStatus] = useState('all')
  const [rows, setRows] = useState([])
  const [profit, setProfit] = useState(null)
  const [heldDeposits, setHeldDeposits] = useState([])
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [expenseForm, setExpenseForm] = useState(() => emptyExpenseForm(currentMonth()))
  const [depositForm, setDepositForm] = useState(emptyDepositForm)
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      if (isOverview) {
        const [profitData, expenses, deposits] = await Promise.all([
          getProfitAnalysis({ month, trendMonths: 2 }),
          listOperatingExpenses({ month, limit: 500 }),
          listOperatingDeposits({ status: 'held', limit: 500 })
        ])
        setProfit(profitData)
        setRows(expenses.items || [])
        setHeldDeposits(deposits.items || [])
      } else if (isDeposits) {
        const deposits = await listOperatingDeposits({ status: depositStatus, q: query || undefined, limit: 500 })
        setRows(deposits.items || [])
      } else if (mode) {
        const expenses = await listOperatingExpenses({
          month,
          category: mode.category,
          expenseKind: mode.kind,
          q: query || undefined,
          limit: 500
        })
        setRows(expenses.items || [])
      }
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : '运营费用读取失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [depositStatus, isDeposits, isOverview, mode, month, query, revision, showToast])

  useEffect(() => { void loadData() }, [loadData])

  const visibleExpenseRows = useMemo(() => {
    if (!mode || paymentFilter === 'all') return rows
    return rows.filter((row) => row.payment_status === paymentFilter)
  }, [mode, paymentFilter, rows])

  const overviewPending = useMemo(() => sum(rows, (row) => row.payment_status === 'unpaid'), [rows])
  const overviewInvoicePending = useMemo(
    () => rows.filter((row) => row.invoice_status === 'pending' || row.invoice_status === 'unknown').length,
    [rows]
  )
  const heldDepositTotal = useMemo(() => sum(heldDeposits), [heldDeposits])
  const expenseTotal = useMemo(() => sum(visibleExpenseRows), [visibleExpenseRows])
  const unpaidTotal = useMemo(() => sum(rows, (row) => row.payment_status === 'unpaid'), [rows])

  const shortcutAmount = useCallback((kind) => {
    if (kind === 'server') return Number(profit?.server_cost?.value || 0)
    if (kind === 'deposit') return heldDepositTotal
    return sum(rows, (row) => row.expense_kind === kind)
  }, [heldDepositTotal, profit?.server_cost?.value, rows])

  const openExpenseCreate = () => {
    if (!canManage || !mode) return
    setEditingId('')
    setExpenseForm(emptyExpenseForm(month))
    setEditorOpen(true)
  }

  const openExpenseEdit = (row) => {
    if (!canManage || !mode) return
    setEditingId(row.id)
    setExpenseForm({
      expenseMonth: row.expense_month || month,
      amount: String(row.amount ?? ''),
      dueDate: row.due_date || '',
      vendorName: row.vendor_name || '',
      paymentStatus: row.payment_status || 'paid',
      paymentDate: row.payment_date || '',
      invoiceStatus: row.invoice_status || 'unknown',
      invoiceNumber: row.invoice_number || '',
      voucherNote: row.voucher_note || '',
      remark: row.remark || ''
    })
    setEditorOpen(true)
  }

  const saveExpense = async (event) => {
    event.preventDefault()
    if (!mode) return
    const amount = Number(expenseForm.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast?.('费用金额必须大于 0', 'error')
      return
    }
    if (expenseForm.paymentStatus === 'paid' && !expenseForm.paymentDate) {
      showToast?.('已支付费用请填写实付日期', 'error')
      return
    }
    const payload = {
      expense_month: expenseForm.expenseMonth,
      expense_date: expenseForm.paymentDate || expenseForm.dueDate || null,
      category: mode.category,
      expense_kind: mode.kind,
      amount,
      game_name: null,
      vendor_name: expenseForm.vendorName.trim() || null,
      due_date: expenseForm.dueDate || null,
      payment_date: expenseForm.paymentStatus === 'paid' ? (expenseForm.paymentDate || null) : null,
      payment_status: expenseForm.paymentStatus,
      invoice_status: expenseForm.invoiceStatus,
      invoice_number: expenseForm.invoiceNumber.trim() || null,
      voucher_note: expenseForm.voucherNote.trim() || null,
      remark: expenseForm.remark.trim() || null,
      source: 'manual'
    }
    setSaving(true)
    try {
      if (editingId) await updateOperatingExpense(editingId, payload)
      else await createOperatingExpense(payload)
      showToast?.(editingId ? '经营费用已更新' : '经营费用已录入', 'success')
      setMonth(expenseForm.expenseMonth)
      setEditorOpen(false)
      setEditingId('')
      setRevision((value) => value + 1)
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : '费用保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const removeExpense = async (row) => {
    if (!canManage || !window.confirm(`确认删除这笔 ${money(row.amount)} 的费用吗？`)) return
    try {
      await deleteOperatingExpense(row.id)
      showToast?.('费用已删除', 'success')
      setRevision((value) => value + 1)
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : '删除失败', 'error')
    }
  }

  const openDepositCreate = () => {
    if (!canManage) return
    setEditingId('')
    setDepositForm(emptyDepositForm())
    setEditorOpen(true)
  }

  const openDepositEdit = (row) => {
    if (!canManage) return
    setEditingId(row.id)
    setDepositForm({
      depositType: row.deposit_type || 'office',
      title: row.title || '',
      counterparty: row.counterparty || '',
      amount: String(row.amount ?? ''),
      paidDate: row.paid_date || '',
      expectedRefundDate: row.expected_refund_date || '',
      status: row.status || 'held',
      refundDate: row.refund_date || '',
      remark: row.remark || ''
    })
    setEditorOpen(true)
  }

  const saveDeposit = async (event) => {
    event.preventDefault()
    const amount = Number(depositForm.amount)
    if (!depositForm.title.trim()) {
      showToast?.('请输入押金 / 保证金名称', 'error')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast?.('押金金额必须大于 0', 'error')
      return
    }
    if (depositForm.status === 'refunded' && !depositForm.refundDate) {
      showToast?.('已退回押金请填写退回日期', 'error')
      return
    }
    const payload = {
      deposit_type: depositForm.depositType,
      title: depositForm.title.trim(),
      counterparty: depositForm.counterparty.trim() || null,
      amount,
      paid_date: depositForm.paidDate || null,
      expected_refund_date: depositForm.expectedRefundDate || null,
      status: depositForm.status,
      refund_date: depositForm.status === 'refunded' ? (depositForm.refundDate || null) : null,
      remark: depositForm.remark.trim() || null
    }
    setSaving(true)
    try {
      if (editingId) await updateOperatingDeposit(editingId, payload)
      else await createOperatingDeposit(payload)
      showToast?.(editingId ? '押金记录已更新' : '押金记录已新增', 'success')
      setEditorOpen(false)
      setEditingId('')
      setRevision((value) => value + 1)
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : '押金保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const removeDeposit = async (row) => {
    if (!canManage || !window.confirm(`确认删除“${row.title}”这笔押金记录吗？`)) return
    try {
      await deleteOperatingDeposit(row.id)
      showToast?.('押金记录已删除', 'success')
      setRevision((value) => value + 1)
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : '删除失败', 'error')
    }
  }

  if (isOverview) {
    const operatingExpense = Number(profit?.operating_expense?.value || 0)
    const serverCost = Number(profit?.server_cost?.value || 0)
    return (
      <PageContainer hideHeader className="opex-page">
        <section className="opex-head">
          <div><span>OPERATING EXPENSE CENTER</span><h1>运营费用</h1><p>统一管理租金、云服务、软件、人工和其他经营成本；押金 / 保证金单独核算，不进入利润。</p></div>
          <div className="opex-head__actions"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /><button type="button" onClick={() => setRevision((v) => v + 1)}>{loading ? '刷新中…' : '刷新'}</button></div>
        </section>

        <section className="opex-metrics">
          <article><span>本月经营费用</span><strong>{money(operatingExpense)}</strong><small>{rows.length} 笔经营费用</small></article>
          <article><span>本月服务器成本</span><strong>{money(serverCost)}</strong><small>独立服务器台账 + 历史兼容</small></article>
          <article className="is-total"><span>本月运营成本合计</span><strong>{money(operatingExpense + serverCost)}</strong><small>经营费用 + 服务器成本</small></article>
          <article className={overviewPending > 0 ? 'is-warning' : ''}><span>待支付经营费用</span><strong>{money(overviewPending)}</strong><small>{overviewInvoicePending} 笔待补 / 待确认发票</small></article>
          <article className="is-asset"><span>持有押金 / 保证金</span><strong>{money(heldDepositTotal)}</strong><small>资产性往来 · 不计入利润</small></article>
        </section>

        <section className="opex-card">
          <div className="opex-card-head"><div><span>COST CATEGORIES</span><h2>费用分类</h2><p>点击进入对应台账。办公室租金、软件、人工和其他费用会自动进入经营利润。</p></div></div>
          <div className="opex-shortcuts">
            {SHORTCUTS.map(([view, icon, label, kind]) => (
              <button type="button" key={view} onClick={() => setActiveView(view)}>
                <i>{icon}</i><div><strong>{label}</strong><span>{kind === 'deposit' ? '当前持有' : '本月'} · {money(shortcutAmount(kind))}</span></div><b>›</b>
              </button>
            ))}
          </div>
        </section>

        <section className="opex-card">
          <div className="opex-card-head"><div><span>MONTHLY LEDGER</span><h2>本月经营费用明细</h2><p>这里只汇总查看，具体维护请进入对应费用分类。</p></div></div>
          <div className="opex-table-wrap"><table><thead><tr><th>费用月份</th><th>分类</th><th>往来方 / 项目</th><th>应付日</th><th>支付</th><th>发票</th><th className="is-right">金额</th></tr></thead><tbody>
            {loading ? <tr><td colSpan={7} className="opex-empty">正在读取运营费用…</td></tr> : null}
            {!loading && rows.length === 0 ? <tr><td colSpan={7} className="opex-empty">本月暂无经营费用。</td></tr> : null}
            {!loading && rows.map((row) => <tr key={row.id}><td><strong>{row.expense_month}</strong></td><td>{row.expense_kind || row.category}</td><td>{row.vendor_name || '—'}</td><td>{row.due_date || '—'}</td><td>{row.payment_status === 'paid' ? <StatusBadge type="paid">已支付</StatusBadge> : <StatusBadge type="unpaid">待支付</StatusBadge>}</td><td>{row.invoice_status === 'received' ? <StatusBadge type="paid">已取得</StatusBadge> : <StatusBadge type="pending">待处理</StatusBadge>}</td><td className="is-right"><strong>{money(row.amount)}</strong></td></tr>)}
          </tbody></table></div>
        </section>

        <section className="opex-note"><strong>利润口径</strong><p>租金、软件、人工及其他经营费用按费用月份进入利润；支付状态用于现金跟踪，不改变当月费用归属。押金 / 保证金不计入经营费用，退回时也不形成收入。</p></section>
      </PageContainer>
    )
  }

  if (isDeposits) {
    const depositTotal = sum(rows)
    const heldTotal = sum(rows, (row) => row.status === 'held')
    return (
      <PageContainer hideHeader className="opex-page">
        <section className="opex-head">
          <div><span>DEPOSITS & GUARANTEES</span><h1>押金 / 保证金</h1><p>办公室押金、服务保证金等单独建账，不进入经营费用，不直接影响利润。</p></div>
          <div className="opex-head__actions"><button type="button" onClick={() => setRevision((v) => v + 1)}>{loading ? '刷新中…' : '刷新'}</button>{canManage ? <button type="button" className="is-primary" onClick={openDepositCreate}>+ 新增押金</button> : null}</div>
        </section>
        <section className="opex-warning"><strong>会计口径：</strong><span>押金是可收回资产，不要录进“其他费用”。如果最终确认无法收回，再单独转为经营费用。</span></section>
        <section className="opex-metrics opex-metrics--compact"><article className="is-asset"><span>当前持有</span><strong>{money(heldTotal)}</strong><small>仍在外部的押金</small></article><article><span>当前筛选合计</span><strong>{money(depositTotal)}</strong><small>{rows.length} 笔记录</small></article></section>
        <section className="opex-card">
          <div className="opex-toolbar"><label><span>状态</span><select value={depositStatus} onChange={(e) => setDepositStatus(e.target.value)}><option value="all">全部</option><option value="held">持有中</option><option value="refunded">已退回</option><option value="forfeited">无法收回</option></select></label><label className="is-grow"><span>搜索</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="名称、往来方、备注…" /></label></div>
          <div className="opex-table-wrap"><table><thead><tr><th>名称</th><th>类型</th><th>往来方</th><th>支付日期</th><th>预计退回</th><th>状态</th><th>退回日期</th><th className="is-right">金额</th><th>操作</th></tr></thead><tbody>
            {loading ? <tr><td colSpan={9} className="opex-empty">正在读取押金台账…</td></tr> : null}
            {!loading && rows.length === 0 ? <tr><td colSpan={9} className="opex-empty">暂无押金 / 保证金记录。</td></tr> : null}
            {!loading && rows.map((row) => <tr key={row.id}><td><strong>{row.title}</strong><small className="opex-cell-note">{row.remark || ''}</small></td><td>{row.deposit_type === 'office' ? '办公室' : row.deposit_type === 'service' ? '服务保证金' : '其他'}</td><td>{row.counterparty || '—'}</td><td>{row.paid_date || '—'}</td><td>{row.expected_refund_date || '—'}</td><td>{row.status === 'held' ? <StatusBadge type="asset">持有中</StatusBadge> : row.status === 'refunded' ? <StatusBadge type="paid">已退回</StatusBadge> : <StatusBadge type="danger">无法收回</StatusBadge>}</td><td>{row.refund_date || '—'}</td><td className="is-right"><strong>{money(row.amount)}</strong></td><td><div className="opex-row-actions">{canManage ? <><button type="button" onClick={() => openDepositEdit(row)}>编辑</button><button type="button" className="is-danger" onClick={() => void removeDeposit(row)}>删除</button></> : <span>只读</span>}</div></td></tr>)}
          </tbody></table></div>
        </section>
        {editorOpen ? <DepositEditor form={depositForm} setForm={setDepositForm} saving={saving} editing={Boolean(editingId)} onClose={() => !saving && setEditorOpen(false)} onSubmit={saveDeposit} /> : null}
      </PageContainer>
    )
  }

  if (!mode) return null

  return (
    <PageContainer hideHeader className="opex-page">
      <section className="opex-head">
        <div><span>{mode.kicker}</span><h1>{mode.title}</h1><p>{mode.description}</p></div>
        <div className="opex-head__actions"><button type="button" onClick={() => setRevision((v) => v + 1)}>{loading ? '刷新中…' : '刷新'}</button>{canManage ? <button type="button" className="is-primary" onClick={openExpenseCreate}>{mode.addLabel}</button> : null}</div>
      </section>

      {activeView === VIEWS.OFFICE_RENT ? <section className="opex-info"><strong>租金规则：</strong><span>租金计入费用月份的经营利润；办公室押金请放到“押金 / 保证金”，不要混在租金里。</span><button type="button" onClick={() => setActiveView(VIEWS.DEPOSITS)}>去押金台账 →</button></section> : null}

      <section className="opex-metrics opex-metrics--compact">
        <article><span>当前筛选合计</span><strong>{money(expenseTotal)}</strong><small>{visibleExpenseRows.length} 笔记录</small></article>
        <article className={unpaidTotal > 0 ? 'is-warning' : ''}><span>本月待支付</span><strong>{money(unpaidTotal)}</strong><small>用于现金付款跟踪</small></article>
        <article><span>本月已支付</span><strong>{money(sum(rows, (row) => row.payment_status === 'paid'))}</strong><small>{rows.filter((row) => row.payment_status === 'paid').length} 笔</small></article>
      </section>

      <section className="opex-card">
        <div className="opex-toolbar"><label><span>费用月份</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label><label><span>支付状态</span><select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}><option value="all">全部</option><option value="unpaid">待支付</option><option value="paid">已支付</option></select></label><label className="is-grow"><span>搜索</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`${mode.vendorLabel}、发票号、备注…`} /></label></div>
        <div className="opex-table-wrap"><table><thead><tr><th>费用月份</th><th>应付日期</th><th>{mode.vendorLabel}</th><th>支付状态</th><th>实付日期</th><th>发票</th><th>发票号</th><th>备注 / 凭证</th><th className="is-right">金额</th><th>操作</th></tr></thead><tbody>
          {loading ? <tr><td colSpan={10} className="opex-empty">正在读取{mode.title}…</td></tr> : null}
          {!loading && visibleExpenseRows.length === 0 ? <tr><td colSpan={10} className="opex-empty">{mode.emptyLabel}</td></tr> : null}
          {!loading && visibleExpenseRows.map((row) => <tr key={row.id}><td><strong>{row.expense_month}</strong></td><td>{row.due_date || '—'}</td><td>{row.vendor_name || '—'}</td><td>{row.payment_status === 'paid' ? <StatusBadge type="paid">已支付</StatusBadge> : <StatusBadge type="unpaid">待支付</StatusBadge>}</td><td>{row.payment_date || '—'}</td><td>{row.invoice_status === 'received' ? <StatusBadge type="paid">已取得</StatusBadge> : row.invoice_status === 'none' ? <StatusBadge type="muted">无需发票</StatusBadge> : <StatusBadge type="pending">待处理</StatusBadge>}</td><td>{row.invoice_number || '—'}</td><td className="opex-remark" title={[row.remark, row.voucher_note].filter(Boolean).join(' · ')}>{[row.remark, row.voucher_note].filter(Boolean).join(' · ') || '—'}</td><td className="is-right"><strong>{money(row.amount)}</strong></td><td><div className="opex-row-actions">{canManage ? <><button type="button" onClick={() => openExpenseEdit(row)}>编辑</button><button type="button" className="is-danger" onClick={() => void removeExpense(row)}>删除</button></> : <span>只读</span>}</div></td></tr>)}
        </tbody></table></div>
      </section>

      <section className="opex-note"><strong>利润与现金分开看</strong><p>费用按“费用月份”进入经营利润；“已支付 / 待支付”只表示现金付款进度。因此 9 月租金即使 8 月提前支付，也仍应把费用月份填为 2026-09。</p></section>
      {editorOpen ? <ExpenseEditor mode={mode} form={expenseForm} setForm={setExpenseForm} saving={saving} editing={Boolean(editingId)} onClose={() => !saving && setEditorOpen(false)} onSubmit={saveExpense} /> : null}
    </PageContainer>
  )
}

function ExpenseEditor({ mode, form, setForm, saving, editing, onClose, onSubmit }) {
  const update = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value }))
  return <div className="opex-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><section className="opex-editor" role="dialog" aria-modal="true"><div className="opex-editor-head"><div><span>{mode.kicker}</span><h2>{editing ? `编辑${mode.title}` : mode.addLabel.replace('+ ', '')}</h2></div><button type="button" onClick={onClose}>×</button></div><form onSubmit={onSubmit}><div className="opex-form-grid"><label><span>费用月份 *</span><input type="month" value={form.expenseMonth} onChange={update('expenseMonth')} required /></label><label><span>金额 *</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={update('amount')} placeholder="0.00" required /></label><label><span>应付日期</span><input type="date" value={form.dueDate} onChange={update('dueDate')} /></label><label><span>{mode.vendorLabel}</span><input value={form.vendorName} onChange={update('vendorName')} placeholder={mode.vendorLabel} /></label><label><span>支付状态 *</span><select value={form.paymentStatus} onChange={update('paymentStatus')}><option value="unpaid">待支付</option><option value="paid">已支付</option></select></label><label><span>实付日期{form.paymentStatus === 'paid' ? ' *' : ''}</span><input type="date" value={form.paymentDate} onChange={update('paymentDate')} disabled={form.paymentStatus !== 'paid'} /></label><label><span>发票状态</span><select value={form.invoiceStatus} onChange={update('invoiceStatus')}><option value="pending">待取得</option><option value="received">已取得</option><option value="none">无需发票</option><option value="unknown">待确认</option></select></label><label><span>发票号</span><input value={form.invoiceNumber} onChange={update('invoiceNumber')} placeholder="可留空" /></label><label className="is-wide"><span>付款凭证 / 回单说明</span><input value={form.voucherNote} onChange={update('voucherNote')} placeholder="例如：工行转账、回单已存档" /></label><label className="is-wide"><span>备注</span><textarea value={form.remark} onChange={update('remark')} rows={3} placeholder="租赁周期、订阅周期或其他说明" /></label></div><div className="opex-editor-actions"><button type="button" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="is-primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button></div></form></section></div>
}

function DepositEditor({ form, setForm, saving, editing, onClose, onSubmit }) {
  const update = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value }))
  return <div className="opex-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><section className="opex-editor" role="dialog" aria-modal="true"><div className="opex-editor-head"><div><span>DEPOSIT LEDGER</span><h2>{editing ? '编辑押金 / 保证金' : '新增押金 / 保证金'}</h2></div><button type="button" onClick={onClose}>×</button></div><form onSubmit={onSubmit}><div className="opex-form-grid"><label><span>类型 *</span><select value={form.depositType} onChange={update('depositType')}><option value="office">办公室</option><option value="service">服务保证金</option><option value="other">其他</option></select></label><label><span>名称 *</span><input value={form.title} onChange={update('title')} required /></label><label><span>金额 *</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={update('amount')} required /></label><label><span>往来方</span><input value={form.counterparty} onChange={update('counterparty')} placeholder="房东 / 服务商" /></label><label><span>支付日期</span><input type="date" value={form.paidDate} onChange={update('paidDate')} /></label><label><span>预计退回日期</span><input type="date" value={form.expectedRefundDate} onChange={update('expectedRefundDate')} /></label><label><span>状态</span><select value={form.status} onChange={update('status')}><option value="held">持有中</option><option value="refunded">已退回</option><option value="forfeited">无法收回</option></select></label><label><span>实际退回日期{form.status === 'refunded' ? ' *' : ''}</span><input type="date" value={form.refundDate} onChange={update('refundDate')} disabled={form.status !== 'refunded'} /></label><label className="is-wide"><span>备注</span><textarea value={form.remark} onChange={update('remark')} rows={3} placeholder="合同、退租、保证金条款等说明" /></label></div>{form.status === 'forfeited' ? <div className="opex-editor-warning">标记为“无法收回”不会自动计入利润；确认损失后，请另外在“其他费用”录入对应费用。</div> : null}<div className="opex-editor-actions"><button type="button" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="is-primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button></div></form></section></div>
}
