import React, { useEffect, useMemo, useState } from 'react'
import AdminWorkspace from '@/components/admin/AdminWorkspace.jsx'
import AdminFilterBar from '@/components/admin/AdminFilterBar.jsx'
import AdminStatsRow from '@/components/admin/AdminStatsRow.jsx'
import AdminTableCard from '@/components/admin/AdminTableCard.jsx'
import { getInvoiceRecordId } from '@/lib/api/invoice.ts'
import { listInvoiceAllocationOverviews } from '@/lib/api/billInvoiceAllocations.ts'
import './invoice-archive-ui.css'

function invoiceGross(item) {
  return parseFloat(
    item.amountWithTax || parseFloat(item.amount || 0) + parseFloat(item.taxAmount || 0)
  ) || 0
}

function invoiceNumber(item) {
  return item.digitalInvoiceNo || [item.invoiceCode, item.invoiceNo].filter(Boolean).join(' / ') || '未填写号码'
}

function counterparty(item, direction) {
  return direction === 'input' ? item.sellerName : item.buyerName || item.title
}

export default function InvoiceArchiveWorkspace({
  invoices = [],
  direction = 'output',
  archiveItems = [],
  archiveBusyId = '',
  readOnly = false,
  onUnarchive
}) {
  const [keyword, setKeyword] = useState('')
  const [expandedId, setExpandedId] = useState('')
  const [overviews, setOverviews] = useState({})

  const archiveById = useMemo(
    () => Object.fromEntries((archiveItems || []).map((item) => [String(item.invoice_id), item])),
    [archiveItems]
  )

  const visible = useMemo(() => {
    const key = keyword.trim().toLowerCase()
    if (!key) return invoices
    return invoices.filter((item) => {
      const text = [
        invoiceNumber(item),
        counterparty(item, direction),
        item.buyerTaxNo,
        item.sellerTaxNo,
        item.taxNo,
        item.remark
      ].join(' ').toLowerCase()
      return text.includes(key)
    })
  }, [direction, invoices, keyword])

  useEffect(() => {
    let cancelled = false
    const ids = visible.map((item) => getInvoiceRecordId(item)).filter(Boolean).slice(0, 500)
    if (!ids.length) {
      setOverviews({})
      return undefined
    }
    void listInvoiceAllocationOverviews(ids)
      .then((items) => {
        if (cancelled) return
        setOverviews(Object.fromEntries(items.map((item) => [String(item.invoice_id), item])))
      })
      .catch(() => {
        if (!cancelled) setOverviews({})
      })
    return () => {
      cancelled = true
    }
  }, [visible])

  const totals = useMemo(() => visible.reduce(
    (acc, item) => {
      const id = getInvoiceRecordId(item)
      const overview = overviews[id]
      return {
        gross: acc.gross + invoiceGross(item),
        allocated: acc.allocated + Number(overview?.allocated_amount || 0)
      }
    },
    { gross: 0, allocated: 0 }
  ), [overviews, visible])

  return (
    <AdminWorkspace className="invoice-archive-workspace">
      <AdminFilterBar>
        <div className="invoice-archive-filter">
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索往来单位 / 发票号 / 税号"
            aria-label="搜索已归档发票"
          />
          <span>{readOnly ? '已归档发票为只读历史记录。' : '已归档发票为只读历史记录，需要调整时请先取消归档。'}</span>
        </div>
      </AdminFilterBar>

      <AdminStatsRow>
        <div className="invoice-archive-stats">
          <article><span>已归档</span><strong>{visible.length}</strong><small>张发票</small></article>
          <article><span>价税合计</span><strong>¥{totals.gross.toFixed(2)}</strong><small>当前筛选</small></article>
          <article><span>已关联账单</span><strong>¥{totals.allocated.toFixed(2)}</strong><small>归档时应完整覆盖</small></article>
        </div>
      </AdminStatsRow>

      <AdminTableCard className="invoice-archive-card">
        <div className="invoice-archive-table">
          <div className="invoice-archive-head">
            <span>发票信息</span>
            <span>{direction === 'input' ? '销售方' : '购买方'}</span>
            <span>价税合计</span>
            <span>开票日期</span>
            <span>账单关联</span>
            <span>归档时间</span>
            <span>操作</span>
          </div>
          {visible.length === 0 ? (
            <div className="invoice-archive-empty">暂无已归档发票</div>
          ) : visible.map((item) => {
            const id = getInvoiceRecordId(item)
            const overview = overviews[id]
            const archive = archiveById[id]
            const isExpanded = expandedId === id
            return (
              <React.Fragment key={id}>
                <div className="invoice-archive-row">
                  <span className="invoice-archive-invoice">
                    <button type="button" onClick={() => setExpandedId(isExpanded ? '' : id)}>{invoiceNumber(item)}</button>
                    <small>{item.invoiceType || '未填写票种'}</small>
                  </span>
                  <span className="invoice-archive-party" title={counterparty(item, direction) || ''}>{counterparty(item, direction) || '未填写往来单位'}</span>
                  <strong>¥{invoiceGross(item).toFixed(2)}</strong>
                  <span>{item.issueDate || '—'}</span>
                  <span className="invoice-archive-allocation">
                    <b>{overview?.coverage_status === 'complete' ? '已完整关联' : '历史关联'}</b>
                    <small>¥{Number(overview?.allocated_amount || 0).toFixed(2)} / ¥{Number(overview?.invoice_amount || invoiceGross(item)).toFixed(2)}</small>
                  </span>
                  <span>{archive?.archived_at ? String(archive.archived_at).replace('T', ' ').slice(0, 16) : '—'}</span>
                  <span className="invoice-archive-actions">
                    <button type="button" className="rec-btn rec-btn--ghost" onClick={() => setExpandedId(isExpanded ? '' : id)}>{isExpanded ? '收起' : '详情'}</button>
                    {!readOnly ? (
                      <button
                        type="button"
                        className="rec-btn rec-btn--secondary"
                        disabled={archiveBusyId === id}
                        onClick={() => onUnarchive?.(id)}
                      >
                        {archiveBusyId === id ? '处理中…' : '取消归档'}
                      </button>
                    ) : null}
                  </span>
                </div>
                {isExpanded ? (
                  <div className="invoice-archive-detail">
                    <div><span>不含税金额</span><strong>¥{parseFloat(item.amount || 0).toFixed(2)}</strong></div>
                    <div><span>税额</span><strong>¥{parseFloat(item.taxAmount || 0).toFixed(2)}</strong></div>
                    <div><span>税务状态</span><strong>{item.taxStatus || 'normal'}</strong></div>
                    <div><span>发票来源</span><strong>{item.invoiceSource || '—'}</strong></div>
                    <div><span>归档方式</span><strong>{archive?.archive_source === 'auto' ? '系统自动归档' : '人工归档'}</strong></div>
                    <div className="is-wide"><span>备注</span><strong>{item.remark || '—'}</strong></div>
                  </div>
                ) : null}
              </React.Fragment>
            )
          })}
        </div>
      </AdminTableCard>
    </AdminWorkspace>
  )
}
