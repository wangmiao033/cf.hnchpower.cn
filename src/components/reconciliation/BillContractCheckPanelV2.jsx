import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import {
  autoLockBillContractLines,
  bindBillContractLine,
  getContractBillReconciliation,
  unbindBillContractLine
} from '@/lib/api/contractTerms.ts'
import './BillContractCheckPanel.css'
import './BillContractCheckPanelV2.css'

const STATUS_LABELS = {
  pass: '一致',
  warning: '需复核',
  fail: '存在差异',
  unmatched: '未匹配'
}

const CHECK_STATUS_LABELS = {
  pass: '一致',
  fail: '差异',
  manual: '人工复核',
  missing: '合同缺字段',
  not_applicable: '不适用'
}

function numberText(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return String(value ?? '-')
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
}

function dateTimeText(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  return raw.replace('T', ' ').slice(0, 19)
}

function fieldValue(value, key) {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'object') {
    if (value.mode || value.unit_price !== undefined) {
      return [value.mode, value.unit_price == null ? '' : `${value.currency || ''} ${numberText(value.unit_price)}`]
        .filter(Boolean)
        .join(' · ') || '-'
    }
    return JSON.stringify(value)
  }
  if (['share_rate', 'tax_rate', 'channel_fee_rate'].includes(key)) return `${numberText(value)}%`
  if (['testing_fee', 'refund_rule', 'deduction_rule', 'server_cost'].includes(key) && typeof value === 'number') {
    return `¥${numberText(value)}`
  }
  return String(value)
}

function summaryText(summary) {
  if (!summary) return '正在读取合同依据…'
  if (summary.overall_status === 'pass') return `全部 ${summary.total_lines} 条明细已通过合同自动核验`
  if (summary.fail_count) return `${summary.fail_count} 条存在明确差异，建议先核对合同或账单`
  return `${summary.issue_count} 项需要补充合同字段或人工复核`
}

function bindingLabel(binding) {
  if (!binding) return ''
  return binding.match_method === 'auto_locked' ? '高置信已锁定' : '人工已锁定'
}

function candidateLabel(candidate) {
  const title = [candidate.contract_name, candidate.product_name].filter(Boolean).join(' / ')
  const score = Number.isFinite(Number(candidate.score)) ? ` · ${numberText(candidate.score)}分` : ''
  const auth = candidate.authorization_status === 'covered'
    ? ' · 授权期内'
    : candidate.authorization_status === 'out_of_range'
      ? ' · 授权期外'
      : ''
  return `${title || candidate.access_item_id}${score}${auth}`
}

