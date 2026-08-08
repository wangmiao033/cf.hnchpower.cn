import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { canOpenView } from '@/app/viewPermissions.js'
import { VIEWS } from '@/app/routes.js'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { listContracts } from '@/lib/api/contract.ts'
import { getWorkbenchTodos } from '@/lib/api/workbench.ts'
import './CoreDashboardPage.css'
import './CoreDashboardTodo.css'

const TODO_TARGETS = Object.freeze({
  'recon-rd': VIEWS.RECON_RD,
  'recon-channel': VIEWS.RECON_CHANNEL,
  'bank-reconciliation': VIEWS.BANK_RECONCILIATION,
  'invoice-input': VIEWS.INVOICE_INPUT,
  'invoice-manage': VIEWS.INVOICE_MANAGE,
  contracts: VIEWS.CONTRACTS,
  anomalies: VIEWS.ANOMALIES
})

function currency(value) {
  const n = Number(value || 0)
  return `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function percent(value) {
  return `${Math.max(0, Math.min(100, Math.round(Number(value || 0))))}%`
}

function formatGeneratedTime(value) {
  if (!value) return '刚刚更新'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚更新'
  return `更新于 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`
}

function parsePeriod(value) {
  const raw = String(value || '').trim()
  if (!raw || raw === '未设置') return null

  const match = raw.match(/(20\d{2})\D{0,3}(1[0-2]|0?[1-9])(?:\D|$)/)
  if (match) {
    const year = Number(match[1])
    const month = Number(match[2])
    return { key: year * 100 + month, label: `${year}年${month}月` }
  }

  const compact = raw.match(/^(20\d{2})(1[0-2]|0[1-9])$/)
  if (compact) {
    const year = Number(compact[1])
    const month = Number(compact[2])
    return { key: year * 100 + month, label: `${year}年${month}月` }
  }
  return null
}

function resolveSettlementPeriod(configuredPeriod, rows) {
  const configured = parsePeriod(configuredPeriod)
  if (configured) return { ...configured, source: '系统账期' }

  const recordPeriods = rows
    .flatMap((row) => [
      row?.settlementMonth,
      row?.billMonth,
      row?.accountMonth,
      row?.month,
      row?.period,
      row?.date
    ])
    .map(parsePeriod)
    .filter(Boolean)
    .sort((left, right) => right.key - left.key)

  if (recordPeriods[0]) return { ...recordPeriods[0], source: '最新账单月份' }

  const now = new Date()
  return {
    key: now.getFullYear() * 100 + now.getMonth() + 1,
    label: `${now.getFullYear()}年${now.getMonth() + 1}月`,
    source: '当前月份'
  }
}

function todoView(item) {
  return TODO_TARGETS[item?.target] || null
}

function CoreDashboardPage() {
  const { can } = useAuth()
  const { recon, settings, setActiveView } = useAppState()
  const rdRecords = recon.records || []
  const channelRecords = recon.channelRecords || []
  const partners = settings.partners || []

  const [contractSummary, setContractSummary] = useState({
    total: 0,
    linked: 0,
    amount_total: '0',
    expiring_30: 0,
    expired: 0
  })
  const [todoData, setTodoData] = useState(null)
  const [todoLoading, setTodoLoading] = useState(true)
  const [todoError, setTodoError] = useState('')

  const loadTodos = useCallback(async () => {
    setTodoLoading(true)
    setTodoError('')
    try {
      setTodoData(await getWorkbenchTodos())
    } catch (error) {
      console.error(error)
      setTodoError(error instanceof Error ? error.message : '今日待办读取失败')
    } finally {
      setTodoLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTodos()
  }, [loadTodos])

  useEffect(() => {
    if (!can('contracts.view')) return undefined
    let active = true
    listContracts({ limit: 1, offset: 0 })
      .then((response) => {
        if (active && response?.summary) {
          setContractSummary((current) => ({ ...current, ...response.summary }))
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [can])

  const rdTotal = rdRecords.reduce((sum, row) => sum + Number(row.settlementAmount || 0), 0)
  const channelTotal = channelRecords.reduce(
    (sum, row) => sum + Number(row.settlementAmount ?? row.totalAmount ?? row.amount ?? 0),
    0
  )
  const rdPendingRows = rdRecords.filter((row) => ['draft', 'pending', ''].includes(String(row.status || 'pending').toLowerCase()))
  const channelPendingRows = channelRecords.filter((row) => ['draft', 'pending', ''].includes(String(row.status || 'pending').toLowerCase()))
  const totalPendingCount = rdPendingRows.length + channelPendingRows.length
  const allRecords = [...rdRecords, ...channelRecords]
  const settlementPeriod = resolveSettlementPeriod(settings.settlementMonth, allRecords)
  const billCount = allRecords.length
  const completedBillCount = Math.max(0, billCount - totalPendingCount)
  const billCompletionRate = billCount > 0 ? (completedBillCount / billCount) * 100 : 100
  const settlementTotal = rdTotal + channelTotal
  const rdShare = settlementTotal > 0 ? (rdTotal / settlementTotal) * 100 : 0
  const channelShare = settlementTotal > 0 ? (channelTotal / settlementTotal) * 100 : 0
  const contractTotal = Number(contractSummary.total || 0)
  const contractLinked = Number(contractSummary.linked || 0)
  const contractLinkRate = contractTotal > 0 ? (contractLinked / contractTotal) * 100 : 0

  const fallbackTodos = useMemo(() => {
    const items = []
    if (can('reconciliation.view') && rdPendingRows.length) {
      items.push({
        key: 'rd_review',
        label: '研发账单待核对',
        count: rdPendingRows.length,
        amount: rdPendingRows.reduce((sum, row) => sum + Number(row.settlementAmount || 0), 0),
        severity: 'warning',
        description: '工作台聚合接口暂不可用，先按本地账单数据展示。',
        detail: '可以正常进入研发账单继续核对。',
        target: 'recon-rd',
        action_label: '去核对'
      })
    }
    if (can('reconciliation.view') && channelPendingRows.length) {
      items.push({
        key: 'channel_review',
        label: '渠道账单待核对',
        count: channelPendingRows.length,
        amount: channelPendingRows.reduce(
          (sum, row) => sum + Number(row.settlementAmount ?? row.totalAmount ?? row.amount ?? 0),
          0
        ),
        severity: 'warning',
        description: '工作台聚合接口暂不可用，先按本地账单数据展示。',
        detail: '可以正常进入渠道账单继续核对。',
        target: 'recon-channel',
        action_label: '去核对'
      })
    }
    return items
  }, [can, channelPendingRows, rdPendingRows])

  const todoItems = todoData?.items || fallbackTodos
  const fallbackTotal = fallbackTodos.reduce((sum, item) => sum + item.count, 0)
  const todoSummary = todoData?.summary || {
    total_count: fallbackTotal,
    urgent_count: 0,
    review_count: totalPendingCount,
    receivable_amount: 0,
    payable_amount: 0,
    invoice_gap_amount: 0
  }

  const headlineMetrics = useMemo(() => {
    const items = [
      {
        label: '今日待办',
        value: `${todoSummary.total_count} 项`,
        note: todoSummary.total_count ? '按优先级逐项处理' : '今天没有待处理事项',
        tone: todoSummary.total_count ? 'warning' : 'clear',
        view: todoView(todoItems[0])
      }
    ]
    if (can('reconciliation.view')) {
      items.push({
        label: '待核对',
        value: `${todoSummary.review_count} 笔`,
        note: todoSummary.review_count ? '研发 + 渠道待确认' : '账单核对已清',
        tone: todoSummary.review_count ? 'rd' : 'clear',
        view: VIEWS.RECON_PROGRESS
      })
    }
    if (can('funds.view')) {
      items.push(
        {
          label: '当前待收',
          value: currency(todoSummary.receivable_amount),
          note: '渠道未收余额',
          tone: 'channel',
          view: VIEWS.BANK_RECONCILIATION
        },
        {
          label: '当前待付',
          value: currency(todoSummary.payable_amount),
          note: '研发未付余额',
          tone: 'total',
          view: VIEWS.BANK_RECONCILIATION
        }
      )
    } else if (can('invoices.view')) {
      items.push({
        label: '发票缺口',
        value: currency(todoSummary.invoice_gap_amount),
        note: '已核对账单未覆盖金额',
        tone: 'total',
        view: VIEWS.INVOICE_MANAGE
      })
    }
    if (can('anomalies.view')) {
      items.push({
        label: '紧急风险',
        value: `${todoSummary.urgent_count} 项`,
        note: todoSummary.urgent_count ? '建议优先处理' : '暂无高风险信号',
        tone: todoSummary.urgent_count ? 'danger' : 'clear',
        view: VIEWS.ANOMALIES
      })
    }
    return items.slice(0, 5)
  }, [can, todoItems, todoSummary])

  const operationProgress = [
    {
      label: '账单完成度',
      value: percent(billCompletionRate),
      note: `${completedBillCount} / ${billCount} 笔已完成核对`,
      progress: billCompletionRate,
      tone: 'blue',
      view: VIEWS.RECON_PROGRESS
    },
    {
      label: '研发金额占比',
      value: percent(rdShare),
      note: currency(rdTotal),
      progress: rdShare,
      tone: 'indigo',
      view: VIEWS.RECON_RD
    },
    {
      label: '渠道金额占比',
      value: percent(channelShare),
      note: currency(channelTotal),
      progress: channelShare,
      tone: 'green',
      view: VIEWS.RECON_CHANNEL
    },
    {
      label: '合同关联率',
      value: contractTotal > 0 ? percent(contractLinkRate) : '暂无合同',
      note: contractTotal > 0 ? `${contractLinked} / ${contractTotal} 份已关联` : '录入合同后自动统计',
      progress: contractLinkRate,
      tone: 'violet',
      view: VIEWS.CONTRACTS
    }
  ].filter((item) => canOpenView(can, item.view))

  const modules = [
    { name: '研发账单', count: `${rdRecords.length} 笔`, meta: currency(rdTotal), view: VIEWS.RECON_RD, tone: 'blue', mark: '研' },
    { name: '渠道账单', count: `${channelRecords.length} 笔`, meta: currency(channelTotal), view: VIEWS.RECON_CHANNEL, tone: 'green', mark: '渠' },
    { name: '银行核销', count: '自动匹配', meta: '收付款与流水闭环', view: VIEWS.BANK_RECONCILIATION, tone: 'blue', mark: '核' },
    { name: '合同台账', count: `${contractTotal} 份`, meta: currency(contractSummary.amount_total), view: VIEWS.CONTRACTS, tone: 'violet', mark: '合' },
    { name: '发票中心', count: '销项 / 进项', meta: '发票覆盖与红冲', view: VIEWS.INVOICE_MANAGE, tone: 'cyan', mark: '票' },
    { name: '异常中心', count: '智能巡检', meta: '风险与处理建议', view: VIEWS.ANOMALIES, tone: 'amber', mark: '异' },
    { name: '数据库', count: '流水核验', meta: '批次与原始明细', view: VIEWS.QUICKSDK_LIBRARY, tone: 'amber', mark: '流' },
    { name: '客户库', count: `${partners.length} 个`, meta: '合作方资料', view: VIEWS.PARTNER_CONTACTS, tone: 'slate', mark: '客' }
  ].filter((item) => canOpenView(can, item.view))

  const openTodo = (item) => {
    const view = todoView(item)
    if (view) setActiveView(view)
  }

  return (
    <PageContainer hideHeader className="core-dashboard-page">
      <section className="core-dashboard-overview core-dashboard-overview--todo" aria-label="今日工作台概览">
        <div className="core-dashboard-overview__head">
          <div className="core-dashboard-period">
            <span>当前账期</span>
            <strong>{settlementPeriod.label}</strong>
            <small>依据：{settlementPeriod.source} · {formatGeneratedTime(todoData?.generated_at)}</small>
          </div>
          <div className="core-dashboard-primary-actions" aria-label="快捷操作">
            {can('reconciliation.manage') ? (
              <>
                <button type="button" className="is-primary" onClick={() => setActiveView(VIEWS.RECON_CREATE)}>
                  新增研发账单
                </button>
                <button type="button" onClick={() => setActiveView(VIEWS.CHANNEL_RECON_CREATE)}>
                  新增渠道账单
                </button>
              </>
            ) : null}
            {can('reconciliation.view') ? (
              <button type="button" onClick={() => setActiveView(VIEWS.RECON_PROGRESS)}>查看对账进度</button>
            ) : null}
          </div>
        </div>
        <div className="core-dashboard-metric-grid core-dashboard-metric-grid--todo">
          {headlineMetrics.map((metric) => (
            <button
              type="button"
              key={metric.label}
              className={`core-dashboard-metric core-dashboard-metric--${metric.tone}`}
              onClick={() => metric.view && setActiveView(metric.view)}
              disabled={!metric.view}
            >
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.note}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="core-dashboard-attention core-dashboard-todo-center" aria-label="今日待办">
        <div className="core-dashboard-section-title core-dashboard-todo-title">
          <div>
            <strong>今日待办</strong>
            <span>只展示你有权限处理的事项；风险提示不会重复计入待办总数</span>
          </div>
          <div className="core-dashboard-todo-tools">
            {todoError ? <span className="core-dashboard-todo-error">部分数据读取失败，已显示可用数据</span> : null}
            <em className={todoSummary.total_count === 0 ? 'is-clear' : ''}>{todoSummary.total_count} 项</em>
            <button type="button" onClick={() => void loadTodos()} disabled={todoLoading}>
              {todoLoading ? '刷新中…' : '刷新'}
            </button>
          </div>
        </div>

        {todoLoading && !todoData ? (
          <div className="core-dashboard-todo-loading">
            <span />
            <strong>正在整理今天的待办…</strong>
            <small>账单、资金、发票、合同、异常和银行核销一次汇总</small>
          </div>
        ) : todoItems.length > 0 ? (
          <div className="core-dashboard-todo-grid">
            {todoItems.map((item) => (
              <button
                type="button"
                key={item.key}
                className={`core-dashboard-todo-card is-${item.severity}`}
                onClick={() => openTodo(item)}
                disabled={!todoView(item)}
              >
                <span className="core-dashboard-todo-card__head">
                  <span className="core-dashboard-todo-badge">
                    {item.severity === 'critical' ? '优先' : item.severity === 'warning' ? '待处理' : '可确认'}
                  </span>
                  <span>{item.action_label} ›</span>
                </span>
                <span className="core-dashboard-todo-card__value">
                  <strong>{item.count}</strong>
                  <span>{item.amount != null ? currency(item.amount) : '项'}</span>
                </span>
                <strong className="core-dashboard-todo-card__label">{item.label}</strong>
                <span className="core-dashboard-todo-card__description">{item.description}</span>
                {item.detail ? <small>{item.detail}</small> : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="core-dashboard-clear-state core-dashboard-clear-state--todo">
            <span aria-hidden="true">✓</span>
            <strong>今天的待办已经清空</strong>
            <small>当前没有待核对、资金、发票、合同或高风险事项需要你处理</small>
            <i aria-hidden="true">可以继续查看经营驾驶舱</i>
          </div>
        )}
      </section>

      <section className="core-dashboard-progress" aria-label="本期业务快照">
        <div className="core-dashboard-section-title">
          <div>
            <strong>本期业务快照</strong>
            <span>待办负责“今天做什么”，这里保留账期结构与完成度</span>
          </div>
          {can('analytics.view') ? (
            <button type="button" className="core-dashboard-inline-action" onClick={() => setActiveView(VIEWS.BUSINESS_DASHBOARD)}>
              经营驾驶舱 ›
            </button>
          ) : null}
        </div>
        <div className="core-dashboard-progress-grid">
          {operationProgress.map((item) => (
            <button
              type="button"
              key={item.label}
              className={`core-dashboard-progress-card core-dashboard-progress-card--${item.tone}`}
              onClick={() => setActiveView(item.view)}
            >
              <span className="core-dashboard-progress-card__head">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </span>
              <span className="core-dashboard-progress-card__track" aria-hidden="true">
                <i style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} />
              </span>
              <small>{item.note}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="core-dashboard-modules" aria-label="业务入口">
        <div className="core-dashboard-section-title">
          <div>
            <strong>业务入口</strong>
            <span>只显示当前账号有权限访问的模块</span>
          </div>
        </div>
        <div className="core-dashboard-module-grid">
          {modules.map((module) => (
            <button
              type="button"
              key={module.name}
              className={`core-module-card core-module-card--${module.tone}`}
              onClick={() => setActiveView(module.view)}
            >
              <span className="core-module-card__mark" aria-hidden="true">{module.mark}</span>
              <span className="core-module-card__copy">
                <strong>{module.name}</strong>
                <small>{module.meta}</small>
              </span>
              <span className="core-module-card__count">{module.count}</span>
              <i aria-hidden="true">›</i>
            </button>
          ))}
        </div>
      </section>
    </PageContainer>
  )
}

export default CoreDashboardPage
