import React, { useEffect, useMemo, useState } from 'react'
import { listOperationLogs } from '@/lib/api/operationLog.ts'
import {
  operationActionMeta,
  operationActorLabel,
  operationChangeLines,
  operationHiddenChangeCount
} from '@/domain/reconciliation/operationLogPresentation.js'
import './Bill360OperationTimeline.css'

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

export default function BillOperationTimeline({ billType, billId }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!billId) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    listOperationLogs({
      entity_type: billType,
      entity_id: billId,
      limit: 200,
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
  }, [billId, billType])

  const ordered = useMemo(
    () => [...logs].sort((left, right) => String(right.created_at).localeCompare(String(left.created_at))),
    [logs]
  )

  return (
    <section className="bill360-card bill360-card--table">
      <div className="bill360-card-head">
        <div><span>审计轨迹</span><h3>操作日志</h3></div>
        <span className="bill360-card-meta">{loading ? '读取中…' : `${ordered.length} 条`}</span>
      </div>
      <div className="bill360-operation-note">
        日志由数据库自动记录，包含账单修改、状态变化、收付款、付款指令与发票关联。V2.1-2 上线后的操作开始完整留痕。
      </div>

      {error ? <div className="bill360-history-empty">{error}</div> : null}
      {!error && loading ? <div className="bill360-history-empty">正在读取操作日志…</div> : null}
      {!error && !loading && ordered.length === 0 ? (
        <div className="bill360-history-empty">当前账单暂无操作日志。历史数据不会反向伪造日志，新操作会从本版本开始记录。</div>
      ) : null}

      {!error && ordered.length > 0 ? (
        <div className="bill360-timeline">
          {ordered.map((log) => {
            const action = operationActionMeta(log.action)
            const changes = operationChangeLines(log.changes, 8)
            const hidden = operationHiddenChangeCount(log.changes, changes.length)
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
  )
}
