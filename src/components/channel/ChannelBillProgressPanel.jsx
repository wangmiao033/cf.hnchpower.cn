import React from 'react'

const T = {
  allPeriods: '全部账期',
  billUnit: '笔',
  completed: '已核对',
  pendingReconcile: '待核对',
  start: '开始核对',
  view: '查看账单',
  empty: '当前账期没有渠道账单'
}

function numberValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function money(value) {
  return `¥ ${numberValue(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function percent(value) {
  return `${numberValue(value).toFixed(1)}%`
}

function monthLabel(value) {
  if (!value) return T.allPeriods
  const match = String(value).match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : value
}

function ProgressBar({ value }) {
  const width = Math.max(0, Math.min(100, numberValue(value)))
  return (
    <div
      className="channel-progress-bar"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(width)}
    >
      <span style={{ width: `${width}%` }} />
    </div>
  )
}

function invoiceTaskLabel(task, coverage) {
  if (coverage >= 99.95) return { label: '已开票', disabled: true, tone: 'done' }
  if (!task) return { label: '提交开票', disabled: false, tone: 'submit' }
  if (task.status === 'pending') return { label: '待财务开票', disabled: true, tone: 'pending' }
  if (task.status === 'processing') return { label: '财务处理中', disabled: true, tone: 'processing' }
  if (task.status === 'rejected') return { label: '重新提交开票', disabled: false, tone: 'rejected' }
  if (task.status === 'completed') return { label: coverage >= 99.95 ? '已开票' : '继续提交开票', disabled: coverage >= 99.95, tone: coverage >= 99.95 ? 'done' : 'submit' }
  return { label: '提交开票', disabled: false, tone: 'submit' }
}

export default function ChannelBillProgressPanel({
  snapshot,
  onEditBill,
  onViewAttachments,
  onViewInvoices,
  onSubmitInvoiceRequest,
  invoiceSummaries = {},
  invoiceTaskStatuses = {},
  canSubmitInvoiceRequest = false,
  invoiceTaskBusyId = ''
}) {
  const totals = snapshot?.totals || {}
  const rows = snapshot?.rows || snapshot?.unresolved || []
  const period = monthLabel(snapshot?.month)

  return (
    <section className="channel-progress-panel rd-progress-panel channel-progress-panel--unified">
      <div className="channel-progress-head rd-progress-panel-head">
        <div className="channel-progress-heading-line">
          <h2>对账概览</h2>
          <span className="channel-progress-period">{period}</span>
          <span className="channel-progress-local-state">渠道账单</span>
        </div>
      </div>

      <div className="channel-progress-body">
        <div className="rd-month-summary channel-month-summary">
          <div className="rd-month-progress">
            <div className="rd-month-progress-label">
              <span>账单核对</span>
              <small>{totals.reconciledRows || 0} / {totals.rows || 0} {T.billUnit}</small>
            </div>
            <strong>{percent(totals.amountPercent)}</strong>
            <ProgressBar value={totals.amountPercent} />
            <p>
              {money(totals.reconciledAmount)}
              <span> / {money(totals.settlementAmount)}</span>
            </p>
          </div>

          <div className="rd-month-metrics">
            <article className="is-total"><span>对账金额</span><strong>{money(totals.settlementAmount)}</strong></article>
            <article className="is-reconciled"><span>已核对</span><strong>{money(totals.reconciledAmount)}</strong></article>
            <article className="is-settled"><span>已登记应收</span><strong>{money(totals.receivedAmount)}</strong></article>
            <article className="is-pending"><span>待处理</span><strong>{money(totals.unresolvedAmount)}</strong></article>
          </div>
        </div>

        <div className="rd-month-status">
          <div title="按结算金额计算"><span>金额核对</span><strong>{percent(totals.amountPercent)}</strong></div>
          <div title="按账单数量计算"><span>账单完成</span><strong>{percent(totals.rowPercent)}</strong></div>
          <div title="按收款登记金额计算"><span>收款覆盖</span><strong>{percent(totals.receiptPercent)}</strong></div>
        </div>

        <div className="channel-progress-issues">
          <div className="channel-progress-issues-head">
            <div><h3>账单明细</h3><span>{rows.length} 笔</span></div>
            <strong>待处理 {money(totals.unresolvedAmount)}</strong>
          </div>

          <div className="channel-progress-table-wrap">
            <table className="channel-progress-table channel-progress-table--unified">
              <thead>
                <tr><th>账期</th><th>编号</th><th>渠道</th><th>合作方</th><th>产品</th><th>结算金额</th><th>状态</th><th>操作</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const invoiceSummary = invoiceSummaries[`channel:${row.id}`]
                  const coverage = Number(invoiceSummary?.coverage_percent || 0)
                  const task = invoiceTaskStatuses[String(row.id)] || null
                  const invoiceAction = invoiceTaskLabel(task, coverage)
                  const submitEnabled = canSubmitInvoiceRequest && row.reconciled && !invoiceAction.disabled
                  return (
                    <tr key={row.id || row.billNumber}>
                      <td>{monthLabel(row.month)}</td>
                      <td title={row.billNumber}>{row.billNumber}</td>
                      <td title={row.channel}>{row.channel}</td>
                      <td title={row.partner}><strong>{row.partner}</strong></td>
                      <td title={row.product}>{row.product}</td>
                      <td className="is-number">{money(row.settlementAmount)}</td>
                      <td>
                        <span className={row.reconciled ? 'channel-progress-complete' : 'channel-progress-pending'}>
                          {row.reconciled ? T.completed : T.pendingReconcile}
                        </span>
                      </td>
                      <td>
                        <div className="channel-progress-row-actions">
                          <button type="button" onClick={() => onEditBill?.(row.id)}>{row.reconciled ? T.view : T.start}</button>
                          {row.id ? (
                            <>
                              {row.reconciled && canSubmitInvoiceRequest ? (
                                <button
                                  type="button"
                                  disabled={!submitEnabled || invoiceTaskBusyId === String(row.id)}
                                  title={task?.status === 'rejected' ? `驳回原因：${task.reject_reason || '未填写'}` : invoiceAction.label}
                                  onClick={() => submitEnabled && onSubmitInvoiceRequest?.(row, task)}
                                >
                                  {invoiceTaskBusyId === String(row.id) ? '提交中…' : invoiceAction.label}
                                </button>
                              ) : null}
                              <button type="button" onClick={() => onViewAttachments?.(row)}>附件</button>
                              <button type="button" onClick={() => onViewInvoices?.(row)}>发票 {coverage.toFixed(0)}%</button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {!rows.length ? <tr><td colSpan="8" className="channel-progress-empty">{T.empty}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}
