import React, { useEffect, useMemo, useState } from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'
import {
  getQuickSdkAnalytics,
  getQuickSdkSummary,
  listQuickSdkBatches,
  listQuickSdkFlows
} from '@/lib/api/quicksdk.ts'
import './QuickSdkLibraryPage.css'

const DEFAULT_MONTH = new Date().toISOString().slice(0, 7)

function money(value) {
  const n = Number(value || 0)
  return `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dateText(value) {
  if (!value) return '-'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('zh-CN', { hour12: false })
}

function QuickSdkLibraryPage() {
  const [month, setMonth] = useState(DEFAULT_MONTH)
  const [keyword, setKeyword] = useState('')
  const [summary, setSummary] = useState(null)
  const [batches, setBatches] = useState([])
  const [flows, setFlows] = useState([])
  const [analytics, setAnalytics] = useState({ game_rankings: [], channel_rankings: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const params = { settlement_month: month }
      const [summaryRes, batchRes, flowRes, analyticsRes] = await Promise.all([
        getQuickSdkSummary(params),
        listQuickSdkBatches({ ...params, limit: 20 }),
        listQuickSdkFlows({ ...params, q: keyword, limit: 200 }),
        getQuickSdkAnalytics(params)
      ])
      setSummary(summaryRes)
      setBatches(batchRes.items || [])
      setFlows(flowRes.items || [])
      setAnalytics(analyticsRes || { game_rankings: [], channel_rankings: [] })
    } catch (err) {
      setError(err instanceof Error ? err.message : '数据库流水读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  useEffect(() => {
    let cancelled = false

    getQuickSdkAnalytics({})
      .then((overview) => {
        const latestMonth = overview?.monthly?.[0]?.settlement_month
        if (!cancelled && latestMonth && latestMonth !== month) {
          setMonth(latestMonth)
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
    // Only detect the latest imported month when entering the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stats = useMemo(
    () => [
      { label: '导入批次', value: summary?.batch_count ?? 0, hint: '本月文件批次', tone: 'blue' },
      { label: '流水行数', value: summary?.row_count ?? 0, hint: '已解析明细', tone: 'slate' },
      {
        label: '产品 / 渠道',
        value: `${summary?.game_count ?? 0} / ${summary?.channel_count ?? 0}`,
        hint: '覆盖范围',
        tone: 'green'
      },
      { label: '流水合计', value: money(summary?.total_flow), hint: '本月总流水', tone: 'amber' }
    ],
    [summary]
  )

  const hasData = Number(summary?.row_count || 0) > 0 || batches.length > 0 || flows.length > 0
  const gameRankings = analytics.game_rankings || []
  const channelRankings = analytics.channel_rankings || []
  const visibleFlows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return flows
    return flows.filter((row) => {
      const game = String(row.game_name || '').toLowerCase()
      const channel = String(row.channel_name || '').toLowerCase()
      return game.includes(q) || channel.includes(q)
    })
  }, [flows, keyword])

  return (
    <PageContainer hideHeader className="quicksdk-library-page">
      <section className="qk-page-head">
        <div className="qk-page-title">
          <p className="qk-page-eyebrow">数据中心</p>
          <h1>数据库</h1>
          <p>按月份查看已导入批次、游戏流水、渠道流水和原始明细，用于研发和渠道对账核验。</p>
        </div>
        <div className="qk-toolbar" aria-label="数据库查询条件">
          <label>
            <span>月份</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <label>
            <span>搜索</span>
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') load()
              }}
              placeholder="产品或渠道"
            />
          </label>
          <button type="button" onClick={load} disabled={loading}>
            {loading ? '读取中' : '刷新'}
          </button>
        </div>
      </section>

      {error ? <div className="qk-error">{error}</div> : null}

      <section className="qk-overview">
        <div className="qk-overview-main">
          <span>{month} 数据快照</span>
          <strong>{money(summary?.total_flow)}</strong>
          <p>
            {hasData
              ? `已读取 ${summary?.row_count ?? 0} 行流水，覆盖 ${summary?.game_count ?? 0} 个产品、${summary?.channel_count ?? 0} 个渠道。`
              : '当前月份还没有读取到流水数据，可切换月份或确认是否已完成导入。'}
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

      <section className="qk-rank-grid">
        <RankTable title="游戏流水排行" rows={gameRankings} emptyText="暂无游戏排行数据" />
        <RankTable title="渠道流水排行" rows={channelRankings} emptyText="暂无渠道排行数据" />
      </section>

      <section className="qk-table-grid">
        <DataTable
          title="导入批次"
          count={batches.length}
          emptyText="当前月份暂无导入批次"
          columns={['文件', '月份', '行数', '产品', '渠道', '流水', '导入时间']}
          minWidth={820}
          rows={batches.map((batch) => [
            batch.source_file || '-',
            batch.settlement_month || '-',
            batch.row_count,
            batch.game_count,
            batch.channel_count,
            money(batch.total_flow),
            dateText(batch.imported_at)
          ])}
        />
        <DataTable
          title="流水明细"
          count={visibleFlows.length}
          emptyText="暂无流水明细"
          columns={['日期', '产品', '渠道', '流水']}
          minWidth={680}
          rows={visibleFlows.map((row, index) => [
            row.flow_date || row.settlement_month || '-',
            row.game_name || '-',
            row.channel_name || '-',
            money(row.gross_flow),
            row.id || `${row.game_name}-${row.channel_name}-${index}`
          ])}
        />
      </section>
    </PageContainer>
  )
}

function RankTable({ title, rows, emptyText }) {
  const topFlow = Math.max(...rows.map((row) => Number(row.flow || 0)), 0)

  return (
    <section className="qk-panel qk-rank-panel">
      <div className="qk-panel-head">
        <div>
          <h2>{title}</h2>
          <p>按流水金额排序，默认显示前 10 名</p>
        </div>
        <span>{rows.length} 个</span>
      </div>
      <div className="qk-rank-list">
        {rows.slice(0, 10).map((row, index) => {
          const percent = topFlow > 0 ? Math.max(6, (Number(row.flow || 0) / topFlow) * 100) : 0
          return (
            <div key={`${row.name}-${index}`} className="qk-rank-row">
              <span>{index + 1}</span>
              <strong>{row.name}</strong>
              <div className="qk-rank-meter" aria-hidden="true">
                <i style={{ width: `${percent}%` }} />
              </div>
              <em>{money(row.flow)}</em>
              <small>{row.percentage ?? 0}%</small>
            </div>
          )
        })}
        {rows.length === 0 ? <EmptyState title={emptyText} desc="切换到已有导入流水的月份后，这里会显示排行。" /> : null}
      </div>
    </section>
  )
}

function DataTable({ title, count, emptyText, columns, rows, minWidth }) {
  return (
    <section className="qk-panel">
      <div className="qk-panel-head">
        <div>
          <h2>{title}</h2>
          <p>{title === '导入批次' ? '用于追踪每次导入文件和汇总结果' : '展示当前查询条件下的原始流水'}</p>
        </div>
        <span>{count} 条</span>
      </div>
      <div className="qk-table-wrap">
        <table className="qk-table" style={{ minWidth }}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title={emptyText} desc="如果刚导入过数据，请点击右上角刷新。" compact />
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={row[row.length - 1] || `${title}-${index}`}>
                  {row.slice(0, columns.length).map((cell, cellIndex) => (
                    <td key={`${title}-${index}-${cellIndex}`}>{cell}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
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
