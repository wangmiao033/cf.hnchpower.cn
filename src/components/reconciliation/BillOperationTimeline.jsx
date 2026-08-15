import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { listOperationLogs } from '@/lib/api/operationLog.ts'
import {
  operationActionCategory,
  operationActionMeta,
  operationActorLabel,
  operationChangeLines,
  operationHiddenChangeCount
} from '@/domain/reconciliation/operationLogPresentation.js'
import BillLifecyclePanel from './BillLifecyclePanel.jsx'
import './Bill360OperationTimeline.css'

const FILTERS = [
  ['all', '全部'],
  ['status', '状态'],
  ['invoice', '发票'],
  ['funding', '资金'],
  ['attachment', '附件'],
  ['bill', '账单修改']
]

function dateTime(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw.replace('T', ' ').slice(0, 19)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

function evidenceText(log) {
  const metadata = log?.metadata || {}
  if (String(log?.action || '').startsWith('bank_match_')) {
    const amount = Number(metadata.linked_amount || 0)
    const amountText = Number.isFinite(amount)
      ? `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : ''
    return [metadata.bank_transaction_id ? `银行流水 ${metadata.bank_transaction_id}` : '', amountText ? `本账单分配 ${amountText}` : '']
      .filter(Boolean)
      .join(' · ')
  }
  if (String(log?.action || '').startsWith('attachment_')) {
    return [metadata.file_name || '', metadata.attachment_id ? `附件ID ${metadata.attachment_id}` : ''].filter(Boolean).join(' · ')
  }
  return ''
}

export default function BillOperationTimeline({ billType, billId }) {
  const { recon, showToast } = useAppState()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    if (!billId) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    listOperationLogs({
      entity_type: billType,
      entity_id: billId,
      include_related: true,
      limit: 300,
      offset: 0
    })
      .then((response) => {
        if (!cancelled) setLogs(response.items || [])
      })
      .catch((loadError) => {
        if (!cancelled) {
          setLogs([])
          setError(loadError instanceof Error ? loadError.message : '操作日志读取失败')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [billId, billType, revision])

  useEffect(() => setFilter('all'), [billId, billType])

  const ordered = useMemo(
    () => [...logs].sort((left, right) => String(right.created_at).localeCompare(String(left.created_at))),
    [logs]
  )

  const counts = useMemo(() => {
    const next = { all: ordered.length, status: 0, invoice: 0, funding: 0, attachment: 0, bill: 0 }
    ordered.forEach((log) => {
      const category = operationActionCategory(log.action)
      next[category] = (next[category] || 0) + 1
    })
    return next
  }, [ordered])

  const visibleLogs = useMemo(
    () => filter === 'all' ? ordered : ordered.filter((log) => operationActionCategory(log.action) === filter),
    [filter, ordered]
  )

  const handleTransitioned = async () => {
    if (billType === 'rd') {
      await recon.refetchReconciliationFromApi?.()
    } else {
      await recon.refetchChannelFromApi?.()
    }
    setRevision((value) => value + 1)
  }

  return (
    <div className="bill360-status-history-stack">
      <BillLifecyclePanel
        billType={billType}
        billId={billId}
        onTransitioned={handleTransitioned}
        showToast={showToast}
      />

      <section className="bill360-card bill360-card--table">
        <div className="bill360-card-head">
          <div><span>审计轨迹</span><h3>账单完整操作证据链</h3></div>
          <span className="bill360-card-meta">{loading ? '读取中…' : `${ordered.length} 条`}</span>
        </div>
        <div className="bill360-operation-note">
          状态、发票、银行核销和附件操作按数据库审计日志统一汇总。银行核销虽然来自独立核销表，也会按账单关系归入当前时间线。
        </div>

        {!loading && !error && ordered.length > 0 ? (
          <div className="bill360-audit-filters" role="tablist" aria-label="操作日志分类">
            {FILTERS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={filter === key ? 'is-active' : ''}
                onClick={() => setFilter(key)}
              >
                {label}<em>{counts[key] || 0}</em>
              </button>
            ))}
          </div>
        ) : null}

        {error ? <div className="bill360-history-empty">{error}</div> : null}
        {!error && loading ? <div className="bill360-history-empty">正在读取操作日志…</div> : null}
        {!error && !loading && ordered.length === 0 ? (
          <div className="bill360-history-empty">当前账单暂无操作日志。历史数据不会反向伪造日志，新操作会自动开始记录。</div>
        ) : null}
        {!error && !loading && ordered.length > 0 && visibleLogs.length === 0 ? (
          <div className="bill360-history-empty">当前分类暂无操作记录。</div>
        ) : null}

        {!error && visibleLogs.length > 0 ? (
          <div className="bill360-timeline">
            {visibleLogs.map((log) => {
              const action = operationActionMeta(log.action)
              const changes = operationChangeLines(log.changes, 8)
              const hidden = operationHiddenChangeCount(log.changes, changes.length)
              const reason = log.metadata?.reason ? String(log.metadata.reason) : ''
              const evidence = evidenceText(log)
              return (
                <article className="bill360-timeline-item" key={log.id}>
                  <span className={`bill360-timeline-mark is-${action.tone}`}>{action.mark}</span>
                  <div className="bill360-timeline-card">
                    <div className="bill360-timeline-head">
                      <div>
                        <strong>{log.summary || action.label}</strong>
                        <span>{operationActorLabel(log)} · {action.label}</span>
                      </div>
                      <time>{dateTime(log.created_at)}</time>
                    </div>
                    {evidence ? <div className="bill360-audit-evidence">证据：{evidence}</div> : null}
                    {reason ? <div className="bill360-transition-reason">原因：{reason}</div> : null}
                    {changes.length > 0 ? (
                      <div className="bill360-change-list">
                        {changes.map((change) => (
                          <div className="bill360-change-row" key={`${log.id}-${change.field}`}>
                            <span>{change.label}</span>
                            <div className="bill360-change-values">
                              <del title={change.before}>{change.before}</del>
                              <b>→</b>
                              <ins title={change.after}>{change.after}</ins>
                            </div>
                          </div>
                        ))}
                        {hidden > 0 ? <div className="bill360-change-more">另有 {hidden} 项变更已留档</div> : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        ) : null}
      </section>
    </div>
  )
}
