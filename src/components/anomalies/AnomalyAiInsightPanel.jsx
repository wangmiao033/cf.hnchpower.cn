import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import { analyzeAnomalyRisks } from '@/lib/api/anomalyAi.ts'
import './AnomalyAiInsightPanel.css'

function money(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function toPayload(item) {
  return {
    id: String(item?.id || ''),
    severity: item?.severity || 'warning',
    category: item?.category || 'quality',
    title: item?.title || '',
    detail: item?.detail || '',
    amount: item?.amount == null ? null : Number(item.amount || 0),
    bill_type: item?.billType || null,
    bill_id: item?.billId || null,
    bill_number: item?.billNumber || null,
    partner_name: item?.partnerName || null,
    settlement_month: item?.settlementMonth || null,
    game_name: item?.gameName || null,
    status: item?.status || 'pending'
  }
}

function signalTarget(signal) {
  if (String(signal?.key || '').startsWith('bank-')) return VIEWS.BANK_RECONCILIATION
  if (['operating-profit-negative', 'profit-margin-drop', 'shared-expense-high'].includes(signal?.key)) {
    return VIEWS.PROFIT_ANALYSIS
  }
  return null
}

function riskTone(score) {
  if (score >= 80) return 'critical'
  if (score >= 55) return 'warning'
  if (score >= 30) return 'attention'
  return 'healthy'
}

export default function AnomalyAiInsightPanel({ anomalies = [], sourceLoading = false }) {
  const { setActiveView, openBill360 } = useAppState()
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  const analysisInput = useMemo(
    () => (anomalies || [])
      .filter((item) => item?.id)
      .slice(0, 500)
      .map(toPayload),
    [anomalies]
  )

  useEffect(() => {
    if (sourceLoading) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    analyzeAnomalyRisks(analysisInput)
      .then((result) => {
        if (!cancelled) setAnalysis(result)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '智能风险分析失败')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [analysisInput, revision, sourceLoading])

  const anomalyMap = useMemo(
    () => new Map((anomalies || []).map((item) => [item.id, item])),
    [anomalies]
  )
  const summary = analysis?.summary
  const tone = riskTone(Number(summary?.risk_score || 0))

  const openAnalysisBill = (row) => {
    if (!row?.bill_id) return
    openBill360?.(row.bill_type === 'channel' ? 'channel' : 'rd', row.bill_id)
  }

  return (
    <section className={`anomaly-ai-panel is-${tone}`} aria-label="智能风险分析">
      <header className="anomaly-ai-head">
        <div>
          <div className="anomaly-ai-badges">
            <span>智能风险分析</span>
            <em>可解释规则引擎</em>
          </div>
          <h2>经营与财务风险诊断</h2>
          <p>综合异常规则、银行核销和利润数据给出优先级、可能根因与处理建议；每个结论都保留计算依据。</p>
        </div>
        <button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading || sourceLoading}>
          {loading || sourceLoading ? '分析中…' : '重新智能分析'}
        </button>
      </header>

      {error && !analysis ? (
        <div className="anomaly-ai-error">
          <strong>智能分析暂时不可用</strong>
          <span>{error}</span>
          <small>原始异常巡检不受影响，可以继续正常处理。</small>
        </div>
      ) : null}

      {analysis ? (
        <>
          <div className="anomaly-ai-overview">
            <div className={`anomaly-ai-score is-${tone}`}>
              <div style={{ '--risk-score': `${Math.max(0, Math.min(100, Number(summary?.risk_score || 0)))}%` }}>
                <strong>{summary?.risk_score || 0}</strong>
                <span>/100</span>
              </div>
              <p>{summary?.health_label || '健康'}</p>
            </div>

            <div className="anomaly-ai-narrative">
              <span>风险摘要</span>
              <strong>{summary?.narrative || '暂无风险摘要。'}</strong>
              <div className="anomaly-ai-facts">
                <em><b>{summary?.critical_count || 0}</b> 严重</em>
                <em><b>{summary?.warning_count || 0}</b> 待处理</em>
                <em><b>{summary?.info_count || 0}</b> 提醒</em>
                <em><b>{money(summary?.exposure_amount || 0)}</b> 风险暴露</em>
              </div>
            </div>

            <div className="anomaly-ai-priority">
              <span>建议先做</span>
              {(summary?.recommended_actions || []).slice(0, 3).map((action, index) => (
                <div key={`${index}-${action}`}><i>{index + 1}</i><p>{action}</p></div>
              ))}
              {(summary?.recommended_actions || []).length === 0 ? <small>当前暂无额外处理建议。</small> : null}
            </div>
          </div>

          {(analysis.system_signals || []).length > 0 ? (
            <div className="anomaly-ai-signals">
              <div className="anomaly-ai-section-title">
                <span>SYSTEM SIGNALS</span>
                <strong>跨模块经营信号</strong>
              </div>
              <div className="anomaly-ai-signal-grid">
                {(analysis.system_signals || []).map((signal) => {
                  const target = signalTarget(signal)
                  return (
                    <article className={`is-${signal.severity}`} key={signal.key}>
                      <div><span>{signal.severity === 'critical' ? '高风险' : signal.severity === 'warning' ? '需处理' : '提醒'}</span><strong>{signal.title}</strong></div>
                      <p>{signal.detail}</p>
                      {signal.action ? <small>{signal.action}</small> : null}
                      {target ? <button type="button" onClick={() => setActiveView(target)}>去处理 →</button> : null}
                    </article>
                  )
                })}
              </div>
            </div>
          ) : null}

          <div className="anomaly-ai-top-risks">
            <div className="anomaly-ai-section-title">
              <span>PRIORITY DIAGNOSIS</span>
              <strong>最高优先级诊断</strong>
            </div>
            <div className="anomaly-ai-diagnosis-list">
              {(analysis.items || []).slice(0, 6).map((row) => {
                const source = anomalyMap.get(row.anomaly_id)
                return (
                  <article key={row.anomaly_id}>
                    <div className="anomaly-ai-diagnosis-main">
                      <span className={`priority is-${riskTone(row.priority_score)}`}>{row.priority_score}</span>
                      <div>
                        <div className="anomaly-ai-diagnosis-title"><strong>{source?.title || row.anomaly_id}</strong><em>{row.priority_label} · 置信度 {(Number(row.confidence || 0) * 100).toFixed(0)}%</em></div>
                        <p>{source?.detail || row.explanation}</p>
                        {(row.related_signals || []).length ? <div className="anomaly-ai-related">{row.related_signals.map((signal) => <span key={signal}>{signal}</span>)}</div> : null}
                      </div>
                    </div>
                    <details>
                      <summary>查看根因与处理建议</summary>
                      <div className="anomaly-ai-diagnosis-detail">
                        <section><span>可能根因</span>{(row.root_causes || []).map((cause) => <p key={cause}>• {cause}</p>)}</section>
                        <section><span>建议动作</span>{(row.recommended_actions || []).map((action) => <p key={action}>• {action}</p>)}</section>
                        <small>{row.explanation}</small>
                      </div>
                    </details>
                    {row.bill_id ? <button type="button" className="anomaly-ai-open-bill" onClick={() => openAnalysisBill(row)}>账单360</button> : null}
                  </article>
                )
              })}
              {(analysis.items || []).length === 0 ? <div className="anomaly-ai-empty">当前没有需要智能诊断的待处理异常。</div> : null}
            </div>
          </div>

          <footer className="anomaly-ai-foot">
            <span>分析引擎：{analysis.engine || 'explainable-risk-engine'}</span>
            <span>生成时间：{analysis.generated_at ? new Date(analysis.generated_at).toLocaleString('zh-CN', { hour12: false }) : '-'}</span>
            <span>该结果用于内部经营复核，不替代财务凭证或人工审批。</span>
          </footer>
        </>
      ) : loading || sourceLoading ? <div className="anomaly-ai-loading">正在分析账单、资金、发票、合同与经营数据…</div> : null}
    </section>
  )
}
