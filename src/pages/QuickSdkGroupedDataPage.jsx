import React, { useEffect, useMemo, useState } from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { getQuickSdkAnalytics, getQuickSdkSummary } from '@/lib/api/quicksdk.ts'
import './QuickSdkGroupedDataPage.css'

const DEFAULT_MONTH = new Date().toISOString().slice(0, 7)

function money(value) {
  const amount = Number(value || 0)
  return `¥ ${amount.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function monthText(value) {
  if (!value) return '全部月份'
  const [year, month] = value.split('-')
  return `${year}年${month}月`
}

function QuickSdkGroupedDataPage({ dimension }) {
  const isGame = dimension === 'game'
  const title = isGame ? '游戏数据' : '渠道数据'
  const counterpart = isGame ? '渠道' : '游戏'
  const [month, setMonth] = useState(DEFAULT_MONTH)
  const [keyword, setKeyword] = useState('')
  const [summary, setSummary] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const params = { settlement_month: month }
      const [summaryResult, analyticsResult] = await Promise.all([
        getQuickSdkSummary(params),
        getQuickSdkAnalytics({ ...params, limit: 500 })
      ])
      setSummary(summaryResult)
      setRows(
        (isGame ? analyticsResult.game_rankings : analyticsResult.channel_rankings) || []
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : `${title}读取失败`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, dimension])

  useEffect(() => {
    let cancelled = false
    getQuickSdkAnalytics({})
      .then((overview) => {
        const latestMonth = overview?.monthly?.[0]?.settlement_month
        if (!cancelled && latestMonth) setMonth(latestMonth)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const visibleRows = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    if (!query) return rows
    return rows.filter((row) => String(row.name || '').toLowerCase().includes(query))
  }, [keyword, rows])

  const categoryCount = isGame ? summary?.game_count : summary?.channel_count
  const counterpartCount = isGame ? summary?.channel_count : summary?.game_count

  return (
    <PageContainer hideHeader className="qk-grouped-page">
      <section className="qkg-header">
        <div>
          <p className="qkg-eyebrow">数据中心 / {title}</p>
          <h1>{title}</h1>
          <p>
            数据来源于数据库，按月份和{isGame ? '游戏名称' : '渠道名称'}分类汇总。
          </p>
        </div>
        <div className="qkg-controls" aria-label={`${title}查询条件`}>
          <label>
            <span>月份</span>
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <label>
            <span>搜索{isGame ? '游戏' : '渠道'}</span>
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={`输入${isGame ? '游戏' : '渠道'}名称`}
            />
          </label>
          <button type="button" onClick={load} disabled={loading}>
            {loading ? '读取中' : '刷新'}
          </button>
        </div>
      </section>

      {error ? <div className="qkg-error">{error}</div> : null}

      <section className="qkg-summary" aria-label={`${title}概览`}>
        <div className="qkg-summary-main">
          <span>{monthText(month)}流水合计</span>
          <strong>{money(summary?.total_flow)}</strong>
          <small>来源：数据库已导入流水</small>
        </div>
        <div>
          <span>{isGame ? '游戏分类' : '渠道分类'}</span>
          <strong>{categoryCount ?? 0}</strong>
          <small>当前月份完整分类</small>
        </div>
        <div>
          <span>流水行数</span>
          <strong>{Number(summary?.row_count || 0).toLocaleString('zh-CN')}</strong>
          <small>参与本月汇总的明细</small>
        </div>
        <div>
          <span>覆盖{counterpart}</span>
          <strong>{counterpartCount ?? 0}</strong>
          <small>{isGame ? '产生流水的渠道范围' : '产生流水的游戏范围'}</small>
        </div>
      </section>

      <section className="qkg-table-panel">
        <header>
          <div>
            <h2>{monthText(month)}{title}分类</h2>
            <p>按流水金额从高到低排列，可搜索名称快速定位。</p>
          </div>
          <span>{visibleRows.length} 条分类</span>
        </header>

        <div className="qkg-table-wrap">
          <table>
            <thead>
              <tr>
                <th>排名</th>
                <th>{isGame ? '游戏名称' : '渠道名称'}</th>
                <th>流水金额</th>
                <th>流水占比</th>
                <th>明细行数</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr key={`${row.name}-${index}`}>
                  <td><span className="qkg-rank">{index + 1}</span></td>
                  <td><strong>{row.name || '未填写'}</strong></td>
                  <td className="qkg-money">{money(row.flow)}</td>
                  <td>
                    <div className="qkg-share">
                      <span><i style={{ width: `${Math.min(Number(row.percentage || 0), 100)}%` }} /></span>
                      <em>{Number(row.percentage || 0).toFixed(1)}%</em>
                    </div>
                  </td>
                  <td>{Number(row.row_count || 0).toLocaleString('zh-CN')}</td>
                </tr>
              ))}
              {!loading && visibleRows.length === 0 ? (
                <tr>
                  <td colSpan="5" className="qkg-empty">
                    {keyword ? '没有匹配的分类数据' : '当前月份暂无分类数据'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </PageContainer>
  )
}

export default QuickSdkGroupedDataPage
