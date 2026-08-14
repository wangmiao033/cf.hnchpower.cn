import React from 'react'
import './RdReconciliationProgressTable.css'

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
  return match ? `${match[1]}年${Number(match[2])}月` : value || '全部月份'
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
  onEdit,
  onOpen360,
  invoiceSummaries = {}
}) {
  const totals = snapshot.totals
  const period = monthLabel(snapshot.month)
  const rows = snapshot.rows || snapshot.unresolved
  const visibleUnresolvedAmount = snapshot.unresolved.reduce(
    (sum, record) => sum + Number(record.settlementAmount || 0),
    0
  )

  return (
    <section className="channel-progress-panel rd-progress-panel">
      <div className="channel-progress-head rd-progress-panel-head">
        <div className="channel-progress-heading-line">
          <h2>对账概览</h2>
          <span className="channel-progress-period">{period}</span>
          <span className="channel-progress-local-state rd-progress-live-state">实时</span>
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
          <div className="rd-month-summary">
            <div className="rd-month-progress">
              <div className="rd-month-progress-label">
                <span>对账进度</span>
                <small>{totals.reconciledRows} / {totals.rows} 笔</small>
              </div>
              <strong>{percent(totals.reconciliationAmountPercent)}</strong>
              <ProgressBar value={totals.reconciliationAmountPercent} />
              <p>
                {money(totals.reconciledAmount)}
                <span> / {money(totals.settlementAmount)}</span>
              </p>
            </div>
            <div className="rd-month-metrics">
              <article className="is-total">
                <span>对账金额</span>
                <strong>{money(totals.settlementAmount)}</strong>
              </article>
              <article className="is-reconciled">
                <span>已核对</span>
                <strong>{money(totals.reconciledAmount)}</strong>
              </article>
              <article className="is-pending">
                <span>待核对</span>
                <strong>{money(totals.unresolvedAmount)}</strong>
              </article>
              <article className="is-settled">
                <span>已结算</span>
                <strong>{money(totals.settledAmount)}</strong>
              </article>
            </div>
          </div>

          <div className="rd-month-status">
            <div title={`${money(totals.flowAmount)} 流水金额`}>
              <span>流水覆盖</span>
              <strong>{totals.flowRows} / {totals.rows}</strong>
            </div>
            <div title="按账单数量计算">
              <span>账单完成</span>
              <strong>{percent(totals.reconciliationRowPercent)}</strong>
            </div>
            <div title={`${money(totals.paidAmount)} 已登记`}>
              <span>付款覆盖</span>
              <strong>{percent(totals.paymentAmountPercent)}</strong>
            </div>
          </div>

          <div className="channel-progress-issues">
            <div className="channel-progress-issues-head">
              <div>
                <h3>账单明细</h3>
                <span>{rows.length} 笔</span>
              </div>
              <strong>待核对 {money(visibleUnresolvedAmount)}</strong>
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
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="channel-progress-empty">当前范围内没有研发账单</td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const coverage = Number(invoiceSummaries[`rd:${row.billId}`]?.coverage_percent || 0)
                      return (
                        <tr key={row.id}>
                          <td>{monthLabel(row.month)}</td>
                          <td>{row.billNumber}</td>
                          <td title={row.partner}><strong>{row.partner}</strong></td>
                          <td title={row.product}>{row.product}</td>
                          <td className="is-number">{money(row.settlementAmount)}</td>
                          <td>
                            <span className={row.reconciled ? 'channel-progress-complete' : 'channel-progress-pending'}>
                              {row.reconciled ? '已核对' : row.reason}
                            </span>
                          </td>
                          <td>
                            <div className="channel-progress-row-actions">
                              {row.billId ? (
                                <button
                                  type="button"
                                  className="rd-progress-edit"
                                  onClick={() => onOpen360?.(row)}
                                  title="发票、资金、合同、附件和操作日志统一在账单360°查看"
                                >
                                  360° · 发票 {coverage.toFixed(0)}%
                                </button>
                              ) : null}
                              {!row.reconciled ? (
                                <button
                                  type="button"
                                  className="rd-progress-edit rd-progress-attachment"
                                  onClick={() => onEdit?.(row.id)}
                                >
                                  开始核对
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )
                    })
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
