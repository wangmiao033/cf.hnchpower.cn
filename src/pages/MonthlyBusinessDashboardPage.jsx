import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { VIEWS } from '@/app/routes.js'
import { getMonthlyBusinessDashboard } from '@/lib/api/businessDashboard.ts'
import './MonthlyBusinessDashboardPage.css'

function money(value) {
  const number = Number(value || 0)
  return `¥${number.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function compactMoney(value) {
  const number = Number(value || 0)
  const abs = Math.abs(number)
  if (abs >= 100000000) return `${number < 0 ? '-' : ''}¥${(abs / 100000000).toFixed(2)}亿`
  if (abs >= 10000) return `${number < 0 ? '-' : ''}¥${(abs / 10000).toFixed(abs >= 100000 ? 1 : 2)}万`
  return money(number)
}

function monthLabel(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : value || '-'
}

function changeText(metric, suffix = '') {
  if (!metric) return '-'
  if (metric.change_percent == null) {
    if (Math.abs(Number(metric.change_amount || 0)) <= 0.005) return '与上月持平'
    return `较上月 ${metric.change_amount >= 0 ? '+' : ''}${money(metric.change_amount)}${suffix}`
  }
  const value = Number(metric.change_percent || 0)
  if (Math.abs(value) < 0.005) return '与上月持平'
  return `较上月 ${value > 0 ? '+' : ''}${value.toFixed(1)}%${suffix}`
}

function completionText(done, total) {
  if (!total) return '暂无账单'
  return `${done} / ${total}`
}

function completionPercent(done, total) {
  return total > 0 ? Math.min(100, (done / total) * 100) : 0
}

function MetricCard({
  eyebrow,
  title,
  metric,
  note,
  tone = '',
  onClick,
  valueFormatter = compactMoney,
  changeTone = 'neutral'
}) {
  const change = Number(metric?.change_amount || 0)
  const effectiveChangeTone = changeTone === 'inverse'
    ? change > 0 ? 'down' : change < 0 ? 'up' : 'flat'
    : changeTone === 'positive'
      ? change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
      : 'flat'
  const Tag = onClick ? 'button' : 'article'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`business-metric-card ${tone ? `is-${tone}` : ''} ${onClick ? 'is-clickable' : ''}`}
      onClick={onClick}
    >
      <span className="business-metric-eyebrow">{eyebrow}</span>
      <div className="business-metric-title">{title}</div>
      <strong>{valueFormatter(metric?.value || 0)}</strong>
      <div className={`business-metric-change is-${effectiveChangeTone}`}>{changeText(metric)}</div>
      {note ? <small>{note}</small> : null}
    </Tag>
  )
}

function TrendBars({ rows }) {
  const max = useMemo(() => {
    const values = (rows || []).flatMap((row) => [
      Math.abs(Number(row.channel_settlement || 0)),
      Math.abs(Number(row.rd_settlement || 0)),
      Math.abs(Number(row.contribution || 0))
    ])
    return Math.max(1, ...values)
  }, [rows])

  return (
    <div className="business-trend-chart" role="img" aria-label="月度渠道结算、研发结算与结算贡献趋势">
      <div className="business-trend-axis"><span>{compactMoney(max)}</span><span>{compactMoney(max / 2)}</span><span>0</span></div>
      <div className="business-trend-columns">
        {(rows || []).map((row) => {
          const channelHeight = Math.max(2, Math.abs(Number(row.channel_settlement || 0)) / max * 100)
          const rdHeight = Math.max(2, Math.abs(Number(row.rd_settlement || 0)) / max * 100)
          const contributionHeight = Math.max(2, Math.abs(Number(row.contribution || 0)) / max * 100)
          return (
            <div className="business-trend-column" key={row.month} title={`${monthLabel(row.month)} · 渠道 ${money(row.channel_settlement)} · 研发 ${money(row.rd_settlement)} · 贡献 ${money(row.contribution)}`}>
              <div className="business-trend-bars">
                <i className="is-channel" style={{ height: `${channelHeight}%` }} />
                <i className="is-rd" style={{ height: `${rdHeight}%` }} />
                <i className={Number(row.contribution || 0) >= 0 ? 'is-contribution' : 'is-contribution is-negative'} style={{ height: `${contributionHeight}%` }} />
              </div>
              <span>{String(row.month || '').slice(5)}月</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MonthlyBusinessDashboardPage() {
  const { setActiveView, showToast } = useAppState()
  const [selectedMonth, setSelectedMonth] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getMonthlyBusinessDashboard({
      month: selectedMonth || undefined,
      trendMonths: 12
    })
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((loadError) => {
        if (!cancelled) {
          const message = loadError instanceof Error ? loadError.message : '经营数据读取失败'
          setError(message)
          showToast?.('经营驾驶舱读取失败，请稍后重试', 'error')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [revision, selectedMonth, showToast])

  const displayMonth = selectedMonth || data?.month || ''
  const contributionPositive = Number(data?.contribution?.value || 0) >= 0
  const cashPositive = Number(data?.cash_net?.value || 0) >= 0
  const channelCompletion = completionPercent(data?.channel_completed_count || 0, data?.channel_bill_count || 0)
  const rdCompletion = completionPercent(data?.rd_completed_count || 0, data?.rd_bill_count || 0)
  const topGames = (data?.games || []).slice(0, 12)

  return (
    <PageContainer hideHeader className="business-dashboard-page">
      <section className="business-dashboard-head">
        <div>
          <span className="business-dashboard-kicker">Management Cockpit · V2.2</span>
          <h1>月度经营驾驶舱</h1>
          <p>把渠道应收、研发应付、现金收支与产品结算贡献放到同一张经营视图中。</p>
        </div>
        <div className="business-dashboard-head-actions">
          <label>
            <span>经营月份</span>
            <select
              value={displayMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              disabled={loading && !data}
            >
              {!displayMonth ? <option value="">自动选择最新月份</option> : null}
              {(data?.available_months || []).map((month) => (
                <option key={month} value={month}>{monthLabel(month)}</option>
              ))}
              {displayMonth && !(data?.available_months || []).includes(displayMonth) ? (
                <option value={displayMonth}>{monthLabel(displayMonth)}</option>
              ) : null}
            </select>
          </label>
          <button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading}>
            {loading ? '刷新中…' : '刷新数据'}
          </button>
        </div>
      </section>

      {error && !data ? (
        <section className="business-dashboard-error">
          <strong>经营数据读取失败</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>重新读取</button>
        </section>
      ) : null}

      {!error || data ? (
        <>
          <section className={`business-dashboard-hero ${contributionPositive ? 'is-positive' : 'is-negative'}`}>
            <div className="business-dashboard-hero-main">
              <span>经营结算贡献 · {monthLabel(data?.month || displayMonth)}</span>
              <strong>{loading && !data ? '读取中…' : compactMoney(data?.contribution?.value)}</strong>
              <p>
                渠道结算 {compactMoney(data?.channel_settlement?.value)} − 研发结算 {compactMoney(data?.rd_settlement?.value)} − 服务器成本 {compactMoney(data?.server_cost?.value)}
              </p>
              <div className="business-dashboard-hero-delta">
                <span>{changeText(data?.contribution)}</span>
                <em>贡献率 {Number(data?.contribution_margin?.value || 0).toFixed(1)}%</em>
              </div>
            </div>
            <div className="business-dashboard-hero-side">
              <div>
                <span>现金净流入</span>
                <strong className={cashPositive ? 'is-positive-text' : 'is-negative-text'}>{compactMoney(data?.cash_net?.value)}</strong>
                <small>{changeText(data?.cash_net)}</small>
              </div>
              <div>
                <span>渠道当前未收</span>
                <strong>{compactMoney(data?.channel_outstanding?.value)}</strong>
                <small>按所选账期账单当前余额</small>
              </div>
            </div>
          </section>

          <section className="business-dashboard-metrics">
            <MetricCard
              eyebrow="ACCRUAL · 应收"
              title="渠道结算"
              metric={data?.channel_settlement}
              note={`${data?.channel_bill_count || 0} 笔渠道账单`}
              tone="channel"
              onClick={() => setActiveView(VIEWS.RECON_CHANNEL)}
            />
            <MetricCard
              eyebrow="ACCRUAL · 应付"
              title="研发结算"
              metric={data?.rd_settlement}
              note={`${data?.rd_bill_count || 0} 笔研发账单`}
              tone="rd"
              changeTone="inverse"
              onClick={() => setActiveView(VIEWS.RECON_RD)}
            />
            <MetricCard
              eyebrow="CASH · 实收"
              title="渠道实际收款"
              metric={data?.channel_receipts}
              note="按真实收款日期"
              tone="cash-in"
              changeTone="positive"
              onClick={() => setActiveView(VIEWS.RECON_CHANNEL)}
            />
            <MetricCard
              eyebrow="CASH · 实付"
              title="研发实际付款"
              metric={data?.rd_payments}
              note="按银行付款登记日期"
              tone="cash-out"
              changeTone="inverse"
              onClick={() => setActiveView(VIEWS.RECON_RD)}
            />
          </section>

          <section className="business-dashboard-grid">
            <article className="business-dashboard-card business-dashboard-card--trend">
              <div className="business-dashboard-card-head">
                <div><span>12 MONTH TREND</span><h2>结算趋势</h2><p>渠道结算 / 研发结算 / 结算贡献</p></div>
                <div className="business-trend-legend"><span className="is-channel">渠道</span><span className="is-rd">研发</span><span className="is-contribution">贡献</span></div>
              </div>
              <TrendBars rows={data?.trend || []} />
              <div className="business-trend-table-wrap">
                <table className="business-trend-table">
                  <thead><tr><th>月份</th><th>渠道结算</th><th>研发结算</th><th>服务器</th><th>贡献</th><th>现金净流入</th></tr></thead>
                  <tbody>
                    {(data?.trend || []).slice().reverse().map((row) => (
                      <tr key={row.month} className={row.month === data?.month ? 'is-current' : ''}>
                        <td>{monthLabel(row.month)}</td>
                        <td>{money(row.channel_settlement)}</td>
                        <td>{money(row.rd_settlement)}</td>
                        <td>{money(row.server_cost)}</td>
                        <td className={Number(row.contribution) < 0 ? 'is-negative-text' : ''}>{money(row.contribution)}</td>
                        <td className={Number(row.cash_net) < 0 ? 'is-negative-text' : ''}>{money(row.cash_net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="business-dashboard-card business-dashboard-card--cash">
              <div className="business-dashboard-card-head">
                <div><span>CASH POSITION</span><h2>现金流</h2><p>真实收付款日期口径</p></div>
              </div>
              <div className="business-cash-flow">
                <div className="is-in">
                  <span>渠道已收</span>
                  <strong>{compactMoney(data?.channel_receipts?.value)}</strong>
                  <small>{changeText(data?.channel_receipts)}</small>
                </div>
                <i>−</i>
                <div className="is-out">
                  <span>研发已付</span>
                  <strong>{compactMoney(data?.rd_payments?.value)}</strong>
                  <small>{changeText(data?.rd_payments)}</small>
                </div>
                <i>=</i>
                <div className={cashPositive ? 'is-net-positive' : 'is-net-negative'}>
                  <span>现金净流入</span>
                  <strong>{compactMoney(data?.cash_net?.value)}</strong>
                  <small>{changeText(data?.cash_net)}</small>
                </div>
              </div>
              <div className="business-cash-note">
                <span>渠道当前未收</span>
                <strong>{money(data?.channel_outstanding?.value)}</strong>
                <small>这是所选账期截至当前的未收余额，不是历史月末快照。</small>
              </div>
            </article>

            <article className="business-dashboard-card business-dashboard-card--progress">
              <div className="business-dashboard-card-head">
                <div><span>SETTLEMENT PROGRESS</span><h2>账单完成度</h2><p>已完成 / 已结算 / 已核销计入完成</p></div>
              </div>
              <div className="business-progress-list">
                <button type="button" onClick={() => setActiveView(VIEWS.RECON_CHANNEL)}>
                  <div><span>渠道账单</span><strong>{completionText(data?.channel_completed_count || 0, data?.channel_bill_count || 0)}</strong></div>
                  <div className="business-progress-track"><i style={{ width: `${channelCompletion}%` }} /></div>
                  <small>{channelCompletion.toFixed(1)}%</small>
                </button>
                <button type="button" onClick={() => setActiveView(VIEWS.RECON_RD)}>
                  <div><span>研发账单</span><strong>{completionText(data?.rd_completed_count || 0, data?.rd_bill_count || 0)}</strong></div>
                  <div className="business-progress-track"><i style={{ width: `${rdCompletion}%` }} /></div>
                  <small>{rdCompletion.toFixed(1)}%</small>
                </button>
              </div>
            </article>
          </section>

          <section className="business-dashboard-card business-dashboard-games">
            <div className="business-dashboard-card-head">
              <div><span>PRODUCT CONTRIBUTION</span><h2>游戏结算贡献排行</h2><p>渠道结算 − 研发结算；未分摊服务器及系统外费用</p></div>
              <span>{topGames.length} 个产品</span>
            </div>
            <div className="business-games-table-wrap">
              <table>
                <thead><tr><th>#</th><th>产品</th><th className="is-right">渠道结算</th><th className="is-right">研发结算</th><th className="is-right">结算贡献</th><th className="is-right">渠道流水</th><th className="is-right">研发流水</th></tr></thead>
                <tbody>
                  {topGames.length === 0 ? <tr><td colSpan={7} className="business-empty">当前月份暂无可汇总产品。</td></tr> : topGames.map((game, index) => (
                    <tr key={game.game_name}>
                      <td><span className={`business-rank ${index < 3 ? `is-top-${index + 1}` : ''}`}>{index + 1}</span></td>
                      <td><strong>{game.game_name}</strong></td>
                      <td className="is-right">{money(game.channel_settlement)}</td>
                      <td className="is-right">{money(game.rd_settlement)}</td>
                      <td className={`is-right is-contribution ${Number(game.contribution_before_server) < 0 ? 'is-negative-text' : ''}`}>{money(game.contribution_before_server)}</td>
                      <td className="is-right">{money(game.channel_flow)}</td>
                      <td className="is-right">{money(game.rd_flow)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="business-dashboard-disclaimer">
            <div><strong>口径说明</strong><span>经营驾驶舱用于结算经营判断，不替代会计报表。</span></div>
            <ul>
              {(data?.notes || []).map((note) => <li key={note}>{note}</li>)}
              <li>系统未录入的广告、人力、税务、办公及其他费用不包含在“结算贡献”中。</li>
            </ul>
          </section>
        </>
      ) : null}
    </PageContainer>
  )
}

export default MonthlyBusinessDashboardPage
