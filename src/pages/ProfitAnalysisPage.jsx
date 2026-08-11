import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { VIEWS } from '@/app/routes.js'
import { getProfitAnalysis } from '@/lib/api/profitAnalysis.ts'
import {
  createOperatingExpense,
  deleteOperatingExpense,
  listOperatingExpenses,
  updateOperatingExpense
} from '@/lib/api/operatingExpenses.ts'
import './ProfitAnalysisPage.css'
import './AnnualProfitOverview.css'

const CATEGORY_OPTIONS = [
  ['marketing', '广告 / 市场'],
  ['payroll', '人力'],
  ['office', '办公'],
  ['tax', '税费'],
  ['financing', '利息 / 融资'],
  ['platform', '平台服务'],
  ['other', '其他']
]

const CATEGORY_LABELS = Object.fromEntries(CATEGORY_OPTIONS)

function emptyForm() {
  return {
    category: 'marketing',
    amount: '',
    expenseDate: '',
    gameName: '',
    vendorName: '',
    remark: ''
  }
}

function money(value) {
  const n = Number(value || 0)
  return `¥${n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function compactMoney(value) {
  const n = Number(value || 0)
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 100000000) return `${sign}¥${(abs / 100000000).toFixed(2)}亿`
  if (abs >= 10000) return `${sign}¥${(abs / 10000).toFixed(abs >= 100000 ? 1 : 2)}万`
  return money(n)
}

function monthLabel(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : value || '-'
}

function deltaText(metric) {
  if (!metric) return '-'
  if (metric.change_percent == null) {
    const amount = Number(metric.change_amount || 0)
    if (Math.abs(amount) <= 0.005) return '与上月持平'
    return `较上月 ${amount > 0 ? '+' : ''}${money(amount)}`
  }
  const value = Number(metric.change_percent || 0)
  if (Math.abs(value) <= 0.005) return '与上月持平'
  return `较上月 ${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

function MetricCard({ label, value, note, tone = '', onClick }) {
  const Tag = onClick ? 'button' : 'article'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`profit-metric ${tone ? `is-${tone}` : ''} ${onClick ? 'is-clickable' : ''}`}
      onClick={onClick}
    >
      <span>{label}</span>
      <strong>{compactMoney(value)}</strong>
      <small>{note}</small>
    </Tag>
  )
}

function ProfitTrend({ rows }) {
  const max = useMemo(() => {
    const values = (rows || []).flatMap((row) => [
      Math.abs(Number(row.channel_settlement || 0)),
      Math.abs(Number(row.operating_profit || 0))
    ])
    return Math.max(1, ...values)
  }, [rows])

  return (
    <div className="profit-trend" role="img" aria-label="十二个月经营利润趋势">
      {(rows || []).map((row) => {
        const revenueHeight = Math.max(3, Math.abs(Number(row.channel_settlement || 0)) / max * 100)
        const profitHeight = Math.max(3, Math.abs(Number(row.operating_profit || 0)) / max * 100)
        return (
          <div
            className="profit-trend-col"
            key={row.month}
            title={`${monthLabel(row.month)} · 渠道 ${money(row.channel_settlement)} · 利润 ${money(row.operating_profit)}`}
          >
            <div className="profit-trend-bars">
              <i className="is-revenue" style={{ height: `${revenueHeight}%` }} />
              <i className={Number(row.operating_profit || 0) >= 0 ? 'is-profit' : 'is-profit is-loss'} style={{ height: `${profitHeight}%` }} />
            </div>
            <span>{String(row.month || '').slice(5)}月</span>
          </div>
        )
      })}
    </div>
  )
}

function sumRows(rows, key) {
  return (rows || []).reduce((sum, row) => sum + Number(row?.[key] || 0), 0)
}

