import React, { useEffect, useMemo, useState } from 'react'
import { getProjectProfitAnalysis } from '@/lib/api/profitAnalysis.ts'
import './ProjectProfitOverview.css'

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

function marginClass(value) {
  const n = Number(value || 0)
  if (n < -0.005) return 'is-negative'
  if (n > 0.005) return 'is-positive'
  return ''
}

export default function ProjectProfitOverview() {
  const [range, setRange] = useState(String(new Date().getFullYear()))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [expandedGame, setExpandedGame] = useState('')
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void (async () => {
      try {
        const response = await getProjectProfitAnalysis({
          year: range === 'lifetime' ? null : range
        })
        if (cancelled) return
        setData(response)
        if (
          range !== 'lifetime' &&
          response.available_years?.length &&
          !response.available_years.includes(range)
        ) {
          setRange(response.available_years[0])
        }
      } catch (loadError) {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : '项目毛利读取失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [range, revision])

  const rows = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    if (!query) return data?.projects || []
    return (data?.projects || []).filter((row) => String(row.game_name || '').toLowerCase().includes(query))
  }, [data?.projects, keyword])

  const summary = data?.summary || {}
  const scopeLabel = range === 'lifetime' ? '全部生命周期' : `${range}年`
  const positive = Number(summary.gross_profit || 0) >= 0

  return (
    <>
      <section className="project-profit-toolbar">
        <div>
          <span>PROJECT GROSS PROFIT</span>
          <strong>项目毛利分析</strong>
          <small>按游戏归并收入与可明确归属成本，可下钻查看每个月项目毛利。</small>
        </div>
        <div className="project-profit-toolbar__actions">
          <label>
            <span>统计范围</span>
            <select value={range} onChange={(event) => { setExpandedGame(''); setRange(event.target.value) }}>
              {(data?.available_years || []).map((year) => <option key={year} value={year}>{year}年</option>)}
              <option value="lifetime">全部生命周期</option>
            </select>
          </label>
          <button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </section>

      {error && !data ? (
        <section className="project-profit-error">
          <strong>项目毛利读取失败</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>重新读取</button>
        </section>
      ) : null}

      {data ? <>
        <section className={`project-profit-hero ${positive ? 'is-profit' : 'is-loss'}`}>
          <div className="project-profit-hero__main">
            <span>{scopeLabel} · 项目可归属毛利</span>
            <strong>{compactMoney(summary.gross_profit)}</strong>
            <p>综合毛利率 {Number(summary.gross_margin || 0).toFixed(1)}% · {summary.project_count || 0} 个项目 · {summary.data_months || 0} 个数据月份</p>
          </div>
          <div className="project-profit-bridge" aria-label="项目毛利计算公式">
            <div><span>渠道结算</span><strong>{compactMoney(summary.channel_settlement)}</strong></div>
            <i>−</i>
            <div><span>可归属成本</span><strong>{compactMoney(summary.total_attributable_cost)}</strong></div>
            <i>=</i>
            <div className="is-result"><span>项目毛利</span><strong>{compactMoney(summary.gross_profit)}</strong></div>
          </div>
        </section>

        <section className="project-profit-metrics">
          <article><span>项目数量</span><strong>{summary.project_count || 0}</strong><small>有收入或成本记录的项目</small></article>
          <article><span>渠道结算</span><strong>{compactMoney(summary.channel_settlement)}</strong><small>项目可归属收入合计</small></article>
          <article><span>可归属成本</span><strong>{compactMoney(summary.total_attributable_cost)}</strong><small>研发 + 服务器 + 归属费用</small></article>
          <article className={positive ? 'is-positive' : 'is-negative'}><span>项目毛利</span><strong>{compactMoney(summary.gross_profit)}</strong><small>盈利 {summary.profitable_projects || 0} · 亏损 {summary.loss_projects || 0}</small></article>
          <article><span>综合毛利率</span><strong>{Number(summary.gross_margin || 0).toFixed(1)}%</strong><small>项目毛利 ÷ 渠道结算</small></article>
        </section>

        <section className="profit-card project-profit-table-card">
          <div className="profit-card-head project-profit-card-head">
            <div>
              <span>PROJECT RANKING</span>
              <h2>{scopeLabel} 项目毛利排行</h2>
              <p>点击游戏可展开月度明细。公共费用不会强行摊入单个项目。</p>
            </div>
            <label className="project-profit-search">
              <span>搜索游戏</span>
              <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="输入游戏名称" />
            </label>
          </div>

          <div className="project-profit-shared-strip">
            <div><span>未分摊公共服务器</span><strong>{money(summary.shared_server_cost)}</strong></div>
            <div><span>未分摊公共经营费用</span><strong>{money(summary.shared_expense)}</strong></div>
            <p>以上属于公司层成本，仅影响公司经营利润，不人为改变项目毛利。</p>
          </div>

          <div className="profit-table-wrap project-profit-table-wrap">
            <table className="project-profit-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>游戏</th>
                  <th>渠道结算</th>
                  <th>研发成本</th>
                  <th>服务器</th>
                  <th>归属费用</th>
                  <th>可归属成本</th>
                  <th>项目毛利</th>
                  <th>毛利率</th>
                  <th>月份</th>
                  <th>明细</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={11} className="profit-empty-cell">当前范围暂无可分析项目。</td></tr> : null}
                {rows.map((row, index) => {
                  const expanded = expandedGame === row.game_name
                  return (
                    <React.Fragment key={row.game_name}>
                      <tr className={`project-profit-row ${expanded ? 'is-expanded' : ''}`} onClick={() => setExpandedGame(expanded ? '' : row.game_name)}>
                        <td>{index + 1}</td>
                        <td><strong>{row.game_name}</strong><small>{row.first_month && row.last_month ? `${monthLabel(row.first_month)} — ${monthLabel(row.last_month)}` : ''}</small></td>
                        <td>{money(row.channel_settlement)}</td>
                        <td>{money(row.rd_cost)}</td>
                        <td>{money(row.server_cost)}</td>
                        <td>{money(row.attributed_expense)}</td>
                        <td>{money(row.total_attributable_cost)}</td>
                        <td className={marginClass(row.gross_profit)}><strong>{money(row.gross_profit)}</strong></td>
                        <td className={marginClass(row.gross_profit)}><strong>{Number(row.gross_margin || 0).toFixed(1)}%</strong></td>
                        <td>{row.active_months || 0}</td>
                        <td><button type="button" className="project-profit-expand" aria-label={`${expanded ? '收起' : '展开'}${row.game_name}明细`}>{expanded ? '收起' : '展开'}</button></td>
                      </tr>
                      {expanded ? (
                        <tr className="project-profit-detail-row">
                          <td colSpan={11}>
                            <div className="project-profit-detail">
                              <header>
                                <div><strong>{row.game_name}</strong><span>月度项目毛利明细</span></div>
                                <div><span>累计渠道结算 {money(row.channel_settlement)}</span><span>累计毛利 {money(row.gross_profit)}</span></div>
                              </header>
                              <div className="project-profit-detail-table">
                                <table>
                                  <thead><tr><th>月份</th><th>渠道结算</th><th>研发成本</th><th>服务器</th><th>归属费用</th><th>可归属成本</th><th>项目毛利</th><th>毛利率</th></tr></thead>
                                  <tbody>{(row.monthly || []).map((month) => <tr key={month.month}><td>{monthLabel(month.month)}</td><td>{money(month.channel_settlement)}</td><td>{money(month.rd_cost)}</td><td>{money(month.server_cost)}</td><td>{money(month.attributed_expense)}</td><td>{money(month.total_attributable_cost)}</td><td className={marginClass(month.gross_profit)}><strong>{money(month.gross_profit)}</strong></td><td className={marginClass(month.gross_profit)}>{Number(month.gross_margin || 0).toFixed(1)}%</td></tr>)}</tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="project-profit-methodology">
          <strong>项目毛利口径</strong>
          <div>{(data.notes || []).map((note, index) => <p key={`${index}-${note}`}>{index + 1}. {note}</p>)}</div>
        </section>
      </> : null}
    </>
  )
}
