import React from 'react'

const T = {
  allPeriods: '\u5168\u90e8\u8d26\u671f',
  title: '\u6e20\u9053\u5bf9\u8d26\u8fdb\u5ea6',
  scope: '\u8d26\u5355\u53e3\u5f84',
  note: '\u4ec5\u7edf\u8ba1\u6e20\u9053\u8d26\u5355\uff0c\u4e0d\u8bfb\u53d6\u65e7\u6e20\u9053\u6d41\u6c34\u9884\u89c8',
  reconciledBills: '\u8d26\u5355\u5df2\u6838\u5bf9',
  channelBills: '\u6e20\u9053\u8d26\u5355',
  billUnit: '\u7b14',
  reconciled: '\u5df2\u6838\u5bf9',
  receivable: '\u5df2\u767b\u8bb0\u5e94\u6536',
  pending: '\u5f85\u5904\u7406',
  amountRate: '\u91d1\u989d\u6838\u5bf9\u7387',
  billRate: '\u8d26\u5355\u5b8c\u6210\u7387',
  receiptRate: '\u6536\u6b3e\u8986\u76d6\u7387',
  pendingBills: '\u8d26\u5355\u660e\u7ec6',
  pendingNote: '\u5df2\u5b8c\u6210\u548c\u5f85\u5904\u7406\u8d26\u5355\u5747\u53ef\u67e5\u770b\u9644\u4ef6',
  period: '\u8d26\u671f',
  number: '\u7f16\u53f7',
  channel: '\u6e20\u9053',
  partner: '\u5408\u4f5c\u65b9',
  product: '\u4ea7\u54c1',
  settlement: '\u7ed3\u7b97\u91d1\u989d',
  status: '\u72b6\u6001',
  action: '\u64cd\u4f5c',
  pendingReconcile: '\u5f85\u6838\u5bf9',
  completed: '\u5df2\u6838\u5bf9',
  start: '\u5f00\u59cb\u6838\u5bf9',
  view: '\u67e5\u770b\u8d26\u5355',
  empty: '\u5f53\u524d\u8d26\u671f\u6ca1\u6709\u6e20\u9053\u8d26\u5355',
}

function numberValue(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function money(value) {
  return `\u00a5 ${numberValue(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function percent(value) {
  return `${numberValue(value).toFixed(1)}%`
}

function monthLabel(value) {
  if (!value) return T.allPeriods
  const match = String(value).match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}\u5e74${Number(match[2])}\u6708` : value
}

function ProgressMetric({ label, value, tone = '' }) {
  return (
    <div>
      <div><span>{label}</span><strong>{percent(value)}</strong></div>
      <div className={`channel-progress-bar ${tone}`.trim()}>
        <span style={{ width: `${Math.max(0, Math.min(100, numberValue(value)))}%` }} />
      </div>
    </div>
  )
}

export default function ChannelBillProgressPanel({ snapshot, onEditBill, onViewAttachments, onViewInvoices, invoiceSummaries = {} }) {
  const totals = snapshot?.totals || {}
  const rows = snapshot?.rows || snapshot?.unresolved || []

  return (
    <section className="channel-progress-panel">
      <div className="channel-progress-head">
        <div>
          <div className="channel-progress-heading-line">
            <span className="channel-progress-period">{monthLabel(snapshot?.month)}</span>
            <h2>{T.title}</h2>
            <span className="channel-progress-local-state">{T.scope}</span>
          </div>
          <p>{T.note}</p>
        </div>
      </div>

      <div className="channel-progress-body">
        <div className="channel-progress-overview">
          <div className="channel-progress-primary">
            <span>{T.reconciledBills}</span>
            <strong>{percent(totals.amountPercent)}</strong>
            <div className="channel-progress-bar">
              <span style={{ width: `${Math.max(0, Math.min(100, numberValue(totals.amountPercent)))}%` }} />
            </div>
            <p>{money(totals.reconciledAmount)} <span>/ {money(totals.settlementAmount)}</span></p>
          </div>
          <div className="channel-progress-stages">
            <div><span>{T.channelBills}</span><strong>{totals.rows || 0} {T.billUnit}</strong><small>{money(totals.settlementAmount)}</small></div>
            <div className="is-complete"><span>{T.reconciled}</span><strong>{totals.reconciledRows || 0} {T.billUnit}</strong><small>{money(totals.reconciledAmount)}</small></div>
            <div className="is-receivable"><span>{T.receivable}</span><strong>{totals.receivableRows || 0} {T.billUnit}</strong><small>{money(totals.receivedAmount)}</small></div>
            <div className="is-warning"><span>{T.pending}</span><strong>{totals.unresolvedRows || 0} {T.billUnit}</strong><small>{money(totals.unresolvedAmount)}</small></div>
          </div>
        </div>

        <div className="channel-progress-secondary">
          <ProgressMetric label={T.amountRate} value={totals.amountPercent} tone="channel-progress-bar--green" />
          <ProgressMetric label={T.billRate} value={totals.rowPercent} tone="channel-progress-bar--slate" />
          <ProgressMetric label={T.receiptRate} value={totals.receiptPercent} tone="channel-progress-bar--violet" />
        </div>

        <div className="channel-progress-issues">
          <div className="channel-progress-issues-head">
            <div><h3>{T.pendingBills}</h3><span>{T.pendingNote}</span></div>
            <strong>{money(totals.unresolvedAmount)}</strong>
          </div>
          <div className="channel-progress-table-wrap">
            <table className="channel-progress-table">
              <thead><tr><th>{T.period}</th><th>{T.number}</th><th>{T.channel}</th><th>{T.partner}</th><th>{T.product}</th><th>{T.settlement}</th><th>{T.status}</th><th>{T.action}</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id || row.billNumber}>
                    <td>{monthLabel(row.month)}</td>
                    <td title={row.billNumber}>{row.billNumber}</td>
                    <td title={row.channel}>{row.channel}</td>
                    <td title={row.partner}>{row.partner}</td>
                    <td title={row.product}>{row.product}</td>
                    <td>{money(row.settlementAmount)}</td>
                    <td>
                      <span className={row.reconciled ? 'channel-progress-complete' : 'channel-progress-status'}>
                        {row.reconciled ? T.completed : T.pendingReconcile}
                      </span>
                    </td>
                    <td>
                      <div className="channel-progress-row-actions">
                        <button type="button" onClick={() => onEditBill?.(row.id)}>
                          {row.reconciled ? T.view : T.start}
                        </button>
                        {row.id && (
                          <>
                            <button type="button" onClick={() => onViewAttachments?.(row)}>附件</button>
                            <button type="button" onClick={() => onViewInvoices?.(row)}>
                              发票 {Number(invoiceSummaries[`channel:${row.id}`]?.coverage_percent || 0).toFixed(0)}%
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan="8" className="channel-progress-empty">{T.empty}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}