function buildAnnualSummary(rows, year) {
  const yearRows = (rows || []).filter((row) => String(row.month || '').startsWith(`${year}-`))
  const channelSettlement = sumRows(yearRows, 'channel_settlement')
  const rdCost = sumRows(yearRows, 'rd_cost')
  const serverCost = sumRows(yearRows, 'server_cost')
  const operatingExpense = sumRows(yearRows, 'operating_expense')
  const operatingProfit = sumRows(yearRows, 'operating_profit')
  const activeRows = yearRows.filter((row) => [
    row.channel_settlement,
    row.rd_cost,
    row.server_cost,
    row.operating_expense,
    row.operating_profit
  ].some((value) => Math.abs(Number(value || 0)) > 0.005))
  const profitableMonths = activeRows.filter((row) => Number(row.operating_profit || 0) > 0.005).length
  const lossMonths = activeRows.filter((row) => Number(row.operating_profit || 0) < -0.005).length
  const sortedByProfit = [...activeRows].sort((a, b) => Number(b.operating_profit || 0) - Number(a.operating_profit || 0))
  return {
    rows: yearRows,
    channelSettlement,
    rdCost,
    serverCost,
    operatingExpense,
    operatingProfit,
    profitMargin: Math.abs(channelSettlement) > 0.005 ? operatingProfit / channelSettlement * 100 : 0,
    activeMonths: activeRows.length,
    profitableMonths,
    lossMonths,
    bestMonth: sortedByProfit[0] || null,
    worstMonth: sortedByProfit.length ? sortedByProfit[sortedByProfit.length - 1] : null,
    averageMonthlyProfit: activeRows.length ? operatingProfit / activeRows.length : 0
  }
}

function AnnualProfitOverview({ data, selectedYear, setSelectedYear, onRefresh, loading }) {
  const years = useMemo(() => {
    const values = [...new Set((data?.available_months || []).map((item) => String(item).slice(0, 4)).filter(Boolean))]
    if (selectedYear && !values.includes(selectedYear)) values.push(selectedYear)
    return values.sort((a, b) => b.localeCompare(a))
  }, [data?.available_months, selectedYear])
  const annual = useMemo(() => buildAnnualSummary(data?.trend || [], selectedYear), [data?.trend, selectedYear])
  const positive = annual.operatingProfit >= 0

  return (
    <>
      <section className="profit-annual-toolbar">
        <div>
          <span>ANNUAL PROFIT OVERVIEW</span>
          <strong>{selectedYear} 年度利润总览</strong>
          <small>按自然年 1–12 月汇总；未录入月份按 0 展示，不做预测。</small>
        </div>
        <div>
          <label><span>经营年度</span><select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}>{years.map((year) => <option value={year} key={year}>{year}年</option>)}</select></label>
          <button type="button" onClick={onRefresh} disabled={loading}>{loading ? '刷新中…' : '刷新'}</button>
        </div>
      </section>

      <section className={`profit-annual-hero ${positive ? 'is-profit' : 'is-loss'}`}>
        <div className="profit-annual-hero__main">
          <span>{selectedYear}年 · 管理口径经营利润</span>
          <strong>{compactMoney(annual.operatingProfit)}</strong>
          <p>年度利润率 {annual.profitMargin.toFixed(1)}% · 已录入 {annual.activeMonths}/12 个月</p>
        </div>
        <div className="profit-annual-bridge">
          <div><span>全年渠道结算</span><strong>{compactMoney(annual.channelSettlement)}</strong></div>
          <i>−</i><div><span>全年研发成本</span><strong>{compactMoney(annual.rdCost)}</strong></div>
          <i>−</i><div><span>全年服务器</span><strong>{compactMoney(annual.serverCost)}</strong></div>
          <i>−</i><div><span>全年经营费用</span><strong>{compactMoney(annual.operatingExpense)}</strong></div>
          <i>=</i><div className="is-result"><span>年度经营利润</span><strong>{compactMoney(annual.operatingProfit)}</strong></div>
        </div>
      </section>

      <section className="profit-annual-metrics">
        <article><span>渠道结算</span><strong>{compactMoney(annual.channelSettlement)}</strong><small>自然年累计收入</small></article>
        <article><span>研发成本</span><strong>{compactMoney(annual.rdCost)}</strong><small>自然年累计研发结算</small></article>
        <article><span>服务器成本</span><strong>{compactMoney(annual.serverCost)}</strong><small>历史账单 + 独立台账</small></article>
        <article><span>经营费用</span><strong>{compactMoney(annual.operatingExpense)}</strong><small>自然年累计费用</small></article>
        <article className={positive ? 'is-positive' : 'is-negative'}><span>年度经营利润</span><strong>{compactMoney(annual.operatingProfit)}</strong><small>平均每个已录入月 {compactMoney(annual.averageMonthlyProfit)}</small></article>
      </section>

      <section className="profit-annual-grid">
        <article className="profit-card profit-card--trend">
          <div className="profit-card-head">
            <div><span>YEAR TREND</span><h2>年度月度走势</h2><p>{selectedYear} 年 1–12 月渠道结算 vs 经营利润</p></div>
            <div className="profit-legend"><span className="is-revenue">渠道结算</span><span className="is-profit">经营利润</span></div>
          </div>
          <ProfitTrend rows={annual.rows} />
          <div className="profit-table-wrap">
            <table>
              <thead><tr><th>月份</th><th>渠道结算</th><th>研发</th><th>服务器</th><th>经营费用</th><th>经营利润</th><th>利润率</th></tr></thead>
              <tbody>{annual.rows.map((row) => <tr key={row.month}><td>{monthLabel(row.month)}</td><td>{money(row.channel_settlement)}</td><td>{money(row.rd_cost)}</td><td>{money(row.server_cost)}</td><td>{money(row.operating_expense)}</td><td className={Number(row.operating_profit) < 0 ? 'is-negative' : 'is-positive'}>{money(row.operating_profit)}</td><td>{Number(row.profit_margin || 0).toFixed(1)}%</td></tr>)}</tbody>
            </table>
          </div>
        </article>

        <aside className="profit-annual-side">
          <article className="profit-card">
            <div className="profit-card-head"><div><span>YEAR HEALTH</span><h2>年度经营概况</h2><p>只统计已有实际数据的月份</p></div></div>
            <div className="profit-annual-health">
              <div><span>已录入月份</span><strong>{annual.activeMonths}/12</strong></div>
              <div><span>盈利月份</span><strong>{annual.profitableMonths}</strong></div>
              <div><span>亏损月份</span><strong>{annual.lossMonths}</strong></div>
              <div><span>年度利润率</span><strong>{annual.profitMargin.toFixed(1)}%</strong></div>
            </div>
          </article>
          <article className="profit-card">
            <div className="profit-card-head"><div><span>BEST / WORST</span><h2>最好与最差月份</h2></div></div>
            <div className="profit-annual-extremes">
              <div className="is-best"><span>最好月份</span><strong>{annual.bestMonth ? monthLabel(annual.bestMonth.month) : '—'}</strong><small>{annual.bestMonth ? money(annual.bestMonth.operating_profit) : '暂无数据'}</small></div>
              <div className="is-worst"><span>最差月份</span><strong>{annual.worstMonth ? monthLabel(annual.worstMonth.month) : '—'}</strong><small>{annual.worstMonth ? money(annual.worstMonth.operating_profit) : '暂无数据'}</small></div>
            </div>
          </article>
          <article className="profit-annual-note"><strong>年度口径</strong><p>年度经营利润 = 全年渠道结算 − 全年研发成本 − 全年服务器成本 − 全年经营费用。这里是管理口径总预览，不等同法定会计净利润。</p></article>
        </aside>
      </section>
    </>
  )
}

