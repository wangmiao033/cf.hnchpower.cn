import React, { useEffect, useMemo, useRef, useState } from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'
import {
  getQuickSdkAnalytics,
  getQuickSdkSummary,
  listQuickSdkBatches,
  listQuickSdkFlows
} from '@/lib/api/quicksdk.ts'
import {
  DATABASE_PAGE_SIZES,
  buildQuickSdkBatchParams,
  buildQuickSdkFlowParams,
  getDatabaseViewCounts,
  getPagerRange
} from '@/domain/quicksdk/workspace.js'
import './QuickSdkLibraryPage.css'
import './DatabaseWorkspacePolish.css'
import './DatabaseWorkspaceV2.css'

const DEFAULT_MONTH = new Date().toISOString().slice(0, 7)

const VIEW_OPTIONS = [
  { key: 'overview', label: '数据概览' },
  { key: 'flows', label: '流水明细' },
  { key: 'imports', label: '导入记录' }
]

const SEARCH_SCOPES = [
  { value: 'all', label: '产品或渠道' },
  { value: 'game', label: '仅产品' },
  { value: 'channel', label: '仅渠道' }
]

function money(value) {
  const n = Number(value || 0)
  return `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dateText(value) {
  if (!value) return '-'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('zh-CN', { hour12: false })
}

function monthText(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{1,2})$/)
  if (!match) return value || '-'
  return `${match[1]}年${Number(match[2])}月`
}

function shiftMonthValue(value, amount) {
  const match = String(value || '').match(/^(\d{4})-(\d{1,2})$/)
  if (!match) return DEFAULT_MONTH
  const date = new Date(Number(match[1]), Number(match[2]) - 1 + amount, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function errorText(error, fallback) {
  return error instanceof Error ? error.message : fallback
}

function QuickSdkLibraryPage() {
  const [bootstrapped, setBootstrapped] = useState(false)
  const [month, setMonth] = useState(DEFAULT_MONTH)
  const [latestMonth, setLatestMonth] = useState('')
  const [keyword, setKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')
  const [searchScope, setSearchScope] = useState('all')
  const [activeView, setActiveView] = useState('overview')
  const [summary, setSummary] = useState(null)
  const [latestSelectedBatch, setLatestSelectedBatch] = useState(null)
  const [batches, setBatches] = useState([])
  const [batchTotal, setBatchTotal] = useState(0)
  const [batchPage, setBatchPage] = useState(0)
  const [batchPageSize, setBatchPageSize] = useState(20)
  const [flows, setFlows] = useState([])
  const [flowTotal, setFlowTotal] = useState(0)
  const [flowPage, setFlowPage] = useState(0)
  const [flowPageSize, setFlowPageSize] = useState(20)
  const [analytics, setAnalytics] = useState({ game_rankings: [], channel_rankings: [] })
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [flowLoading, setFlowLoading] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const [flowError, setFlowError] = useState('')
  const [batchError, setBatchError] = useState('')
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const overviewRequestId = useRef(0)
  const flowRequestId = useRef(0)
  const batchRequestId = useRef(0)

  const loadOverview = async (targetMonth = month) => {
    const requestId = ++overviewRequestId.current
    setOverviewLoading(true)
    setOverviewError('')
    try {
      const params = { settlement_month: targetMonth }
      const [summaryRes, latestBatchRes, analyticsRes] = await Promise.all([
        getQuickSdkSummary(params),
        listQuickSdkBatches({ ...params, limit: 1 }),
        getQuickSdkAnalytics(params)
      ])
      if (requestId !== overviewRequestId.current) return
      setSummary(summaryRes)
      setLatestSelectedBatch(latestBatchRes.items?.[0] || null)
      setAnalytics(analyticsRes || { game_rankings: [], channel_rankings: [] })
      setLastUpdatedAt(new Date())
    } catch (error) {
      if (requestId !== overviewRequestId.current) return
      setOverviewError(errorText(error, '数据库概览读取失败'))
    } finally {
      if (requestId === overviewRequestId.current) setOverviewLoading(false)
    }
  }

  const loadFlows = async ({
    targetMonth = month,
    targetKeyword = appliedKeyword,
    targetScope = searchScope,
    targetPage = flowPage,
    targetPageSize = flowPageSize
  } = {}) => {
    const requestId = ++flowRequestId.current
    setFlowLoading(true)
    setFlowError('')
    try {
      const flowRes = await listQuickSdkFlows(
        buildQuickSdkFlowParams({
          month: targetMonth,
          keyword: targetKeyword,
          scope: targetScope,
          page: targetPage,
          pageSize: targetPageSize
        })
      )
      if (requestId !== flowRequestId.current) return
      setFlows(flowRes.items || [])
      setFlowTotal(Number(flowRes.total || 0))
      setLastUpdatedAt(new Date())
    } catch (error) {
      if (requestId !== flowRequestId.current) return
      setFlowError(errorText(error, '流水明细读取失败'))
    } finally {
      if (requestId === flowRequestId.current) setFlowLoading(false)
    }
  }

  const loadBatches = async ({
    targetMonth = month,
    targetPage = batchPage,
    targetPageSize = batchPageSize
  } = {}) => {
    const requestId = ++batchRequestId.current
    setBatchLoading(true)
    setBatchError('')
    try {
      const batchRes = await listQuickSdkBatches(
        buildQuickSdkBatchParams({
          month: targetMonth,
          page: targetPage,
          pageSize: targetPageSize
        })
      )
      if (requestId !== batchRequestId.current) return
      setBatches(batchRes.items || [])
      setBatchTotal(Number(batchRes.total || 0))
      setLastUpdatedAt(new Date())
    } catch (error) {
      if (requestId !== batchRequestId.current) return
      setBatchError(errorText(error, '导入记录读取失败'))
    } finally {
      if (requestId === batchRequestId.current) setBatchLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    listQuickSdkBatches({ limit: 1 })
      .then((response) => {
        const latest = response?.items?.[0]?.settlement_month || ''
        if (cancelled || !latest) return
        setLatestMonth(latest)
        setMonth(latest)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setBootstrapped(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!bootstrapped) return
    loadOverview(month)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped, month])

  useEffect(() => {
    if (!bootstrapped || activeView !== 'flows') return
    loadFlows({
      targetMonth: month,
      targetKeyword: appliedKeyword,
      targetScope: searchScope,
      targetPage: flowPage,
      targetPageSize: flowPageSize
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped, activeView, month, appliedKeyword, searchScope, flowPage, flowPageSize])

  useEffect(() => {
    if (!bootstrapped || activeView !== 'imports') return
    loadBatches({
      targetMonth: month,
      targetPage: batchPage,
      targetPageSize: batchPageSize
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped, activeView, month, batchPage, batchPageSize])

  const stats = useMemo(
    () => [
      { label: '导入批次', value: summary?.batch_count ?? 0, hint: '当前账期文件', tone: 'blue' },
      { label: '流水行数', value: summary?.row_count ?? 0, hint: '数据库明细', tone: 'slate' },
      { label: '产品数量', value: summary?.game_count ?? 0, hint: '去重产品', tone: 'green' },
      { label: '渠道数量', value: summary?.channel_count ?? 0, hint: '去重渠道', tone: 'amber' }
    ],
    [summary]
  )

  const hasData = Number(summary?.row_count || 0) > 0
  const gameRankings = analytics.game_rankings || []
  const channelRankings = analytics.channel_rankings || []
  const hasSearch = Boolean(appliedKeyword)
  const activeError =
    activeView === 'flows'
      ? flowError || overviewError
      : activeView === 'imports'
        ? batchError || overviewError
        : overviewError
  const activeLoading =
    !bootstrapped ||
    overviewLoading ||
    (activeView === 'flows' && flowLoading) ||
    (activeView === 'imports' && batchLoading)

  const viewCounts = useMemo(
    () => getDatabaseViewCounts({ summary, flowTotal, batchTotal, hasSearch }),
    [summary, flowTotal, batchTotal, hasSearch]
  )

  const setSelectedMonth = (nextMonth) => {
    if (!nextMonth || nextMonth === month) return
    overviewRequestId.current += 1
    flowRequestId.current += 1
    batchRequestId.current += 1
    setFlowPage(0)
    setBatchPage(0)
    setFlows([])
    setBatches([])
    setFlowTotal(0)
    setBatchTotal(0)
    setMonth(nextMonth)
  }

  const applySearch = (event) => {
    event?.preventDefault()
    setFlowPage(0)
    setAppliedKeyword(keyword.trim())
    setActiveView('flows')
  }

  const clearSearch = () => {
    setKeyword('')
    setAppliedKeyword('')
    setSearchScope('all')
    setFlowPage(0)
  }

  const refreshCurrentView = async () => {
    const tasks = [loadOverview(month)]
    if (activeView === 'flows') {
      tasks.push(
        loadFlows({
          targetMonth: month,
          targetKeyword: appliedKeyword,
          targetScope: searchScope,
          targetPage: flowPage,
          targetPageSize: flowPageSize
        })
      )
    }
    if (activeView === 'imports') {
      tasks.push(
        loadBatches({
          targetMonth: month,
          targetPage: batchPage,
          targetPageSize: batchPageSize
        })
      )
    }
    await Promise.all(tasks)
  }

  const drillIntoRanking = (name, scope) => {
    const nextKeyword = String(name || '').trim()
    setKeyword(nextKeyword)
    setAppliedKeyword(nextKeyword)
    setSearchScope(scope)
    setFlowPage(0)
    setActiveView('flows')
  }

  const flowColumns = [
    { label: '序号', align: 'center' },
    { label: '日期' },
    { label: '产品' },
    { label: '渠道' },
    { label: '流水', align: 'right' }
  ]

  const flowRows = flows.map((row, index) => ({
    key: row.id || `${row.game_name}-${row.channel_name}-${index}`,
    cells: [
      flowPage * flowPageSize + index + 1,
      row.flow_date || row.settlement_month || '-',
      row.game_name || '-',
      row.channel_name || '-',
      money(row.gross_flow)
    ]
  }))

  const batchColumns = [
    { label: '序号', align: 'center' },
    { label: '文件' },
    { label: '账期' },
    { label: '行数', align: 'right' },
    { label: '产品', align: 'right' },
    { label: '渠道', align: 'right' },
    { label: '流水', align: 'right' },
    { label: '导入时间' }
  ]

  const batchRows = batches.map((batch, index) => ({
    key: batch.id || `${batch.source_file}-${index}`,
    cells: [
      batchPage * batchPageSize + index + 1,
      batch.source_file || '-',
      batch.settlement_month || '-',
      batch.row_count,
      batch.game_count,
      batch.channel_count,
      money(batch.total_flow),
      dateText(batch.imported_at)
    ]
  }))

  const healthClass = overviewError
    ? 'is-error'
    : !bootstrapped || (overviewLoading && !summary)
      ? 'is-loading'
      : 'is-ready'
  const healthLabel = overviewError
    ? '数据库读取异常'
    : !bootstrapped || (overviewLoading && !summary)
      ? '正在连接数据库'
      : '数据库已连接'

  return (
    <PageContainer hideHeader className="quicksdk-library-page">
      <section className="qk-page-head qk-database-head">
        <div className="qk-toolbar qk-database-toolbar" aria-label="数据库查询条件">
          <div className="qk-period-control">
            <button
              type="button"
              className="qk-icon-button"
              onClick={() => setSelectedMonth(shiftMonthValue(month, -1))}
              title="上一个月"
              aria-label="上一个月"
            >
              ‹
            </button>
            <label className="qk-period-field">
              <span>账期</span>
              <input type="month" value={month} onChange={(event) => setSelectedMonth(event.target.value)} />
            </label>
            <button
              type="button"
              className="qk-icon-button"
              onClick={() => setSelectedMonth(shiftMonthValue(month, 1))}
              title="下一个月"
              aria-label="下一个月"
            >
              ›
            </button>
            <button
              type="button"
              className="qk-secondary-button"
              disabled={!latestMonth || latestMonth === month}
              onClick={() => setSelectedMonth(latestMonth)}
            >
              最新月份
            </button>
          </div>

          <form className="qk-search-control" onSubmit={applySearch}>
            <select
              value={searchScope}
              onChange={(event) => {
                setSearchScope(event.target.value)
                setFlowPage(0)
              }}
              aria-label="搜索范围"
            >
              {SEARCH_SCOPES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="输入产品名或渠道名"
              aria-label="搜索数据库"
            />
            <button type="submit" className="qk-primary-button">查询</button>
            {keyword || appliedKeyword ? (
              <button type="button" className="qk-secondary-button" onClick={clearSearch}>清空</button>
            ) : null}
          </form>

          <button
            type="button"
            className="qk-refresh-button"
            onClick={refreshCurrentView}
            disabled={activeLoading}
          >
            {activeLoading ? '读取中' : '刷新数据'}
          </button>
        </div>
      </section>

      {activeError ? (
        <div className="qk-error" role="alert">
          <span>{activeError}</span>
          <button type="button" onClick={refreshCurrentView} disabled={activeLoading}>重新读取</button>
        </div>
      ) : null}

      <section className="qk-overview qk-database-overview">
        <div className="qk-overview-main">
          <span>{monthText(month)} 数据快照</span>
          <strong>{money(summary?.total_flow)}</strong>
          <p>
            {hasData
              ? `覆盖 ${summary?.game_count ?? 0} 个产品、${summary?.channel_count ?? 0} 个渠道，共 ${summary?.row_count ?? 0} 行流水。`
              : '当前月份还没有流水数据，可切换月份或前往数据源完成导入。'}
          </p>
        </div>
        <div className="qk-stats">
          {stats.map((item) => (
            <div key={item.label} className={`qk-stat-card qk-stat-card--${item.tone}`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.hint}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="qk-database-status" aria-label="数据库状态">
        <div className={`qk-health-state ${healthClass}`}>
          <i aria-hidden="true" />
          <strong>{healthLabel}</strong>
        </div>
        <span>当前账期：{hasData ? `${summary?.row_count ?? 0} 行数据` : '暂无数据'}</span>
        <span>最近导入：{latestSelectedBatch ? dateText(latestSelectedBatch.imported_at) : '-'}</span>
        <span>页面更新：{lastUpdatedAt ? dateText(lastUpdatedAt) : '-'}</span>
        {hasSearch ? (
          <span className="qk-active-query">
            当前查询：{SEARCH_SCOPES.find((item) => item.value === searchScope)?.label} “{appliedKeyword}”
          </span>
        ) : null}
      </section>

      <nav className="qk-view-tabs" aria-label="数据库视图">
        {VIEW_OPTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`qk-view-tab ${activeView === item.key ? 'is-active' : ''}`}
            onClick={() => setActiveView(item.key)}
            aria-current={activeView === item.key ? 'page' : undefined}
          >
            <span>{item.label}</span>
            <em>{viewCounts[item.key] || 0}</em>
          </button>
        ))}
      </nav>

      {activeView === 'overview' ? (
        <section className="qk-rank-grid">
          <RankTable
            title="产品流水排行"
            rows={gameRankings}
            emptyText="暂无产品排行数据"
            onSelect={(name) => drillIntoRanking(name, 'game')}
          />
          <RankTable
            title="渠道流水排行"
            rows={channelRankings}
            emptyText="暂无渠道排行数据"
            onSelect={(name) => drillIntoRanking(name, 'channel')}
          />
        </section>
      ) : null}

      {activeView === 'flows' ? (
        <DataTable
          title="流水明细"
          count={flowTotal}
          description={hasSearch ? '展示当前搜索条件下的数据库完整结果' : '按日期和流水金额展示当前账期原始数据'}
          emptyText="暂无符合条件的流水明细"
          columns={flowColumns}
          minWidth={760}
          rows={flowRows}
          loading={flowLoading}
          footer={(
            <Pager
              page={flowPage}
              total={flowTotal}
              pageSize={flowPageSize}
              pageSizes={DATABASE_PAGE_SIZES}
              disabled={flowLoading}
              onPageChange={setFlowPage}
              onPageSizeChange={(size) => {
                setFlowPage(0)
                setFlowPageSize(size)
              }}
            />
          )}
        />
      ) : null}

      {activeView === 'imports' ? (
        <DataTable
          title="导入记录"
          count={batchTotal}
          description="追踪每次导入文件、数据范围、流水金额和处理时间"
          emptyText="当前月份暂无导入记录"
          columns={batchColumns}
          minWidth={980}
          rows={batchRows}
          loading={batchLoading}
          footer={(
            <Pager
              page={batchPage}
              total={batchTotal}
              pageSize={batchPageSize}
              pageSizes={DATABASE_PAGE_SIZES}
              disabled={batchLoading}
              onPageChange={setBatchPage}
              onPageSizeChange={(size) => {
                setBatchPage(0)
                setBatchPageSize(size)
              }}
            />
          )}
        />
      ) : null}
    </PageContainer>
  )
}

function RankTable({ title, rows, emptyText, onSelect }) {
  const topFlow = Math.max(...rows.map((row) => Number(row.flow || 0)), 0)

  return (
    <section className="qk-panel qk-rank-panel">
      <div className="qk-panel-head">
        <div>
          <h2>{title}</h2>
          <p>点击排行项可直接查看对应流水明细</p>
        </div>
        <span>{rows.length} 个</span>
      </div>
      <div className="qk-rank-list">
        {rows.slice(0, 10).map((row, index) => {
          const percent = topFlow > 0 ? Math.max(6, (Number(row.flow || 0) / topFlow) * 100) : 0
          return (
            <button
              type="button"
              key={`${row.name}-${index}`}
              className="qk-rank-row"
              onClick={() => onSelect?.(row.name)}
              title={`查看 ${row.name} 的流水明细`}
            >
              <span>{index + 1}</span>
              <strong>{row.name}</strong>
              <div className="qk-rank-meter" aria-hidden="true">
                <i style={{ width: `${percent}%` }} />
              </div>
              <em>{money(row.flow)}</em>
              <small>{row.percentage ?? 0}%</small>
            </button>
          )
        })}
        {rows.length === 0 ? <EmptyState title={emptyText} desc="切换到已有导入流水的月份后，这里会显示排行。" /> : null}
      </div>
    </section>
  )
}

function DataTable({ title, count, description, emptyText, columns, rows, minWidth, loading = false, footer = null }) {
  return (
    <section className={`qk-panel qk-data-panel ${loading ? 'is-loading' : ''}`} aria-busy={loading}>
      <div className="qk-panel-head">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span>{loading ? '读取中…' : `${count} 条`}</span>
      </div>
      <div className="qk-table-wrap">
        <table className="qk-table" style={{ minWidth }}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.label} className={`is-${column.align || 'left'}`}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title="正在读取数据" desc="正在从服务器整理当前账期数据，请稍候。" compact />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title={emptyText} desc="可调整账期或搜索条件后重新查询。" compact />
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key}>
                  {row.cells.map((cell, cellIndex) => (
                    <td
                      key={`${row.key}-${cellIndex}`}
                      className={`is-${columns[cellIndex]?.align || 'left'}`}
                      title={typeof cell === 'string' ? cell : undefined}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer ? <div className="qk-table-footer">{footer}</div> : null}
    </section>
  )
}

function Pager({ page, total, pageSize, pageSizes, disabled = false, onPageChange, onPageSizeChange }) {
  const { totalPages, safePage, start, end } = getPagerRange(page, total, pageSize)

  return (
    <div className="qk-pager">
      <span>第 {start}—{end} 条，共 {total} 条</span>
      <div className="qk-pager-actions">
        <label>
          每页
          <select
            value={pageSize}
            disabled={disabled}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button type="button" disabled={disabled || safePage <= 0} onClick={() => onPageChange(safePage - 1)}>上一页</button>
        <strong>{safePage + 1} / {totalPages}</strong>
        <button
          type="button"
          disabled={disabled || safePage >= totalPages - 1}
          onClick={() => onPageChange(safePage + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  )
}

function EmptyState({ title, desc, compact = false }) {
  return (
    <div className={`qk-empty-state ${compact ? 'is-compact' : ''}`}>
      <strong>{title}</strong>
      <span>{desc}</span>
    </div>
  )
}

export default QuickSdkLibraryPage
