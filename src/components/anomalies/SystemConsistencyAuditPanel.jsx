import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { getSystemConsistencyAudit } from '@/lib/api/anomaly.ts'
import './SystemConsistencyAuditPanel.css'

const CATEGORY_LABELS = {
  lifecycle: '状态一致性',
  invoice: '发票一致性',
  funding: '资金一致性',
  archive: '归档一致性',
  reference: '关联完整性'
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

export default function SystemConsistencyAuditPanel() {
  const { openBill360, setActiveView } = useAppState()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [revision, setRevision] = useState(0)

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
  const visible = useMemo(() => expanded ? issues : issues.slice(0, 8), [expanded, issues])
  const summary = data?.summary || {}

  const openIssue = (issue) => {
    if (issue?.bill_id && issue?.bill_type) {
      openBill360?.(issue.bill_type === 'channel' ? 'channel' : 'rd', issue.bill_id)
      return
    }
    if (issue?.target_view) setActiveView?.(issue.target_view)
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
            <article className={summary.healthy ? 'is-good' : ''}><span>巡检结论</span><strong>{summary.healthy ? '一致' : `${summary.total || 0} 项`}</strong><small>{summary.healthy ? '未发现跨模块矛盾' : '点击下方账单进入 360° 处理'}</small></article>
          </div>

          {summary.healthy ? (
            <div className="system-consistency-empty">
              <strong>当前未发现结构性数据矛盾</strong>
              <span>已检查 {summary.invoice_allocations_scanned || 0} 条发票分配、{summary.bank_matches_scanned || 0} 条银行核销、{summary.archived_bills_scanned || 0} 张归档账单。</span>
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
                    </div>
                  </div>
                  {(issue.bill_id || issue.target_view) ? (
                    <button type="button" onClick={() => openIssue(issue)}>
                      {issue.bill_id ? '打开账单 360°' : '去对应模块'}
                    </button>
                  ) : null}
                </article>
              ))}
              {issues.length > 8 ? (
                <button type="button" className="system-consistency-expand" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? '收起' : `查看全部 ${issues.length} 项`}
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