export default function BillContractCheckPanelV2({ billType, billId }) {
  const { can } = useAuth()
  const canManage = can('contracts.manage')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedLineId, setExpandedLineId] = useState(null)
  const [selectedByLine, setSelectedByLine] = useState({})
  const [actionKey, setActionKey] = useState('')
  const [actionMessage, setActionMessage] = useState('')

  const load = useCallback(async ({ preserveExpanded = true } = {}) => {
    if (!billId) return null
    setLoading(true)
    setError('')
    try {
      const result = await getContractBillReconciliation(billType, billId)
      setData(result)
      setSelectedByLine((current) => {
        const next = { ...current }
        for (const line of result.lines || []) {
          if (!next[line.line_id]) {
            next[line.line_id] = line.binding?.access_item_id || line.match?.access_item_id || ''
          }
        }
        return next
      })
      if (!preserveExpanded) {
        const firstIssue = result.lines?.find((line) => line.status !== 'pass')
        setExpandedLineId(firstIssue?.line_id || result.lines?.[0]?.line_id || null)
      } else {
        setExpandedLineId((current) => current || result.lines?.find((line) => line.status !== 'pass')?.line_id || result.lines?.[0]?.line_id || null)
      }
      return result
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : '合同自动核验读取失败'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [billId, billType])

  useEffect(() => {
    let active = true
    setData(null)
    setSelectedByLine({})
    setExpandedLineId(null)
    setActionMessage('')
    if (!billId) return undefined
    void getContractBillReconciliation(billType, billId)
      .then((result) => {
        if (!active) return
        setData(result)
        const defaults = {}
        for (const line of result.lines || []) {
          defaults[line.line_id] = line.binding?.access_item_id || line.match?.access_item_id || ''
        }
        setSelectedByLine(defaults)
        const firstIssue = result.lines?.find((line) => line.status !== 'pass')
        setExpandedLineId(firstIssue?.line_id || result.lines?.[0]?.line_id || null)
      })
      .catch((loadError) => {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : '合同自动核验读取失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [billId, billType])

  const summary = data?.summary
  const lineRows = data?.lines || []
  const statusClass = summary?.overall_status || (loading ? 'loading' : 'warning')
  const billChecks = data?.bill_checks || []
  const orderedLines = useMemo(
    () => [...lineRows].sort((left, right) => {
      const order = { fail: 0, unmatched: 1, warning: 2, pass: 3 }
      return (order[left.status] ?? 9) - (order[right.status] ?? 9)
    }),
    [lineRows]
  )

  const handleAutoLock = async () => {
    if (!canManage || actionKey) return
    setActionKey('auto-lock')
    setActionMessage('')
    try {
      const result = await autoLockBillContractLines(billType, billId)
      setData(result.reconciliation)
      const count = Number(result.locked_count || 0)
      setActionMessage(count ? `已锁定 ${count} 条高置信合同匹配。` : '当前没有新的高置信匹配需要锁定。')
    } catch (actionError) {
      setActionMessage(actionError instanceof Error ? actionError.message : '自动锁定失败')
    } finally {
      setActionKey('')
    }
  }

  const handleBind = async (line) => {
    if (!canManage || actionKey) return
    const selected = selectedByLine[line.line_id] || line.match?.access_item_id || ''
    if (!selected) {
      setActionMessage('请先选择要锁定的合同合作清单。')
      return
    }
    const selectedCandidate = (line.candidates || []).find((candidate) => candidate.access_item_id === selected)
    const noteDefault = selectedCandidate
      ? `人工确认：${selectedCandidate.contract_name || ''} / ${selectedCandidate.product_name || ''}`
      : '人工确认合同合作清单'
    const note = window.prompt('可填写本次匹配说明（可选）：', noteDefault)
    if (note === null) return
    setActionKey(`bind:${line.line_id}`)
    setActionMessage('')
    try {
      await bindBillContractLine(billType, billId, line.line_id, selected, note)
      await load()
      setActionMessage(`“${line.game_name || '该明细'}”已锁定到指定合同清单。`)
    } catch (actionError) {
      setActionMessage(actionError instanceof Error ? actionError.message : '锁定合同依据失败')
    } finally {
      setActionKey('')
    }
  }

  const handleUnbind = async (line) => {
    if (!canManage || !line.binding || actionKey) return
    if (!window.confirm(`解除“${line.game_name || '该明细'}”的合同锁定吗？\n\n解除后系统会重新按匹配分自动推荐。`)) return
    setActionKey(`unbind:${line.line_id}`)
    setActionMessage('')
    try {
      await unbindBillContractLine(billType, billId, line.line_id)
      setSelectedByLine((current) => ({ ...current, [line.line_id]: '' }))
      await load()
      setActionMessage(`“${line.game_name || '该明细'}”已解除锁定。`)
    } catch (actionError) {
      setActionMessage(actionError instanceof Error ? actionError.message : '解除合同锁定失败')
    } finally {
      setActionKey('')
    }
  }

  return (
    <section className="bill-contract-check bill-contract-check--v2" aria-label="合同自动核验第二版">
      <div className="bill-contract-check__head">
        <div>
          <span>CONTRACT PREFLIGHT · V2</span>
          <h3>合同自动核验 · 已可锁定依据</h3>
          <p>自动匹配只是建议；确认正确后可锁定到具体合作清单，后续核验不再因名称变化而漂移。</p>
        </div>
        <div className="bill-contract-check-v2__head-actions">
          <div className={`bill-contract-check__summary is-${statusClass}`}>
            <strong>{loading ? '…' : summary?.overall_status === 'pass' ? '通过' : summary?.fail_count ? '有差异' : '需复核'}</strong>
            <span>{summaryText(summary)}</span>
          </div>
          {canManage ? (
            <button
              type="button"
              className="bill-contract-check-v2__auto-lock"
              onClick={handleAutoLock}
              disabled={loading || !!actionKey}
            >
              {actionKey === 'auto-lock' ? '锁定中…' : '一键锁定高置信匹配'}
            </button>
          ) : null}
        </div>
      </div>

      {actionMessage ? <div className="bill-contract-check-v2__message">{actionMessage}</div> : null}

      {loading ? (
        <div className="bill-contract-check__loading">
          <span />
          正在匹配合同合作清单并核验条款…
        </div>
      ) : error ? (
        <div className="bill-contract-check__error">
          <strong>合同自动核验暂不可用</strong>
          <span>{error}</span>
        </div>
      ) : (
        <>
          <div className="bill-contract-check__metrics">
            <div><span>账单明细</span><strong>{summary?.total_lines || 0}</strong></div>
            <div><span>已匹配</span><strong>{summary?.matched_lines || 0}</strong></div>
            <div className="is-pass"><span>已锁定依据</span><strong>{summary?.binding_count || 0}</strong></div>
            <div className="is-warning"><span>需复核</span><strong>{summary?.warning_count || 0}</strong></div>
            <div className="is-fail"><span>明确差异</span><strong>{summary?.fail_count || 0}</strong></div>
            <div className="is-unmatched"><span>未匹配</span><strong>{summary?.unmatched_count || 0}</strong></div>
          </div>

          {billChecks.length ? (
            <div className="bill-contract-check__bill-level">
              <strong>账单级条款</strong>
              {billChecks.map((check) => (
                <div key={check.key} className={`is-${check.status}`}>
                  <span>{check.label}</span>
                  <p>{check.message}</p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="bill-contract-check__lines">
            {orderedLines.map((line) => {
              const expanded = expandedLineId === line.line_id
              const selected = selectedByLine[line.line_id] || line.binding?.access_item_id || line.match?.access_item_id || ''
              const binding = line.binding
              return (
                <article className={`bill-contract-line is-${line.status} ${binding ? 'is-locked' : ''}`} key={line.line_id}>
                  <button
                    type="button"
                    className="bill-contract-line__head"
                    onClick={() => setExpandedLineId(expanded ? null : line.line_id)}
                    aria-expanded={expanded}
                  >
                    <span className="bill-contract-line__status">{STATUS_LABELS[line.status] || line.status}</span>
                    <span className="bill-contract-line__game">
                      <strong>{line.game_name || '未命名游戏'}</strong>
                      <small>{line.settlement_cycle || '账期未填写'}</small>
                    </span>
                    <span className="bill-contract-line__match">
                      {line.match ? (
                        <>
                          <strong>
                            {line.match.contract_name || '未命名合同'}
                            {binding ? <em className="bill-contract-check-v2__locked-chip">{bindingLabel(binding)}</em> : null}
                          </strong>
                          <small>
                            {line.match.product_name || '-'} · 匹配分 {numberText(line.match.score)}
                            {binding ? ' · 固定依据' : line.match.confidence === 'high' ? ' · 高置信' : line.match.confidence === 'medium' ? ' · 中置信' : ' · 低置信'}
                          </small>
                        </>
                      ) : (
                        <><strong>暂无合同依据</strong><small>请先在合同中心补充该游戏合作清单</small></>
                      )}
                    </span>
                    <span className={`bill-contract-line__arrow ${expanded ? 'is-open' : ''}`}>›</span>
                  </button>

                  {expanded ? (
                    <div className="bill-contract-line__body">
                      {line.match ? (
                        <div className="bill-contract-match-meta">
                          <div><span>匹配清单</span><strong>{line.match.product_name || '-'}</strong></div>
                          <div><span>合作渠道</span><strong>{line.match.channel_name || '-'}</strong></div>
                          <div><span>授权期</span><strong>{line.match.authorization_start || '-'} ～ {line.match.authorization_end || '-'}</strong></div>
                          <div><span>结算方式</span><strong>{line.match.settlement_mode || line.match.settlement_basis || '-'}</strong></div>
                          <div><span>账期约定</span><strong>{line.match.payment_terms || '-'}</strong></div>
                          <div><span>匹配依据</span><strong>{(line.match.reasons || []).join(' · ') || '-'}</strong></div>
                        </div>
                      ) : null}

                      {binding ? (
                        <div className="bill-contract-check-v2__binding-info">
                          <div><span>固定方式</span><strong>{bindingLabel(binding)}</strong></div>
                          <div><span>确认时间</span><strong>{dateTimeText(binding.confirmed_at)}</strong></div>
                          <div><span>说明</span><strong>{binding.note || '未填写说明'}</strong></div>
                        </div>
                      ) : null}

                      {canManage ? (
                        <div className="bill-contract-check-v2__binding-editor">
                          <label>
                            <span>{binding ? '更换合同依据' : '确认合同依据'}</span>
                            <select
                              value={selected}
                              onChange={(event) => setSelectedByLine((current) => ({
                                ...current,
                                [line.line_id]: event.target.value
                              }))}
                            >
                              <option value="">请选择合作清单</option>
                              {(line.candidates || []).map((candidate) => (
                                <option key={candidate.access_item_id} value={candidate.access_item_id}>
                                  {candidateLabel(candidate)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div>
                            <button
                              type="button"
                              className="is-primary"
                              onClick={() => handleBind(line)}
                              disabled={!selected || !!actionKey}
                            >
                              {actionKey === `bind:${line.line_id}` ? '保存中…' : binding ? '保存新的固定依据' : '锁定此合同清单'}
                            </button>
                            {binding ? (
                              <button
                                type="button"
                                onClick={() => handleUnbind(line)}
                                disabled={!!actionKey}
                              >
                                {actionKey === `unbind:${line.line_id}` ? '解除中…' : '解除锁定'}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {line.checks?.length ? (
                        <div className="bill-contract-check-table">
                          <div className="bill-contract-check-table__head">
                            <span>核验项</span><span>账单</span><span>合同</span><span>结论</span>
                          </div>
                          {line.checks.map((check) => (
                            <div className={`bill-contract-check-row is-${check.status}`} key={check.key}>
                              <span><strong>{check.label}</strong><small>{check.message}</small></span>
                              <span>{fieldValue(check.bill_value, check.key)}</span>
                              <span>{fieldValue(check.contract_value, check.key)}</span>
                              <span><em>{CHECK_STATUS_LABELS[check.status] || check.status}</em></span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="bill-contract-check__empty">{line.message}</div>
                      )}

                      {!line.match && line.candidates?.length ? (
                        <div className="bill-contract-candidates">
                          <strong>同合作方候选清单</strong>
                          {line.candidates.slice(0, 8).map((candidate) => (
                            <span key={candidate.access_item_id}>
                              {candidate.contract_name} / {candidate.product_name} · {candidate.score} 分
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              )
            })}
            {!orderedLines.length ? <div className="bill-contract-check__empty">当前账单没有可核验的游戏明细。</div> : null}
          </div>

          <div className="bill-contract-check__foot bill-contract-check-v2__foot">
            <span>
              {data?.last_snapshot
                ? `最近一次确认快照：${dateTimeText(data.last_snapshot.created_at)} · ${data.last_snapshot.overall_status === 'pass' ? '通过' : data.last_snapshot.overall_status === 'fail' ? '有差异' : '需复核'}`
                : '账单确认后会自动保存当时的合同核验快照，后续合同修改不会覆盖历史依据。'}
            </span>
            <strong>{summary?.can_auto_confirm ? '已具备自动通过条件' : '存在需人工处理项'}</strong>
          </div>
        </>
      )}
    </section>
  )
}
