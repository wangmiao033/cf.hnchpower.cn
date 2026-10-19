import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { canOpenView } from '@/app/viewPermissions.js'
import { VIEWS } from '@/app/routes.js'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { getWorkbenchTodos } from '@/lib/api/workbench.ts'
import { getProfitAnalysis } from '@/lib/api/profitAnalysis.ts'
import './CoreDashboardV3.css'

const TASK_VIEWS = Object.freeze({
  'recon-rd': VIEWS.RECON_RD,
  'recon-channel': VIEWS.RECON_CHANNEL,
  'bank-reconciliation': VIEWS.BANK_RECONCILIATION,
  'invoice-input': VIEWS.INVOICE_INPUT,
  'invoice-manage': VIEWS.INVOICE_MANAGE,
  contracts: VIEWS.CONTRACTS,
  anomalies: VIEWS.ANOMALIES
})
const TASK_TYPES = Object.freeze({
  rd_review: 'review', channel_review: 'review',
  rd_payable: 'funds', channel_receivable: 'funds', bank_auto_ready: 'funds',
  input_invoice_gap: 'invoices', output_invoice_gap: 'invoices',
  contract_expiry: 'other', risk_alerts: 'other', channel_cumulative_ready: 'other'
})
const TASK_ORDER = ['channel_review', 'rd_review', 'channel_receivable', 'rd_payable', 'output_invoice_gap', 'input_invoice_gap']
const GLYPHS = {
  trend: 'M3 17l6-6 4 3 8-9M14 5h7v7',
  game: 'M6 12h4m-2-2v4m7-1h.01m3-2h.01M5 6h14a3 3 0 0 1 3 3l-1 8a3 3 0 0 1-5 1l-2-2H9l-2 2a3 3 0 0 1-5-1L2 9a3 3 0 0 1 3-3z',
  wallet: 'M3 7h18v13H3zM3 7V5a2 2 0 0 1 2-2h14M16 14h2',
  income: 'M7 7v10h10M7 17 18 6M12 6h6v6',
  expense: 'M6 6h12v12M6 18 18 6',
  clipboard: 'M8 4h8M9 2h6v4H9zM5 4h14v18H5zM9 13l2 2 4-4',
  check: 'M20 7l-10 10-5-5M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  refresh: 'M20 11a8 8 0 0 0-14-5L4 8m0-4v4h4M4 13a8 8 0 0 0 14 5l2-2m0 4v-4h-4',
  calendar: 'M3 6h18v15H3zM7 3v6m10-6v6M3 11h18',
  plus: 'M12 5v14M5 12h14',
  chevron: 'm9 18 6-6-6-6',
  alert: 'M12 8v5m0 4h.01M12 2 2 21h20L12 2z',
  info: 'M12 11v6M12 7h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  file: 'M7 3h8l5 5v13H4V3h3m8 0v5h5M8 13h8M8 17h7',
  bank: 'M3 10l9-7 9 7M4 10h16M5 10v9m5-9v9m4-9v9m5-9v9M3 21h18',
  receipt: 'M5 3h14v18l-3-2-4 2-4-2-3 2V3M8 8h8M8 12h8M8 16h5',
  spark: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z'
}
function Icon({ name, size = 18 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={GLYPHS[name] || GLYPHS.info} /></svg>
}
const n = (value) => Number(value || 0)
const hasValue = (value) => value !== null && value !== undefined && Number.isFinite(Number(value))
const moneyExact = (value) => hasValue(value) ? '¥' + Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
function compactMoney(value) {
  if (!hasValue(value)) return '—'
  const amount = Number(value)
  const sign = amount < 0 ? '−' : ''
  const abs = Math.abs(amount)
  if (abs >= 10000) return sign + (abs / 10000).toFixed(2) + ' 万元'
  return sign + '¥' + abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pct(value) { return hasValue(value) ? Number(value).toFixed(1) + '%' : '—' }
function changePct(current, previous) {
  if (!hasValue(current) || !hasValue(previous) || Math.abs(Number(previous)) < 0.005) return null
  return (Number(current) - Number(previous)) / Math.abs(Number(previous)) * 100
}
function formatMonth(key) {
  return /^\d{4}-\d{2}$/.test(String(key || ''))
    ? String(key).slice(0, 4) + '年' + Number(String(key).slice(5)) + '月' : '最新有数据账期'
}
function accessibleTarget(can, item) {
  const target = TASK_VIEWS[item?.target]
  return target && canOpenView(can, target) ? target : null
}
function TrendChart({ rows, mode }) {
  const data = (rows || []).slice(mode === '6' ? -6 : -12)
  if (data.length === 0) return <div className="fv3-empty">暂无历史趋势数据</div>
  const values = data.flatMap(row => [Number(row.operating_profit || 0), Number(row.project_gross_profit || 0)])
  const grossAvailable = data.some(row => hasValue(row.project_gross_profit))
  const series = grossAvailable ? values : data.map(row => n(row.operating_profit))
  const bottom = Math.min(0, ...series)
  const top = Math.max(1, ...series)
  const diff = Math.max(1, top - bottom)
  const x = (i) => 44 + i * 530 / Math.max(data.length - 1, 1)
  const y = (v) => 215 - (n(v) - bottom) / diff * 166
  const draw = (key) => data.map((row, index) => (index ? 'L' : 'M') + x(index).toFixed(1) + ',' + y(row[key]).toFixed(1)).join(' ')
  return <div className="fv3-chart-wrap">
    <svg viewBox="0 0 620 264" role="img" aria-label={grossAvailable ? '每月游戏业务利润与公司经营利润' : '每月公司经营利润'}>
      {[0, 1, 2, 3, 4].map(k => {
        const value = bottom + (top - bottom) * (4 - k) / 4
        const position = y(value)
        return <g key={k}><line x1="42" y1={position} x2="584" y2={position} stroke="#e8eef7" strokeDasharray="4 5" /><text x="32" y={position + 4} fill="#94a3b8" fontSize="11" textAnchor="end">{(value / 10000).toFixed(value >= 10000 ? 0 : 1)}</text></g>
      })}
      {bottom < 0 && <line x1="42" y1={y(0)} x2="584" y2={y(0)} stroke="#cbd5e1" />}
      <path d={draw('operating_profit')} fill="none" stroke="#4779ef" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      {grossAvailable && <path d={draw('project_gross_profit')} fill="none" stroke="#16ad85" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />}
      {data.map((row, i) => <g key={row.month}>
        <circle cx={x(i)} cy={y(row.operating_profit)} r="4.2" fill="#fff" stroke="#4779ef" strokeWidth="2.5"><title>{formatMonth(row.month) + ' 经营利润 ' + moneyExact(row.operating_profit)}</title></circle>
        {grossAvailable && <circle cx={x(i)} cy={y(row.project_gross_profit)} r="4" fill="#fff" stroke="#16ad85" strokeWidth="2.3"><title>{formatMonth(row.month) + ' 游戏毛利 ' + moneyExact(row.project_gross_profit)}</title></circle>}
        <text x={x(i)} y="247" fill="#94a3b8" fontSize="11" textAnchor="middle">{String(row.month).slice(5)}月</text>
      </g>)}
    </svg>
  </div>
}
function ProfitCard({ name, note, amount, prior, rate, footnote, icon, kind, loading, onClick }) {
  const delta = changePct(amount, prior)
  return <button type="button" className={'fv3-profit-card fv3-card fv3-' + kind} onClick={onClick}>
    <span className="fv3-profit-top">
      <span className="fv3-profit-id"><span className="fv3-icon"><Icon name={icon} size={21}/></span><span><strong>{name}</strong><small>{note}</small></span></span>
      <span className="fv3-source">管理口径</span>
    </span>
    <span className={'fv3-profit-amount' + (hasValue(amount) && n(amount) < 0 ? ' is-loss' : '')} title={moneyExact(amount)}>{loading ? '读取中…' : compactMoney(amount)}</span>
    <span className="fv3-profit-meta">
      <span>依据当期结算及已录入费用测算</span>
      {delta != null && <span className={delta < 0 ? 'fv3-down' : 'fv3-up'}>{delta >= 0 ? '↑' : '↓'} 较上月 {Math.abs(delta).toFixed(1)}%</span>}
    </span>
    <span className="fv3-profit-bottom"><span>利润率 <b>{pct(rate)}</b></span><span>{footnote} <Icon name="chevron" size={14}/></span></span>
  </button>
}
function StatCard({ name, amount, note, icon, kind, onClick }) {
  return <button type="button" className={'fv3-stat fv3-card fv3-' + kind} onClick={onClick} disabled={!onClick}>
    <span className="fv3-stat-icon"><Icon name={icon} size={20}/></span>
    <span className="fv3-stat-content"><span>{name}</span><strong title={typeof amount === 'number' ? moneyExact(amount) : undefined}>{typeof amount === 'number' ? compactMoney(amount) : amount}</strong><small>{note}</small></span>
  </button>
}
function CoreDashboardV3() {
  const { can } = useAuth()
  const { setActiveView, recon, settings } = useAppState()
  const [profit, setProfit] = useState(null)
  const [profitLoading, setProfitLoading] = useState(false)
  const [profitError, setProfitError] = useState('')
  const [todos, setTodos] = useState(null)
  const [todoLoading, setTodoLoading] = useState(false)
  const [todoError, setTodoError] = useState('')
  const [month, setMonth] = useState('')
  const [range, setRange] = useState('6')
  const [tab, setTab] = useState('all')
  const [newBillOpen, setNewBillOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const canProfit = can('analytics.view')
  const canRecon = can('reconciliation.view')
  const canFunds = can('funds.view')
  const canInvoice = can('invoices.view')
  const canContract = can('contracts.view')
  const canRisk = can('anomalies.view')
  const refresh = useCallback(() => setRevision(current => current + 1), [])
  useEffect(() => {
    if (!canProfit) return undefined
    let cancelled = false
    setProfitLoading(true)
    setProfitError('')
    getProfitAnalysis({ month: month || undefined, trendMonths: 12 })
      .then(result => { if (!cancelled) setProfit(result) })
      .catch(error => { if (!cancelled) { setProfit(null); setProfitError(error instanceof Error ? error.message : '利润数据加载失败') } })
      .finally(() => { if (!cancelled) setProfitLoading(false) })
    return () => { cancelled = true }
  }, [canProfit, month, revision])
  useEffect(() => {
    let cancelled = false
    setTodoLoading(true)
    setTodoError('')
    getWorkbenchTodos()
      .then(result => { if (!cancelled) setTodos(result) })
      .catch(error => { if (!cancelled) { setTodoError(error instanceof Error ? error.message : '财务待办加载失败'); setTodos(null) } })
      .finally(() => { if (!cancelled) setTodoLoading(false) })
    return () => { cancelled = true }
  }, [revision])
  const selectedMonth = month || profit?.month || ''
  const hasPeriodData = Boolean(profit?.available_months?.includes(profit?.month))
  const current = hasPeriodData ? profit?.operating_profit?.value : null
  const shared = hasPeriodData ? n(profit.shared_expense?.value) + n(profit.shared_server_cost?.value) : null
  const priorShared = hasPeriodData ? n(profit.shared_expense?.previous_value) + n(profit.shared_server_cost?.previous_value) : null
  const gross = hasPeriodData ? n(current) + n(shared) : null
  const priorGross = hasPeriodData ? n(profit.operating_profit?.previous_value) + n(priorShared) : null
  const grossRate = hasPeriodData && n(profit.channel_settlement?.value) > 0 ? 100 * n(gross) / n(profit.channel_settlement.value) : null
  const summary = todos?.summary || null
  const todoItems = useMemo(() => (todos?.items || [])
    .filter(item => item.key !== 'risk_alerts')
    .sort((a, b) => {
      const i = TASK_ORDER.indexOf(a.key); const j = TASK_ORDER.indexOf(b.key)
      return (i < 0 ? 100 : i) - (j < 0 ? 100 : j)
    }), [todos])
  const visibleTasks = todoItems.filter(item => tab === 'all' || (TASK_TYPES[item.key] || 'other') === tab)
  const totalBills = todos?.snapshot
    ? n(todos.snapshot.rd_bill_count) + n(todos.snapshot.channel_bill_count)
    : (recon?.records?.length || 0) + (recon?.channelRecords?.length || 0)
  const reviewCount = summary?.review_count ?? null
  const completed = reviewCount == null ? null : Math.max(0, totalBills - n(reviewCount))
  const completionRate = totalBills > 0 && completed != null ? Math.round(completed / totalBills * 100) : null
  const games = (profit?.games || []).slice(0, 5)
  const warnings = []
  if (profitError) warnings.push({ title: '利润数据读取失败', note: '请检查连接并刷新，当前不显示模拟利润。', tone: 'danger', view: null })
  if (todoError) warnings.push({ title: '待办数据读取失败', note: '资金、发票和核销数据可能不完整。', tone: 'danger', view: null })
  if (canRisk && summary?.urgent_count > 0) warnings.push({ title: '高风险异常', note: summary.urgent_count + ' 项需要核查', tone: 'danger', view: VIEWS.ANOMALIES })
  if (canContract) warnings.push({ title: '合同关联检查', note: '查看未关联合同、到期及履约状态', tone: 'info', view: VIEWS.CONTRACTS })
  if (canInvoice && todoItems.some(item => TASK_TYPES[item.key] === 'invoices')) warnings.push({ title: '发票覆盖待处理', note: '有已核对账单尚未完全匹配有效发票', tone: 'warning', view: VIEWS.INVOICE_MANAGE })
  if (canProfit) warnings.push({ title: '利润为管理测算口径', note: '未核对账单及未录入费用可能影响最终利润', tone: 'info', view: VIEWS.PROFIT_ANALYSIS })
  const go = (view) => { if (view && canOpenView(can, view)) setActiveView(view) }
  return <PageContainer hideHeader className="core-dashboard-v3">
    <div className="fv3-head">
      <div className="fv3-heading"><span className="fv3-heading-icon"><Icon name="trend" size={21}/></span><div><h1>财务工作台</h1><p>经营利润、资金状况与待办进度，一屏掌握</p></div></div>
      <div className="fv3-head-actions">
        {canProfit && <label className="fv3-month"><Icon name="calendar" size={17}/><span className="sr-only">经营月份</span><select aria-label="选择利润账期" value={selectedMonth} onChange={event => { setProfit(null); setMonth(event.target.value) }}>
          {(profit?.available_months?.length ? profit.available_months : selectedMonth ? [selectedMonth] : []).map(key => <option value={key} key={key}>{formatMonth(key)}</option>)}
          {!selectedMonth && <option value="">最新有数据月份</option>}
        </select></label>}
        <button type="button" className="fv3-button" onClick={refresh} disabled={profitLoading || todoLoading}><Icon name="refresh" size={17}/><span>{profitLoading || todoLoading ? '刷新中' : '刷新数据'}</span></button>
        {can('reconciliation.manage') && <div className="fv3-create-wrap">
          <button type="button" className="fv3-button fv3-primary" aria-expanded={newBillOpen} onClick={() => setNewBillOpen(open => !open)}><Icon name="plus" size={18}/>新建账单 <span>⌄</span></button>
          {newBillOpen && <div className="fv3-create-menu"><button type="button" onClick={() => { setNewBillOpen(false); go(VIEWS.RECON_CREATE) }}>新建研发账单</button><button type="button" onClick={() => { setNewBillOpen(false); go(VIEWS.CHANNEL_RECON_CREATE) }}>新建渠道账单</button></div>}
        </div>}
      </div>
    </div>
    <div className="fv3-advisory" role="status"><Icon name="info" size={16}/><span>利润为内部管理口径测算，不等同于法定净利润；待收待付和待办默认统计<strong>全部未结</strong>，与所选利润账期分开。{profitError ? '利润读取失败，请刷新重试。' : ''}</span></div>
    {canProfit && <>
      <div className="fv3-section-heading"><h2><i/>经营利润 <small>游戏表现与公司经营同时展示 · {formatMonth(selectedMonth)}</small></h2><button type="button" onClick={() => go(VIEWS.PROFIT_ANALYSIS)}>完整利润分析 <Icon name="chevron" size={15}/></button></div>
      <div className="fv3-profit-grid">
        <ProfitCard name="游戏业务利润" note="项目可归属毛利 · 不分摊公共费用" amount={gross} prior={priorGross} rate={grossRate} footnote="查看项目毛利明细" icon="game" kind="gross" loading={profitLoading} onClick={() => go(VIEWS.PROFIT_ANALYSIS)}/>
        <ProfitCard name="公司经营利润" note="管理口径 · 扣除已录入全部费用" amount={current} prior={hasPeriodData ? profit?.operating_profit?.previous_value : null} rate={hasPeriodData ? profit?.profit_margin?.value : null} footnote={'公共费用 ' + compactMoney(shared)} icon="wallet" kind="operating" loading={profitLoading} onClick={() => go(VIEWS.PROFIT_ANALYSIS)}/>
      </div>
      {profitError && <div className="fv3-error" role="alert">利润数据不可用：{profitError}。页面不会用演示金额替代真实数据。</div>}
    </>}
    <div className="fv3-stats">
      {canFunds && <StatCard name="渠道待收款" amount={summary?.receivable_amount ?? null} note={summary ? '全部未结 · 尚未收清' : '待获取真实数据'} icon="income" kind="income" onClick={() => go(VIEWS.BANK_RECONCILIATION)}/>}
      {canFunds && <StatCard name="研发待付款" amount={summary?.payable_amount ?? null} note={summary ? '全部未结 · 尚未付清' : '待获取真实数据'} icon="expense" kind="expense" onClick={() => go(VIEWS.BANK_RECONCILIATION)}/>}
      {canRecon && <StatCard name="待核对账单" amount={reviewCount == null ? '—' : String(reviewCount) + ' 笔'} note="全部账期 · 研发及渠道" icon="clipboard" kind="review" onClick={() => go(VIEWS.RECON_PROGRESS)}/>}
      {canRecon && <StatCard name="账单核对完成率" amount={completionRate == null ? '—' : completionRate + '%'} note={completed == null ? '尚未取得核对数据' : completed + ' / ' + totalBills + ' 笔已核对（全部）'} icon="check" kind="completion" onClick={() => go(VIEWS.RECON_PROGRESS)}/>}
    </div>
    <div className="fv3-main-grid">
      <section className="fv3-panel fv3-card" aria-label="财务待办">
        <div className="fv3-panel-head"><div><h2>待办处理 <small>{summary?.total_count == null ? '—' : summary.total_count + ' 项'}</small></h2><p>点击记录直接进入现有处理流程 · 全部未结</p></div>
          <div className="fv3-tabs" role="group" aria-label="筛选待办">
            {[['all', '全部'], ['review', '核对'], ['funds', '资金'], ['invoices', '发票'], ['other', '其他']].map(([id, label]) => <button key={id} type="button" className={tab === id ? 'active' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
          </div>
        </div>
        <div className="fv3-table-scroller"><table className="fv3-tasks"><thead><tr><th>处理事项</th><th>待处理</th><th>涉及金额</th><th>操作</th></tr></thead><tbody>
          {visibleTasks.map(item => {
            const target = accessibleTarget(can, item)
            const kind = TASK_TYPES[item.key] || 'other'
            const icon = kind === 'funds' ? 'bank' : kind === 'invoices' ? 'receipt' : kind === 'review' ? 'file' : 'alert'
            return <tr key={item.key}><td><span className={'fv3-task-icon fv3-' + kind}><Icon name={icon} size={17}/></span><span className="fv3-task-name">{item.label}</span></td><td className="fv3-task-num">{item.count} 项</td><td title={item.amount == null ? '' : moneyExact(item.amount)}>{item.amount == null ? '—' : compactMoney(item.amount)}</td><td>{target ? <button type="button" className="fv3-task-link" onClick={() => go(target)}>{item.action_label || '去处理'} <Icon name="chevron" size={13}/></button> : <span className="fv3-muted">无权限</span>}</td></tr>
          })}
          {visibleTasks.length === 0 && <tr><td colSpan={4} className="fv3-empty">{todoLoading ? '正在加载待办…' : todoError ? '待办加载失败，请点击刷新重试' : '该分类暂无待处理事项'}</td></tr>}
        </tbody></table></div>
        <div className="fv3-panel-foot"><Icon name="info" size={14}/>分类待办可能对应同一张账单，数量不是去重账单数。</div>
      </section>
      {canProfit && <section className="fv3-panel fv3-card" aria-label="利润变化趋势">
        <div className="fv3-panel-head"><div><h2>利润变化趋势</h2><p>月度游戏毛利与公司经营利润 · 万元</p></div><div className="fv3-tabs" role="group" aria-label="选择趋势时间范围">{[['6', '近6个月'], ['12', '近12个月']].map(([id, title]) => <button type="button" key={id} className={range === id ? 'active' : ''} aria-pressed={range === id} onClick={() => setRange(id)}>{title}</button>)}</div></div>
        <div className="fv3-chart-legend"><span><i className="fv3-dot blue"/>公司经营利润</span>{profit?.trend?.some(x => hasValue(x.project_gross_profit)) && <span><i className="fv3-dot green"/>游戏业务利润</span>}<span className="fv3-legend-unit">单位：万元</span></div>
        {profitLoading && !profit ? <div className="fv3-empty">正在读取经营趋势…</div> : <TrendChart rows={profit?.trend} mode={range}/>}
        <div className="fv3-chart-foot"><span>趋势截止 {formatMonth(selectedMonth)}</span><strong>本期经营利润 <b>{compactMoney(current)}</b></strong></div>
      </section>}
    </div>
    <div className="fv3-bottom-grid">
      {canProfit && <section className="fv3-panel fv3-card"><div className="fv3-panel-head"><div><h2>游戏业务利润排行</h2><p>按当期项目可归属利润排序 · 不摊派公共费用</p></div><button type="button" className="fv3-more" onClick={() => go(VIEWS.PROFIT_ANALYSIS)}>查看全部 <Icon name="chevron" size={14}/></button></div>
        <div className="fv3-project-list">{games.length ? games.map((game, index) => <button type="button" className="fv3-project-row" key={game.game_name} onClick={() => go(VIEWS.PROFIT_ANALYSIS)}><span className={'fv3-project-rank rank-' + (index + 1)}>{index + 1}</span><span className="fv3-project-name">{game.game_name}</span><span className="fv3-project-margin">毛利率 {pct(game.attributable_margin)}</span><strong className={n(game.attributable_profit) < 0 ? 'is-loss' : ''} title={moneyExact(game.attributable_profit)}>{compactMoney(game.attributable_profit)}</strong><Icon name="chevron" size={14}/></button>) : <div className="fv3-empty">{profitLoading ? '正在加载项目排行…' : '当前月份暂无可归属的项目数据'}</div>}</div>
      </section>}
      <section className="fv3-panel fv3-card"><div className="fv3-panel-head"><div><h2>经营提醒</h2><p>数据完整性、异常与待处理状态</p></div>{canRisk && <button type="button" className="fv3-more" onClick={() => go(VIEWS.ANOMALIES)}>异常中心 <Icon name="chevron" size={14}/></button>}</div>
        <div className="fv3-alert-list">{warnings.length ? warnings.map((item, i) => <button type="button" key={i} className="fv3-alert-row" onClick={() => go(item.view)} disabled={!item.view}><span className={'fv3-alert-dot fv3-' + item.tone}/><span><strong>{item.title}</strong><small>{item.note}</small></span><Icon name="chevron" size={14}/></button>) : <div className="fv3-empty">暂无需要显示的提醒</div>}</div>
        <div className="fv3-panel-foot">没有执行检测时不会将未检测项目显示为零异常。</div>
      </section>
    </div>
    <p className="fv3-footer">对账管理系统 · 数据来自已登录账户可访问的后台接口 · 详细核算请进入利润分析</p>
  </PageContainer>
}
export default CoreDashboardV3
