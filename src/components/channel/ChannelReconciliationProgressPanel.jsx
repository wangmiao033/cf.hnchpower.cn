import React from 'react'

function money(value) {
  const amount = Number(value || 0)
  return `¥ ${amount.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function percent(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

function matchedBill(row) {
  return Number(row.matchedBill ?? row.backendBill ?? 0)
}

function unmatchedAmount(row) {
  if (row.unmatchedAmount != null) return Number(row.unmatchedAmount || 0)
  return Math.max(Number(row.sourceFlow || 0) - matchedBill(row), 0)
}

function monthLabel(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : value || '当前账期'
}

function ProgressBar({ value, tone = 'blue' }) {
  const width = Math.max(0, Math.min(100, Number(value || 0)))
  return (
    <div
      className={`channel-progress-bar channel-progress-bar--${tone}`}
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(width)}
    >
      <span style={{ width: `${width}%` }} />
    </div>
  )
}

function ChannelReconciliationProgressPanel({
  snapshot,
  expanded,
  onToggle,
  onImport
}) {
  const totals = snapshot.totals

  return (
    <section className="channel-progress-panel">
      <div className="channel-progress-head">
        <div>
          <div className="channel-progress-heading-line">
            <span className="channel-progress-period">{monthLabel(snapshot.month)}</span>
            <h2>渠道对账进度</h2>
            <span className="channel-progress-local-state">本机预览</span>
          </div>
          <p>{snapshot.fileName} · 流水金额为主口径，明细行数为辅助口径</p>
        </div>
        <div className="channel-progress-actions">
          <button type="button" onClick={onImport}>更新进度数据</button>
          <button type="button" className="channel-progress-toggle" onClick={onToggle}>
            {expanded ? '收起' : '展开'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="channel-progress-body">
          <div className="channel-progress-overview">
            <div className="channel-progress-primary">
              <span>流水已核对</span>
              <strong>{percent(totals.reconciliationAmountPercent)}</strong>
              <ProgressBar value={totals.reconciliationAmountPercent} />
              <p>
                {money(totals.reconciledFlow)}
                <span> / {money(totals.sourceFlow)}</span>
              </p>
            </div>
            <div className="channel-progress-stages">
              <div>
                <span>源流水</span>
                <strong>{totals.rows} 条</strong>
                <small>{money(totals.sourceFlow)}</small>
              </div>
              <div className="is-complete">
                <span>已核对</span>
                <strong>{totals.reconciledRows} 条</strong>
                <small>{money(totals.reconciledFlow)}</small>
              </div>
              <div className="is-receivable">
                <span>已登记应收</span>
                <strong>{totals.receivableRows} 条</strong>
                <small>{money(totals.receivableFlow)}</small>
              </div>
              <div className="is-warning">
                <span>待处理</span>
                <strong>{totals.unresolvedRows} 条</strong>
                <small>{money(totals.unresolvedFlow)}</small>
              </div>
            </div>
          </div>

          <div className="channel-progress-secondary">
            <div>
              <div>
                <span>金额覆盖率</span>
                <strong>{percent(totals.reconciliationAmountPercent)}</strong>
              </div>
              <ProgressBar value={totals.reconciliationAmountPercent} tone="green" />
            </div>
            <div>
              <div>
                <span>明细完成率</span>
                <strong>{percent(totals.reconciliationRowPercent)}</strong>
              </div>
              <ProgressBar value={totals.reconciliationRowPercent} tone="slate" />
            </div>
            <div>
              <div>
                <span>应收登记率</span>
                <strong>{percent(totals.receivableAmountPercent)}</strong>
              </div>
              <ProgressBar value={totals.receivableAmountPercent} tone="violet" />
            </div>
          </div>

          <div className="channel-progress-issues">
            <div className="channel-progress-issues-head">
              <div>
                <h3>待处理流水</h3>
                <span>按流水金额从高到低排列</span>
              </div>
              <strong>{money(totals.unresolvedFlow)}</strong>
            </div>
            <div className="channel-progress-table-wrap">
              <table className="channel-progress-table">
                <thead>
                  <tr>
                    <th>产品</th>
                    <th>渠道</th>
                    <th>源流水</th>
                    <th>已匹配账单</th>
                    <th>未匹配金额</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.unresolved.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="channel-progress-empty">当前账期流水已全部核对</td>
                    </tr>
                  ) : (
                    snapshot.unresolved.map((row) => (
                      <tr key={row.id || `${row.product}-${row.channel}`}>
                        <td><strong>{row.product}</strong></td>
                        <td>{row.channel}</td>
                        <td className="is-number">{money(row.sourceFlow)}</td>
                        <td className="is-number">{money(matchedBill(row))}</td>
                        <td className="is-number is-difference">{money(unmatchedAmount(row))}</td>
                        <td><span className="channel-progress-pending">待匹配</span></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default ChannelReconciliationProgressPanel
