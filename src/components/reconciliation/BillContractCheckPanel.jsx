import React, { useEffect, useMemo, useState } from 'react'
import { getContractBillReconciliation } from '@/lib/api/contractTerms.ts'
import './BillContractCheckPanel.css'

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

export default function BillContractCheckPanel({ billType, billId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedLineId, setExpandedLineId] = useState(null)

  useEffect(() => {
    if (!billId) return undefined
    let active = true
    setLoading(true)
    setError('')
    setData(null)
    void getContractBillReconciliation(billType, billId)
      .then((result) => {
        if (!active) return
        setData(result)
        const firstIssue = result.lines?.find((line) => line.status !== 'pass')
        setExpandedLineId(firstIssue?.line_id || result.lines?.[0]?.line_id || null)
      })
      .catch((loadError) => {
        if (!active) return
        const message = loadError instanceof Error ? loadError.message : '合同自动核验读取失败'
        setError(message)
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

  return (
    <section className="bill-contract-check" aria-label="合同自动核验">
      <div className="bill-contract-check__head">
        <div>
          <span>CONTRACT PREFLIGHT</span>
          <h3>合同自动核验</h3>
          <p>按合作方 + 游戏 + 账期 + 授权期自动匹配具体合作清单，再比较分成、税率与费用条款。</p>
        </div>
        <div className={`bill-contract-check__summary is-${statusClass}`}>
          <strong>{loading ? '…' : summary?.overall_status === 'pass' ? '通过' : summary?.fail_count ? '有差异' : '需复核'}</strong>
          <span>{summaryText(summary)}</span>
        </div>
      </div>

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
            <div className="is-pass"><span>一致</span><strong>{summary?.pass_count || 0}</strong></div>
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
              return (
                <article className={`bill-contract-line is-${line.status}`} key={line.line_id}>
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
                          <strong>{line.match.contract_name || '未命名合同'}</strong>
                          <small>
                            {line.match.product_name || '-'} · 匹配分 {numberText(line.match.score)}
                            {line.match.confidence === 'high' ? ' · 高置信' : line.match.confidence === 'medium' ? ' · 中置信' : ' · 低置信'}
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
                          <strong>可能的候选清单</strong>
                          {line.candidates.map((candidate) => (
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

          <div className="bill-contract-check__foot">
            <span>当前版本只做自动预检，不会因为合同缺字段直接阻止账单核对。</span>
            <strong>{summary?.can_auto_confirm ? '已具备自动通过条件' : '存在需人工处理项'}</strong>
          </div>
        </>
      )}
    </section>
  )
}
