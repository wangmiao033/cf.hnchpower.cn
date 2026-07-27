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

function monthLabel(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : value || '全部账期'
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

function RdReconciliationProgressPanel({
  snapshot,
  expanded = true,
  onToggle,
  onEdit
}) {
  const totals = snapshot.totals

  return (
    <section className="channel-progress-panel rd-progress-panel">
      <div className="channel-progress-head">
        <div>
          <div className="channel-progress-heading-line">
            <span className="channel-progress-period">{monthLabel(snapshot.month)}</span>
            <h2>研发对账进度</h2>
            <span className="channel-progress-local-state rd-progress-live-state">实时数据</span>
          </div>
          <p>跟随当前筛选实时统计 · 结算金额为主口径，账单数量为辅助口径</p>
        </div>
        {typeof onToggle === 'function' && (
          <div className="channel-progress-actions">
            <button type="button" className="channel-progress-toggle" onClick={onToggle}>
              {expanded ? '收起' : '展开'}
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="channel-progress-body">
          <div className="channel-progress-overview">
            <div className="channel-progress-primary">
              <span>账单已核对</span>
              <strong>{percent(totals.reconciliationAmountPercent)}</strong>
              <ProgressBar value={totals.reconciliationAmountPercent} />
              <p>
                {money(totals.reconciledAmount)}
                <span> / {money(totals.settlementAmount)}</span>
              </p>
            </div>
            <div className="channel-progress-stages">
              <div>
                <span>账单流水</span>
                <strong>{totals.flowRows} / {totals.rows} 笔</strong>
                <small>{money(totals.flowAmount)}</small>
              </div>
              <div className="is-complete">
                <span>已核对</span>
                <strong>{totals.reconciledRows} 笔</strong>
                <small>{money(totals.reconciledAmount)}</small>
              </div>
              <div className="is-receivable">
                <span>已结算</span>
                <strong>{totals.settledRows} 笔</strong>
                <small>{money(totals.settledAmount)}</small>
              </div>
              <div className="is-warning">
                <span>待处理</span>
                <strong>{totals.unresolvedRows} 笔</strong>
                <small>{money(totals.unresolvedAmount)}</small>
              </div>
            </div>
          </div>

          <div className="channel-progress-secondary">
            <div>
              <div>
                <span>金额核对率</span>
                <strong>{percent(totals.reconciliationAmountPercent)}</strong>
              </div>
              <ProgressBar value={totals.reconciliationAmountPercent} tone="green" />
            </div>
            <div>
              <div>
                <span>账单完成率</span>
                <strong>{percent(totals.reconciliationRowPercent)}</strong>
              </div>
              <ProgressBar value={totals.reconciliationRowPercent} tone="slate" />
            </div>
            <div>
              <div>
                <span>付款覆盖率</span>
                <strong>{percent(totals.paymentAmountPercent)}</strong>
              </div>
              <ProgressBar value={totals.paymentAmountPercent} tone="violet" />
            </div>
          </div>

          <div className="channel-progress-issues">
            <div className="channel-progress-issues-head">
              <div>
                <h3>待处理账单</h3>
                <span>按结算金额从高到低排列</span>
              </div>
              <strong>{money(totals.unresolvedAmount)}</strong>
            </div>
            <div className="channel-progress-table-wrap">
              <table className="channel-progress-table rd-progress-table">
                <thead>
                  <tr>
                    <th>账期</th>
                    <th>编号</th>
                    <th>客户</th>
                    <th>产品</th>
                    <th>结算金额</th>
                    <th>进度</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.unresolved.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="channel-progress-empty">当前范围内账单已全部核对</td>
                    </tr>
                  ) : (
                    snapshot.unresolved.map((row) => (
                      <tr key={row.id}>
                        <td>{monthLabel(row.month)}</td>
                        <td>{row.billNumber}</td>
                        <td title={row.partner}><strong>{row.partner}</strong></td>
                        <td title={row.product}>{row.product}</td>
                        <td className="is-number">{money(row.settlementAmount)}</td>
                        <td><span className="channel-progress-pending">{row.reason}</span></td>
                        <td>
                          <button
                            type="button"
                            className="rd-progress-edit"
                            onClick={() => onEdit?.(row.id)}
                          >
                            编辑
                          </button>
                        </td>
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

export default RdReconciliationProgressPanel