export default function ProfitAnalysisPage() {
  const { setActiveView, showToast } = useAppState()
  const [viewMode, setViewMode] = useState('monthly')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()))
  const [data, setData] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [expenseTotal, setExpenseTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void (async () => {
      try {
        const requestMonth = viewMode === 'annual'
          ? `${selectedYear}-12`
          : (selectedMonth || undefined)
        const profit = await getProfitAnalysis({
          month: requestMonth,
          trendMonths: 12
        })
        if (cancelled) return
        if (viewMode === 'annual') {
          setData(profit)
          setExpenses([])
          setExpenseTotal(0)
          return
        }
        const expenseResponse = await listOperatingExpenses({
          month: profit.month,
          limit: 500,
          offset: 0
        })
        if (cancelled) return
        setData(profit)
        setExpenses(expenseResponse.items || [])
        setExpenseTotal(Number(expenseResponse.amount_total || 0))
      } catch (loadError) {
        if (cancelled) return
        const message = loadError instanceof Error ? loadError.message : '利润分析读取失败'
        setError(message)
        showToast?.('利润分析读取失败，请稍后重试', 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [revision, selectedMonth, selectedYear, viewMode, showToast])

  const month = selectedMonth || data?.month || ''
  const profitPositive = Number(data?.operating_profit?.value || 0) >= 0
  const categoryMax = Math.max(1, ...(data?.expense_categories || []).map((row) => Number(row.amount || 0)))
  const gameNames = useMemo(
    () => [...new Set((data?.games || []).map((row) => row.game_name).filter((name) => name && name !== '未填写产品'))],
    [data?.games]
  )

  const switchView = (next) => {
    if (next === viewMode) return
    if (next === 'annual') {
      const year = String(selectedMonth || data?.month || '').slice(0, 4)
      if (/^\d{4}$/.test(year)) setSelectedYear(year)
    }
    setViewMode(next)
  }

  const openCreate = () => {
    if (viewMode === 'annual') {
      setViewMode('monthly')
      return
    }
    setEditingId('')
    setForm(emptyForm())
    setEditorOpen(true)
  }

  const openEdit = (expense) => {
    setEditingId(expense.id)
    setForm({ category: expense.category || 'other', amount: String(expense.amount ?? ''), expenseDate: expense.expense_date || '', gameName: expense.game_name || '', vendorName: expense.vendor_name || '', remark: expense.remark || '' })
    setEditorOpen(true)
  }

  const closeEditor = () => {
    if (saving) return
    setEditorOpen(false)
    setEditingId('')
    setForm(emptyForm())
  }

  const saveExpense = async (event) => {
    event.preventDefault()
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) return showToast?.('费用金额必须大于 0', 'error')
    if (!data?.month) return showToast?.('请先选择经营月份', 'error')
    const payload = { expense_month: data.month, expense_date: form.expenseDate || null, category: form.category, amount, game_name: form.gameName.trim() || null, vendor_name: form.vendorName.trim() || null, remark: form.remark.trim() || null, source: 'manual' }
    setSaving(true)
    try {
      if (editingId) { await updateOperatingExpense(editingId, payload); showToast?.('经营费用已更新', 'success') }
      else { await createOperatingExpense(payload); showToast?.('经营费用已录入', 'success') }
      closeEditor(); setRevision((value) => value + 1)
    } catch (saveError) { showToast?.(saveError instanceof Error ? saveError.message : '费用保存失败', 'error') }
    finally { setSaving(false) }
  }

  const removeExpense = async (expense) => {
    const confirmed = window.confirm(`确定删除 ${monthLabel(expense.expense_month)} 的“${CATEGORY_LABELS[expense.category] || expense.category}”费用 ${money(expense.amount)} 吗？`)
    if (!confirmed) return
    try { await deleteOperatingExpense(expense.id); showToast?.('经营费用已删除', 'success'); setRevision((value) => value + 1) }
    catch (deleteError) { showToast?.(deleteError instanceof Error ? deleteError.message : '费用删除失败', 'error') }
  }

  return (
    <PageContainer hideHeader className="profit-analysis-page">
      <section className="profit-head">
        <div>
          <span className="profit-kicker">PROFIT ANALYSIS · V2.3</span>
          <h1>利润分析</h1>
          <p>公司层扣除全部经营费用，产品层只扣可明确归属成本，公共费用不做虚假分摊。</p>
          <div className="profit-view-toggle" role="tablist" aria-label="利润分析视图">
            <button type="button" className={viewMode === 'monthly' ? 'is-active' : ''} onClick={() => switchView('monthly')}>月度分析</button>
            <button type="button" className={viewMode === 'annual' ? 'is-active' : ''} onClick={() => switchView('annual')}>年度总览</button>
          </div>
        </div>
        {viewMode === 'monthly' ? <div className="profit-head-actions">
          <label><span>经营月份</span><select value={month} onChange={(event) => setSelectedMonth(event.target.value)}>{(data?.available_months || []).map((item) => <option value={item} key={item}>{monthLabel(item)}</option>)}{month && !(data?.available_months || []).includes(month) ? <option value={month}>{monthLabel(month)}</option> : null}</select></label>
          <button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading}>{loading ? '刷新中…' : '刷新'}</button>
          <button type="button" className="is-primary" onClick={openCreate}>+ 录入费用</button>
        </div> : null}
      </section>

      {error && !data ? <section className="profit-error"><strong>利润分析读取失败</strong><span>{error}</span><button type="button" onClick={() => setRevision((value) => value + 1)}>重新读取</button></section> : null}

      {data && viewMode === 'annual' ? <AnnualProfitOverview data={data} selectedYear={selectedYear} setSelectedYear={setSelectedYear} onRefresh={() => setRevision((value) => value + 1)} loading={loading} /> : null}

      {data && viewMode === 'monthly' ? <>
        <section className={`profit-hero ${profitPositive ? 'is-profit' : 'is-loss'}`}>
          <div className="profit-hero-main"><span>{monthLabel(data.month)} · 管理口径经营利润</span><strong>{compactMoney(data.operating_profit?.value)}</strong><p>利润率 {Number(data.profit_margin?.value || 0).toFixed(1)}% · {deltaText(data.operating_profit)}</p></div>
          <div className="profit-bridge" aria-label="利润计算桥"><div><span>渠道结算</span><strong>{compactMoney(data.channel_settlement?.value)}</strong></div><i>−</i><div><span>研发成本</span><strong>{compactMoney(data.rd_cost?.value)}</strong></div><i>−</i><div><span>服务器</span><strong>{compactMoney(data.server_cost?.value)}</strong></div><i>−</i><div><span>经营费用</span><strong>{compactMoney(data.operating_expense?.value)}</strong></div><i>=</i><div className="is-result"><span>经营利润</span><strong>{compactMoney(data.operating_profit?.value)}</strong></div></div>
        </section>

        <section className="profit-metrics">
          <MetricCard label="渠道结算" value={data.channel_settlement?.value} note={`${data.channel_bill_count || 0} 笔账单 · ${deltaText(data.channel_settlement)}`} tone="revenue" onClick={() => setActiveView(VIEWS.RECON_CHANNEL)} />
          <MetricCard label="研发成本" value={data.rd_cost?.value} note={`${data.rd_bill_count || 0} 笔账单 · ${deltaText(data.rd_cost)}`} tone="rd" onClick={() => setActiveView(VIEWS.RECON_RD)} />
          <MetricCard label="服务器成本" value={data.server_cost?.value} note={deltaText(data.server_cost)} tone="server" />
          <MetricCard label="经营费用" value={data.operating_expense?.value} note={`${data.expense_count || 0} 笔 · 台账合计 ${compactMoney(expenseTotal)}`} tone="expense" onClick={openCreate} />
        </section>

        <section className="profit-grid">
          <article className="profit-card profit-card--trend">
            <div className="profit-card-head"><div><span>12 MONTH TREND</span><h2>利润趋势</h2><p>渠道结算 vs 管理口径经营利润</p></div><div className="profit-legend"><span className="is-revenue">渠道结算</span><span className="is-profit">经营利润</span></div></div>
            <ProfitTrend rows={data.trend || []} />
            <div className="profit-table-wrap"><table><thead><tr><th>月份</th><th>渠道结算</th><th>研发</th><th>服务器</th><th>经营费用</th><th>经营利润</th><th>利润率</th></tr></thead><tbody>{(data.trend || []).slice().reverse().map((row) => <tr key={row.month} className={row.month === data.month ? 'is-current' : ''}><td>{monthLabel(row.month)}</td><td>{money(row.channel_settlement)}</td><td>{money(row.rd_cost)}</td><td>{money(row.server_cost)}</td><td>{money(row.operating_expense)}</td><td className={Number(row.operating_profit) < 0 ? 'is-negative' : 'is-positive'}>{money(row.operating_profit)}</td><td>{Number(row.profit_margin || 0).toFixed(1)}%</td></tr>)}</tbody></table></div>
          </article>

          <article className="profit-card profit-card--categories">
            <div className="profit-card-head"><div><span>EXPENSE MIX</span><h2>费用结构</h2><p>本月 {data.expense_count || 0} 笔经营费用</p></div></div>
            <div className="profit-category-list">{(data.expense_categories || []).length === 0 ? <div className="profit-empty">本月尚未录入经营费用。</div> : null}{(data.expense_categories || []).map((row) => <div key={row.category}><div><span>{CATEGORY_LABELS[row.category] || row.category}</span><strong>{money(row.amount)}</strong><small>{Number(row.share_percent || 0).toFixed(1)}%</small></div><div className="profit-category-track"><i style={{ width: `${Math.max(2, Number(row.amount || 0) / categoryMax * 100)}%` }} /></div></div>)}</div>
            <div className="profit-shared-summary"><div><span>已归属到产品</span><strong>{money(data.attributed_expense?.value)}</strong></div><div><span>公司公共费用</span><strong>{money(data.shared_expense?.value)}</strong></div></div>
          </article>
        </section>

        <section className="profit-card profit-card--games">
          <div className="profit-card-head"><div><span>PRODUCT PROFITABILITY</span><h2>产品可归属利润</h2><p>只扣游戏可明确归属费用；公共费用 {money(data.shared_expense?.value)} 未强行分摊。</p></div></div>
          <div className="profit-table-wrap"><table><thead><tr><th>#</th><th>游戏</th><th>渠道结算</th><th>研发成本</th><th>服务器分摊</th><th>归属费用</th><th>可归属利润</th><th>利润率</th></tr></thead><tbody>{(data.games || []).length === 0 ? <tr><td colSpan={8} className="profit-empty-cell">当前月份暂无可分析产品。</td></tr> : null}{(data.games || []).map((row, index) => <tr key={row.game_name}><td>{index + 1}</td><td><strong>{row.game_name}</strong></td><td>{money(row.channel_settlement)}</td><td>{money(row.rd_cost)}</td><td>{money(row.server_cost_allocated)}</td><td>{money(row.attributed_expense)}</td><td className={Number(row.attributable_profit) < 0 ? 'is-negative' : 'is-positive'}><strong>{money(row.attributable_profit)}</strong></td><td>{Number(row.attributable_margin || 0).toFixed(1)}%</td></tr>)}</tbody></table></div>
        </section>

        <section className="profit-card profit-card--ledger">
          <div className="profit-card-head"><div><span>OPERATING EXPENSE LEDGER</span><h2>经营费用台账</h2><p>{monthLabel(data.month)} · 共 {expenses.length} 笔 · {money(expenseTotal)}</p></div><button type="button" onClick={openCreate}>+ 录入费用</button></div>
          <div className="profit-table-wrap"><table><thead><tr><th>日期</th><th>分类</th><th>归属游戏</th><th>往来方 / 平台</th><th>备注</th><th>金额</th><th>操作</th></tr></thead><tbody>{expenses.length === 0 ? <tr><td colSpan={7} className="profit-empty-cell">本月尚未录入经营费用。</td></tr> : null}{expenses.map((expense) => <tr key={expense.id}><td>{expense.expense_date || '-'}</td><td>{CATEGORY_LABELS[expense.category] || expense.category}</td><td>{expense.game_name || <span className="profit-shared-tag">公共费用</span>}</td><td>{expense.vendor_name || '-'}</td><td className="profit-remark">{expense.remark || '-'}</td><td><strong>{money(expense.amount)}</strong></td><td><div className="profit-row-actions"><button type="button" onClick={() => openEdit(expense)}>编辑</button><button type="button" className="is-danger" onClick={() => removeExpense(expense)}>删除</button></div></td></tr>)}</tbody></table></div>
        </section>

        <section className="profit-methodology"><strong>口径说明</strong><div>{(data.notes || []).map((note, index) => <p key={`${index}-${note}`}>{index + 1}. {note}</p>)}</div></section>
      </> : null}

      {editorOpen ? <div className="profit-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor() }}><section className="profit-editor" role="dialog" aria-modal="true" aria-label={editingId ? '编辑经营费用' : '录入经营费用'}><header><div><span>{monthLabel(data?.month)}</span><h2>{editingId ? '编辑经营费用' : '录入经营费用'}</h2></div><button type="button" onClick={closeEditor} aria-label="关闭">×</button></header><form onSubmit={saveExpense}><div className="profit-editor-grid"><label><span>费用分类 *</span><select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>{CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>金额 *</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" required /></label><label><span>发生日期</span><input type="date" value={form.expenseDate} onChange={(event) => setForm((current) => ({ ...current, expenseDate: event.target.value }))} /></label><label><span>归属游戏</span><input list="profit-game-options" value={form.gameName} onChange={(event) => setForm((current) => ({ ...current, gameName: event.target.value }))} placeholder="留空 = 公司公共费用" /><datalist id="profit-game-options">{gameNames.map((name) => <option value={name} key={name} />)}</datalist></label><label className="is-wide"><span>往来方 / 平台</span><input value={form.vendorName} onChange={(event) => setForm((current) => ({ ...current, vendorName: event.target.value }))} placeholder="例如 Meta、办公室物业、银行等" /></label><label className="is-wide"><span>备注</span><textarea rows={3} value={form.remark} onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))} placeholder="记录费用用途、对应项目或核对说明" /></label></div><div className="profit-editor-note">归属游戏留空时计入公司公共费用；公共费用会扣减公司经营利润，但不会强行分摊到游戏利润。</div><footer><button type="button" onClick={closeEditor}>取消</button><button type="submit" className="is-primary" disabled={saving}>{saving ? '保存中…' : editingId ? '保存修改' : '确认录入'}</button></footer></form></section></div> : null}
    </PageContainer>
  )
}
