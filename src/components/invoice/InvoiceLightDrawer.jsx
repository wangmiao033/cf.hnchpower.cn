import React, { useEffect, useState } from 'react'
import { deleteInvoicePaymentLink } from '@/lib/api/invoicePaymentLink.ts'
import { getInvoiceRecordId } from '@/lib/api/invoice.ts'
import InvoiceBillAllocationPanel from '@/components/invoice/InvoiceBillAllocationPanel.jsx'

const INVOICE_STATUSES = ['未开', '已开', '作废']

function InvoiceLightDrawer({
  open,
  record,
  onClose,
  onUpdateRecord,
  onNavigateToFullEdit,
  onOpenVerification,
  linkedPaymentRows = [],
  onLinksChanged,
  onRequestManualLinkToPayment,
  onAllocationsChanged,
  onOpenBill,
  showToast
}) {
  const [remark, setRemark] = useState('')
  const [status, setStatus] = useState('未开')

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (record) {
      setRemark(record.remark != null ? String(record.remark) : '')
      setStatus(record.status || '未开')
    } else {
      setRemark('')
      setStatus('未开')
    }
  }, [record, open])

  if (!open || !record) return null

  const recordId = getInvoiceRecordId(record)
  const direction = record.invoiceDirection === 'input' ? 'input' : 'output'
  const invoiceNumber = record.digitalInvoiceNo || record.invoiceNo || record.invoiceCode || '未填写发票号码'
  const counterpartyName = direction === 'input'
    ? record.sellerName || record.title
    : record.buyerName || record.title
  const counterpartyTaxNo = direction === 'input'
    ? record.sellerTaxNo || record.taxNo
    : record.buyerTaxNo || record.taxNo
  const grossAmount = parseFloat(
    record.amountWithTax || parseFloat(record.amount || 0) + parseFloat(record.taxAmount || 0)
  ) || 0

  const saveRemark = () => {
    const next = remark.trim()
    if ((record.remark || '') === next) return
    void onUpdateRecord?.(recordId, { ...record, remark: next })
  }

  const applyStatus = (nextStatus) => {
    setStatus(nextStatus)
    if ((record.status || '') === nextStatus) return
    void onUpdateRecord?.(recordId, { ...record, status: nextStatus })
  }

  return (
    <>
      <button type="button" className="rec-drawer-backdrop" aria-label="关闭" onClick={onClose} />
      <aside
        className="rec-drawer rec-drawer--light rec-drawer--wide invoice-link-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invoice-light-drawer-title"
      >
        <div className="rec-drawer__head">
          <h2 id="invoice-light-drawer-title" className="rec-drawer__title">
            发票详情与账单关联
          </h2>
          <button type="button" className="rec-drawer__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="rec-drawer__body rec-drawer__body--light">
          <section className="invoice-drawer-hero">
            <div>
              <span className={`invoice-drawer-hero__direction is-${direction}`}>
                {direction === 'input' ? '进项发票' : '销项发票'}
              </span>
              <h3>{invoiceNumber}</h3>
              <p>{counterpartyName || '未填写往来单位'}</p>
            </div>
            <strong>¥{grossAmount.toFixed(2)}</strong>
          </section>

          <dl className="rec-light-dl">
            <dt>往来单位</dt>
            <dd>{counterpartyName || '—'}</dd>
            <dt>纳税人识别号</dt>
            <dd>{counterpartyTaxNo || '—'}</dd>
            <dt>金额 / 税额</dt>
            <dd>¥{parseFloat(record.amount || 0).toFixed(2)} / ¥{parseFloat(record.taxAmount || 0).toFixed(2)}</dd>
            <dt>开票日期</dt>
            <dd>{record.issueDate || '—'}</dd>
            {onRequestManualLinkToPayment || linkedPaymentRows.length ? (
              <>
                <dt>关联回款</dt>
                <dd>
                  {linkedPaymentRows.length === 0 ? (
                    '未关联'
                  ) : (
                    <ul className="rec-light-link-list">
                      {linkedPaymentRows.map((row) => (
                        <li key={row.linkId}>
                          <span title={row.paymentId}>{row.label}</span>
                          <button
                            type="button"
                            className="rec-btn rec-btn--ghost rec-btn--xs"
                            onClick={() =>
                              void (async () => {
                                try {
                                  await deleteInvoicePaymentLink(row.linkId)
                                  await onLinksChanged?.()
                                } catch (e) {
                                  console.error(e)
                                }
                              })()
                            }
                          >
                            取消关联
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </>
            ) : null}
          </dl>

          <section className="invoice-drawer-section">
            <div className="invoice-drawer-section__head">
              <div>
                <span>金额分配</span>
                <h3>关联账单</h3>
              </div>
              <p>{direction === 'input' ? '进项发票匹配研发账单' : '销项发票匹配渠道账单'}</p>
            </div>
            <InvoiceBillAllocationPanel
              invoiceId={recordId}
              onChanged={onAllocationsChanged}
              onOpenBill={onOpenBill}
              showToast={showToast}
            />
          </section>

          {onRequestManualLinkToPayment ? (
            <div className="rec-light-field">
              <button
                type="button"
                className="rec-btn rec-btn--secondary"
                onClick={() => onRequestManualLinkToPayment(recordId)}
              >
                关联回款…
              </button>
            </div>
          ) : null}

          <div className="invoice-drawer-section invoice-drawer-section--settings">
          <div className="invoice-drawer-section__head">
            <div>
              <span>台账维护</span>
              <h3>状态与备注</h3>
            </div>
          </div>
          <div className="rec-light-field">
            <label className="rec-light-field__label" htmlFor="invoice-light-status">
              状态
            </label>
            <select
              id="invoice-light-status"
              className="admin-input"
              value={status}
              onChange={(e) => applyStatus(e.target.value)}
            >
              {INVOICE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="rec-light-field">
            <label className="rec-light-field__label" htmlFor="invoice-light-remark">
              备注
            </label>
            <textarea
              id="invoice-light-remark"
              className="admin-input rec-light-memo"
              rows={3}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              onBlur={saveRemark}
              placeholder="备注"
            />
          </div>
          </div>
        </div>
        <style>{`
          .rec-light-link-list { margin: 0; padding-left: 18px; list-style: disc; }
          .rec-light-link-list li { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
          .rec-btn--xs { min-height: 26px; padding: 2px 8px; font-size: var(--font-size-caption); font-weight: var(--font-weight-button); }
        `}</style>

        <div className="rec-drawer__footer rec-drawer__footer--light">
          <button type="button" className="rec-btn rec-btn--ghost" onClick={onClose}>
            关闭
          </button>
          {onOpenVerification ? (
            <button
              type="button"
              className="rec-btn rec-btn--secondary"
              onClick={() => {
                onOpenVerification(record)
                onClose()
              }}
            >
              去核销
            </button>
          ) : null}
          <button
            type="button"
            className="rec-btn rec-btn--primary"
            onClick={() => {
              onNavigateToFullEdit?.(recordId)
              onClose()
            }}
          >
            完整编辑
          </button>
        </div>
      </aside>
    </>
  )
}

export default InvoiceLightDrawer
