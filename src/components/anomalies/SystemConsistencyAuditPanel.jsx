import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { getSystemConsistencyAudit } from '@/lib/api/anomaly.ts'
import './SystemConsistencyAuditPanel.css'
import './SystemConsistencyAuditPanelV49.css'

const CATEGORY_LABELS = {
  lifecycle: '状态一致性',
  invoice: '发票一致性',
  funding: '资金一致性',
  archive: '归档一致性',
  reference: '关联完整性'
}

const CATEGORY_ACTIONS = {
  lifecycle: '先确认账单是否应恢复；若继续作废，应撤销残留的发票或资金关联。',
  invoice: '进入账单 360° 核对发票覆盖，再到发票中心解除错误分配或重新关联。',
  funding: '进入账单 360° 核对资金事实，再到银行中心处理错误核销或超额分配。',
  archive: '先确认发票与资金是否完整闭环；未闭环的账单应取消归档后继续处理。',
  reference: '优先核对孤儿关联来源；不要直接补造账单、发票或流水来消除异常。'
}

function money(value) {
  if (value == null || value === '') return null
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function severityLabel(value) {
  if (value === 'critical') return '阻断'
  if (value === 'warning') return '待核对'
  return '提醒'
}

function actionLabel(issue) {
  if (issue?.category === 'invoice') return '去发票处理'
  if (issue?.category === 'funding') return '去银行处理'
  if (issue?.category === 'archive') return '去账单处理'
  if (issue?.category === 'reference') return '去关联源处理'
  return '去对应模块'
}

export default function SystemConsistencyAuditPanel() {
  const { openBill360, setActiveView } = useAppState()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [revision, setRevision] = useState(0)
  const [severity, setSeverity] = useState('all')
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getSystemConsistencyAudit(500)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '一致性巡检失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [revision])

  const issues = data?.items || []
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return issues.filter((issue) => {
      if (severity !== 'all' && issue.severity !== severity) return false
      if (category !== 'all' && issue.category !== category) return false
      if (!keyword) return true
      return [issue.title, issue.detail, issue.bill_number, issue.partner_name, issue.settlement_month]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [category, issues, query, severity])
  const visible = useMemo(() => expanded ? filtered : filtered.slice(0, 8), [expanded, filtered])
  const summary = data?.summary || {}
  const categoryCounts = summary.category_counts || {}

  useEffect(() => {
    setExpanded(false)
  }, [severity, category, query])

  const openIssueBill = (issue) => {
    if (!issue?.bill_id || !issue?.bill_type) return
    openBill360?.(issue.bill_type === 'channel' ? 'channel' : 'rd', issue.bill_id)
  }

  const openIssueTarget = (issue) => {
    if (issue?.target_view) setActiveView?.(issue.target_view)
  }

  const resetFilters = () => {
    setSeverity('all')
    setCategory('all')
    setQuery('')
  }

  return (
    <section className={`system-consistency-panel ${summary.healthy ? 'is-healthy' : ''}`} aria-label="系统数据一致性巡检">
      <header className="system-consistency-head">
        <div>
          <div className="system-consistency-badges"><span>DATA CONSISTENCY</span><em>只读巡检</em></div>
          <h2>系统数据一致性巡检</h2>
          <p>核对账单、发票、银行核销和归档是否互相矛盾。这里只发现问题，不自动修改任何账单或资金事实。</p>
        </div>
        <button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading}>
          {loading ? '巡检中…' : '重新巡检'}
        </button>
      </header>

      {error && !data ? (
        <div className="system-consistency-error"><strong>一致性巡检暂时不可用</strong><span>{error}</span></div>
      ) : null}

      {data ? (
        <>
          <div className="system-consistency-metrics">
            <article><span>扫描账单</span><strong>{summary.bills_scanned || 0}</strong><small>研发 + 渠道</small></article>
            <article className={summary.critical ? 'is-critical' : ''}><span>阻断问题</span><strong>{summary.critical || 0}</strong><small>应优先处理</small></article>
            <article className={summary.warning ? 'is-warning' : ''}><span>待核对</span><strong>{summary.warning || 0}</strong><small>可能存在历史漂移</small></article>
            <article className={summary.healthy ? 'is-good' : ''}><span>巡检结论</span><strong>{summary.healthy ? '一致' : `${summary.total || 0} 项`}</strong><small>{summary.healthy ? '未发现跨模块矛盾' : '按优先级逐项处理'}</small></article>
          </div>

          {!summary.healthy ? (
            <div className="system-consistency-filters">
              <div className="system-consistency-filter-group" role="group" aria-label="问题级别">
                <button type="button" className={severity === 'all' ? 'is-active' : ''} onClick={() => setSeverity('all')}>全部 {summary.total || 0}</button>
                <button type="button" className={severity === 'critical' ? 'is-active is-critical' : ''} onClick={() => setSeverity('critical')}>阻断 {summary.critical || 0}</button>
                <button type="button" className={severity === 'warning' ? 'is-active' : ''} onClick={() => setSeverity('warning')}>待核对 {summary.warning || 0}</button>
                <button type="button" className={severity === 'info' ? 'is-active' : ''} onClick={() => setSeverity('info')}>提醒 {summary.info || 0}</button>
              </div>
              <div className="system-consistency-filter-row">
                <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="筛选一致性问题类型">
                  <option value="all">全部类型</option>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <option value={key} key={key}>{label} ({categoryCounts[key] || 0})</option>
                  ))}
                </select>
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索账单、合作方或异常说明" />
                {(severity !== 'all' || category !== 'all' || query) ? <button type="button" onClick={resetFilters}>重置</button> : null}
                <span>当前 {filtered.length} 项</span>
              </div>
            </div>
          ) : null}

          {summary.healthy ? (
            <div className="system-consistency-empty">
              <strong>当前未发现结构性数据矛盾</strong>
              <span>已检查 {summary.invoice_allocations_scanned || 0} 条发票分配、{summary.bank_matches_scanned || 0} 条银行核销、{summary.archived_bills_scanned || 0} 张归档账单。</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="system-consistency-empty">
              <strong>当前筛选条件下没有问题</strong>
              <span>可以重置筛选查看全部 {summary.total || 0} 项巡检结果。</span>
            </div>
          ) : (
            <div className="system-consistency-list">
              {visible.map((issue) => (
                <article className={`is-${issue.severity}`} key={issue.id}>
                  <div className="system-consistency-main">
                    <span className="system-consistency-severity">{severityLabel(issue.severity)}</span>
                    <div>
                      <div className="system-consistency-title">
                        <strong>{issue.title}</strong>
                        <em>{CATEGORY_LABELS[issue.category] || issue.category}</em>
                      </div>
                      <p>{issue.detail}</p>
                      <div className="system-consistency-meta">
                        {issue.bill_number ? <span>账单 {issue.bill_number}</span> : null}
                        {issue.partner_name ? <span>{issue.partner_name}</span> : null}
                        {issue.settlement_month ? <span>{issue.settlement_month}</span> : null}
                        {issue.amount != null ? <b>{money(issue.amount)}</b> : null}
                      </div>
                      <div className="system-consistency-recommendation">
                        <span>建议处理</span>
                        <p>{CATEGORY_ACTIONS[issue.category] || '核对异常证据后，再在对应业务模块处理。'}</p>
                      </div>
                    </div>
                  </div>
                  {(issue.bill_id || issue.target_view) ? (
                    <div className="system-consistency-actions">
                      {issue.bill_id ? <button type="button" onClick={() => openIssueBill(issue)}>账单 360°</button> : null}
                      {issue.target_view ? <button type="button" className="is-primary" onClick={() => openIssueTarget(issue)}>{actionLabel(issue)}</button> : null}
                    </div>
                  ) : null}
                </article>
              ))}
              {filtered.length > 8 ? (
                <button type="button" className="system-consistency-expand" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? '收起' : `查看当前全部 ${filtered.length} 项`}
                </button>
              ) : null}
              {data.truncated ? <small className="system-consistency-truncated">问题数量超过当前展示上限，请处理后重新巡检。</small> : null}
            </div>
          )}

          <footer className="system-consistency-foot">
            <span>发票分配 {summary.invoice_allocations_scanned || 0}</span>
            <span>银行核销 {summary.bank_matches_scanned || 0}</span>
            <span>归档账单 {summary.archived_bills_scanned || 0}</span>
            <span>{data.generated_at ? new Date(data.generated_at).toLocaleString('zh-CN', { hour12: false }) : '-'}</span>
          </footer>
        </>
      ) : loading ? <div className="system-consistency-loading">正在核对跨模块关联、金额覆盖和生命周期状态…</div> : null}
    </section>
  )
}
