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
  onViewAttachments,
  onViewInvoices,
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
      <div className="channel-progress-head">
        <div>
          <div className="channel-progress-heading-line">
            <span className="channel-progress-period">{period}</span>
            <h2>{period}对账概览</h2>
            <span className="channel-progress-local-state rd-progress-live-state">实时数据</span>
          </div>
          <p>金额和百分比固定按所选月份统计，搜索仅筛选下方待处理明细</p>
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
              <span>{period}对账进度</span>
              <strong>{percent(totals.reconciliationAmountPercent)}</strong>
              <ProgressBar value={totals.reconciliationAmountPercent} />
              <p>
                {money(totals.reconciledAmount)}
                <span> / {money(totals.settlementAmount)}</span>
              </p>
              <small>{totals.reconciledRows} / {totals.rows} 笔账单已核对</small>
            </div>
            <div className="rd-month-metrics">
              <article className="is-total">
                <span>{period}对账金额</span>
                <strong>{money(totals.settlementAmount)}</strong>
                <small>{totals.rows} 笔账单</small>
              </article>
              <article className="is-reconciled">
                <span>已核对金额</span>
                <strong>{money(totals.reconciledAmount)}</strong>
                <small>{totals.reconciledRows} 笔已核对</small>
              </article>
              <article className="is-pending">
                <span>待核对金额</span>
                <strong>{money(totals.unresolvedAmount)}</strong>
                <small>{totals.unresolvedRows} 笔待处理</small>
              </article>
              <article className="is-settled">
                <span>已结算金额</span>
                <strong>{money(totals.settledAmount)}</strong>
                <small>{totals.settledRows} 笔已结算</small>
              </article>
            </div>
          </div>

          <div className="rd-month-status">
            <div>
              <span>流水覆盖</span>
              <strong>{totals.flowRows} / {totals.rows} 笔</strong>
              <small>{money(totals.flowAmount)}</small>
            </div>
            <div>
              <span>账单完成率</span>
              <strong>{percent(totals.reconciliationRowPercent)}</strong>
              <small>按账单数量计算</small>
            </div>
            <div>
              <span>付款覆盖率</span>
              <strong>{percent(totals.paymentAmountPercent)}</strong>
              <small>{money(totals.paidAmount)} 已登记</small>
            </div>
          </div>

          <div className="channel-progress-issues">
            <div className="channel-progress-issues-head">
              <div>
                <h3>{period}账单明细</h3>
                <span>{rows.length} 笔显示 · 已完成和待处理账单均可查看附件</span>
              </div>
              <strong>{money(visibleUnresolvedAmount)}</strong>
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
                    rows.map((row) => (
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
                          <button
                            type="button"
                            className="rd-progress-edit"
                            onClick={() => onEdit?.(row.id)}
                          >
                            编辑
                          </button>
                          {row.billId && (
                            <>
                              <button
                                type="button"
                                className="rd-progress-edit rd-progress-attachment"
                                onClick={() => onViewAttachments?.(row)}
                              >
                                附件
                              </button>
                              <button
                                type="button"
                                className="rd-progress-edit rd-progress-attachment"
                                onClick={() => onViewInvoices?.(row)}
                              >
                                发票 {Number(invoiceSummaries[`rd:${row.billId}`]?.coverage_percent || 0).toFixed(0)}%
                              </button>
                            </>
                          )}
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
