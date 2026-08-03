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
  pendingBills: '\u5f85\u5904\u7406\u8d26\u5355',
  pendingNote: '\u53ea\u5c55\u793a\u5f53\u524d\u6e20\u9053\u8d26\u5355\u4e2d\u5c1a\u672a\u6838\u5bf9\u7684\u8bb0\u5f55',
  period: '\u8d26\u671f',
  number: '\u7f16\u53f7',
  channel: '\u6e20\u9053',
  partner: '\u5408\u4f5c\u65b9',
  product: '\u4ea7\u54c1',
  settlement: '\u7ed3\u7b97\u91d1\u989d',
  status: '\u72b6\u6001',
  action: '\u64cd\u4f5c',
  pendingReconcile: '\u5f85\u6838\u5bf9',
  start: '\u5f00\u59cb\u6838\u5bf9',
  empty: '\u5f53\u524d\u8d26\u671f\u6ca1\u6709\u5f85\u5904\u7406\u6e20\u9053\u8d26\u5355',
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

function ProgressBar({ label, value, tone = '' }) {
  return (
    <div className={`channel-progress-bar ${tone}`.trim()}>
      <div><span>{label}</span><strong>{percent(value)}</strong></div>
      <div className="channel-progress-track"><i style={{ width: `${Math.max(0, Math.min(100, numberValue(value)))}%` }} /></div>
    </div>
  )
}

export default function ChannelBillProgressPanel({ snapshot, onEditBill }) {
  const totals = snapshot?.totals || {}
  const unresolved = snapshot?.unresolved || []

  return (
    <section className="channel-progress-panel">
      <div className="channel-progress-head">
        <div>
          <span className="channel-progress-period">{monthLabel(snapshot?.month)}</span>
          <strong>{T.title}</strong>
          <span className="channel-progress-badge">{T.scope}</span>
          <p>{T.note}</p>
        </div>
      </div>

      <div className="channel-progress-overview">
        <div className="channel-progress-primary">
          <span>{T.reconciledBills}</span>
          <strong>{percent(totals.amountPercent)}</strong>
          <div className="channel-progress-track"><i style={{ width: `${Math.max(0, Math.min(100, numberValue(totals.amountPercent)))}%` }} /></div>
          <p>{money(totals.reconciledAmount)} / {money(totals.settlementAmount)}</p>
        </div>
        <div className="channel-progress-stage is-blue"><span>{T.channelBills}</span><strong>{totals.rows || 0} {T.billUnit}</strong><p>{money(totals.settlementAmount)}</p></div>
        <div className="channel-progress-stage is-green"><span>{T.reconciled}</span><strong>{totals.reconciledRows || 0} {T.billUnit}</strong><p>{money(totals.reconciledAmount)}</p></div>
        <div className="channel-progress-stage is-purple"><span>{T.receivable}</span><strong>{totals.receivableRows || 0} {T.billUnit}</strong><p>{money(totals.receivedAmount)}</p></div>
        <div className="channel-progress-stage is-orange"><span>{T.pending}</span><strong>{totals.unresolvedRows || 0} {T.billUnit}</strong><p>{money(totals.unresolvedAmount)}</p></div>
      </div>

      <div className="channel-progress-bars">
        <ProgressBar label={T.amountRate} value={totals.amountPercent} tone="is-green" />
        <ProgressBar label={T.billRate} value={totals.rowPercent} tone="is-slate" />
        <ProgressBar label={T.receiptRate} value={totals.receiptPercent} tone="is-purple" />
      </div>

      <div className="channel-progress-issues">
        <div className="channel-progress-issues-head">
          <div><strong>{T.pendingBills}</strong><span>{T.pendingNote}</span></div>
          <strong>{money(totals.unresolvedAmount)}</strong>
        </div>
        <div className="channel-progress-table-wrap">
          <table className="channel-progress-table">
            <thead><tr><th>{T.period}</th><th>{T.number}</th><th>{T.channel}</th><th>{T.partner}</th><th>{T.product}</th><th>{T.settlement}</th><th>{T.status}</th><th>{T.action}</th></tr></thead>
            <tbody>
              {unresolved.map((row) => (
                <tr key={row.id || row.billNumber}>
                  <td>{monthLabel(row.month)}</td><td>{row.billNumber}</td><td>{row.channel}</td><td>{row.partner}</td><td>{row.product}</td>
                  <td>{money(row.settlementAmount)}</td><td><span className="channel-progress-status">{T.pendingReconcile}</span></td>
                  <td><button type="button" onClick={() => onEditBill?.(row.id)}>{T.start}</button></td>
                </tr>
              ))}
              {!unresolved.length && <tr><td colSpan="8" className="channel-progress-empty">{T.empty}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
