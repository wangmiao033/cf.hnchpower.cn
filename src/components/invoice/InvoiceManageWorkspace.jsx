import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import AdminWorkspace from '@/components/admin/AdminWorkspace.jsx'
import AdminFilterBar from '@/components/admin/AdminFilterBar.jsx'
import AdminActionBar from '@/components/admin/AdminActionBar.jsx'
import AdminStatsRow from '@/components/admin/AdminStatsRow.jsx'
import AdminTableCard from '@/components/admin/AdminTableCard.jsx'
import InvoiceLightDrawer from '@/components/invoice/InvoiceLightDrawer.jsx'
import '@/components/reconciliation/reconciliation-admin.css'
import { getInvoiceRecordId } from '@/lib/api/invoice.ts'
import {
  autoMatchInvoices,
  listInvoiceAllocationOverviews
} from '@/lib/api/billInvoiceAllocations.ts'
import { VIEWS } from '@/app/routes.js'
import { consumeInvoiceFocus } from '@/lib/exceptions/navFocus.ts'

/**
 * 发票管理列表工作台（销项/进项共用）
 * @param {'manage' | 'verify'} variant
 * @param {'output' | 'input'} direction
 */
const COVERAGE_TEXT = {
  none: '未关联',
  partial: '部分关联',
  complete: '已关联',
  over: '超额'
}

function invoiceGross(item) {
  return parseFloat(
    item.amountWithTax || parseFloat(item.amount || 0) + parseFloat(item.taxAmount || 0)
  ) || 0
}

function invoiceNumber(item) {
  if (item.digitalInvoiceNo) return item.digitalInvoiceNo
  return [item.invoiceCode, item.invoiceNo].filter(Boolean).join(' / ') || '未填写号码'
}

function normalizePartnerValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s()（）·,，.。\-_/\\]/g, '')
}

function findInvoicePartner(item, direction, partners) {
  const counterpartyName =
    direction === 'input' ? item.sellerName : item.buyerName || item.title
  const counterpartyTaxNo =
    direction === 'input' ? item.sellerTaxNo : item.buyerTaxNo || item.taxNo
  const taxKey = normalizePartnerValue(counterpartyTaxNo)
  const nameKey = normalizePartnerValue(counterpartyName)

  if (taxKey) {
    const taxMatched = partners.find(
      (partner) => normalizePartnerValue(partner.taxRegistrationNo) === taxKey
    )
    if (taxMatched) return taxMatched
  }
  if (!nameKey) return null
  return (
    partners.find((partner) => normalizePartnerValue(partner.name) === nameKey) || null
  )
}

function InvoiceManageWorkspace({ variant = 'manage', direction = 'output' }) {
  const {
    invoice,
    settings,
    setActiveView,
    setActiveViewRaw,
    openInvoiceEdit,
    openReconciliationEdit,
    openChannelReconciliationEdit,
    showToast
  } = useAppState()

  const {
    filteredInvoices,
    invoiceFilter,
    setInvoiceFilter,
    setInvoiceForm,
    invoiceFileInputRef,
    invoiceApiEnabled,
    handleDeleteInvoice,
    handleExportInvoiceCSV,
    handleImportInvoiceFile,
    updateInvoiceRecord
  } = invoice

  const [drawerRecord, setDrawerRecord] = useState(null)
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [allocationOverviews, setAllocationOverviews] = useState({})
  const [allocationLoading, setAllocationLoading] = useState(false)
  const [allocationRevision, setAllocationRevision] = useState(0)
  const [autoMatchBusy, setAutoMatchBusy] = useState(false)
  const [autoMatchPreview, setAutoMatchPreview] = useState(null)
  const [searchKeyword, setSearchKeyword] = useState(
    () => invoiceFilter.companyKeyword || invoiceFilter.numberKeyword || ''
  )
  const [appliedSearch, setAppliedSearch] = useState(
    () => invoiceFilter.companyKeyword || invoiceFilter.numberKeyword || ''
  )

  useEffect(() => {
    consumeInvoiceFocus()
  }, [])

  useEffect(() => {
    if (invoiceFilter.direction === direction) return
    setInvoiceFilter((prev) => ({ ...prev, direction }))
  }, [direction, invoiceFilter.direction, setInvoiceFilter])

  const partners = settings?.partners || []
  const invoicePartnerMap = useMemo(() => {
    const result = new Map()
    filteredInvoices.forEach((item) => {
      const partner = findInvoicePartner(item, direction, partners)
      const recordId = getInvoiceRecordId(item) || item.id
      if (partner && recordId != null) result.set(String(recordId), partner)
    })
    return result
  }, [direction, filteredInvoices, partners])

  const visibleInvoices = useMemo(() => {
    const keyword = normalizePartnerValue(appliedSearch)
    if (!keyword) return filteredInvoices
    return filteredInvoices.filter((item) => {
      const recordId = getInvoiceRecordId(item) || item.id
      const partner = recordId != null ? invoicePartnerMap.get(String(recordId)) : null
      const searchable = [
        direction === 'input' ? item.sellerName : item.title,
        direction === 'input' ? item.sellerTaxNo : item.taxNo,
        invoiceNumber(item),
        partner?.shortName,
        partner?.name,
        partner?.taxRegistrationNo
      ]
      return searchable.some((value) => normalizePartnerValue(value).includes(keyword))
    })
  }, [appliedSearch, direction, filteredInvoices, invoicePartnerMap])

  const visiblePartnerCount = useMemo(
    () =>
      visibleInvoices.reduce((count, item) => {
        const recordId = getInvoiceRecordId(item) || item.id
        return count + (recordId != null && invoicePartnerMap.has(String(recordId)) ? 1 : 0)
      }, 0),
    [invoicePartnerMap, visibleInvoices]
  )

  const invoiceIdsKey = useMemo(
    () => visibleInvoices.map((item) => getInvoiceRecordId(item)).filter(Boolean).join(','),
    [visibleInvoices]
  )

  useEffect(() => {
    let cancelled = false
    if (!invoiceApiEnabled || !invoiceIdsKey) {
      setAllocationOverviews({})
      setAllocationLoading(false)
      return undefined
    }
    setAllocationLoading(true)
    void listInvoiceAllocationOverviews(invoiceIdsKey.split(','))
      .then((items) => {
        if (cancelled) return
        setAllocationOverviews(
          Object.fromEntries(items.map((item) => [String(item.invoice_id), item]))
        )
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) setAllocationOverviews({})
      })
      .finally(() => {
        if (!cancelled) setAllocationLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [allocationRevision, invoiceApiEnabled, invoiceIdsKey])

  useEffect(() => {
    setAutoMatchPreview(null)
  }, [direction, invoiceIdsKey])

  const stats = useMemo(() => {
    return visibleInvoices.reduce(
      (acc, i) => {
        const amount = parseFloat(i.amount || 0) || 0
        const tax = parseFloat(i.taxAmount || 0) || 0
        const amountWithTax = invoiceGross(i)
        const overview = allocationOverviews[getInvoiceRecordId(i)]
        return {
          count: acc.count + 1,
          totalAmount: acc.totalAmount + amount,
          totalTax: acc.totalTax + tax,
          totalAmountWithTax: acc.totalAmountWithTax + amountWithTax,
          allocatedAmount: acc.allocatedAmount + Number(overview?.allocated_amount || 0),
          remainingAmount: acc.remainingAmount + Number(overview?.remaining_amount ?? amountWithTax),
          linkedCount: acc.linkedCount + (overview?.coverage_status === 'complete' ? 1 : 0)
        }
      },
      {
        count: 0,
        totalAmount: 0,
        totalTax: 0,
        totalAmountWithTax: 0,
        allocatedAmount: 0,
        remainingAmount: 0,
        linkedCount: 0
      }
    )
  }, [allocationOverviews, visibleInvoices])

  const totalPages = Math.max(1, Math.ceil(visibleInvoices.length / pageSize))
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages))
  }, [totalPages])
  useEffect(() => {
    setPage(1)
  }, [invoiceFilter, pageSize, direction])

  const pagedInvoices = useMemo(() => {
    const start = (page - 1) * pageSize
    return visibleInvoices.slice(start, start + pageSize)
  }, [visibleInvoices, page, pageSize])

  const wrapImport = (e) => {
    const file = e.target.files?.[0]
    void handleImportInvoiceFile(e)
    if (file?.name?.toLowerCase().endsWith('.pdf')) {
      setActiveViewRaw?.(VIEWS.INVOICE_CREATE)
    }
  }

  const submitFilters = (event) => {
    event.preventDefault()
    setAppliedSearch(searchKeyword.trim())
    setInvoiceFilter({
      direction,
      dateStart: '',
      dateEnd: '',
      status: '全部',
      invoiceType: '',
      companyKeyword: '',
      numberKeyword: ''
    })
  }

  const resetFilters = () => {
    const nextFilter = {
      direction,
      dateStart: '',
      dateEnd: '',
      status: '全部',
      invoiceType: '',
      companyKeyword: '',
      numberKeyword: ''
    }
    setSearchKeyword('')
    setAppliedSearch('')
    setInvoiceFilter(nextFilter)
  }

  const runAutoMatch = async (dryRun) => {
    const invoiceIds = visibleInvoices.map((item) => getInvoiceRecordId(item)).filter(Boolean)
    if (!invoiceApiEnabled || invoiceIds.length === 0) {
      showToast('当前筛选范围没有可智能关联的线上发票', 'info')
      return
    }
    setAutoMatchBusy(true)
    try {
      const result = await autoMatchInvoices({
        invoice_direction: direction,
        invoice_ids: invoiceIds,
        threshold: 0.8,
        unique_margin: 0.1,
        dry_run: dryRun
      })
      if (dryRun) {
        setAutoMatchPreview(result)
        showToast(
          result.matched > 0
            ? `扫描完成：可自动关联 ${result.matched} 张，需人工确认 ${result.ambiguous + result.unmatched} 张`
            : '扫描完成：暂无达到自动关联标准的唯一匹配',
          result.matched > 0 ? 'success' : 'info'
        )
      } else {
        setAutoMatchPreview(null)
        setAllocationRevision((value) => value + 1)
        showToast(
          `智能关联完成：已关联 ${result.matched} 张，金额 ¥${Number(result.matched_amount || 0).toFixed(2)}`,
          'success'
        )
      }
    } catch (error) {
      console.error(error)
      showToast('智能关联失败，请刷新后重试', 'error')
    } finally {
      setAutoMatchBusy(false)
    }
  }

  return (
    <AdminWorkspace className="invoice-rd-workspace">
      <AdminFilterBar>
        <form className="invoice-filter-panel" onSubmit={submitFilters}>
          <div className="invoice-filter-panel__main">
            <label className="invoice-filter-search-box">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m21 21-4.35-4.35m2.35-5.15a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />
              </svg>
              <input
                type="search"
                aria-label="客户简称搜索"
                placeholder="输入客户简称搜索，例如：三七三三"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
              />
            </label>
            <div className="invoice-filter-panel__actions">
              <button type="submit" className="rec-btn rec-btn--primary invoice-filter-search">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m21 21-4.35-4.35m2.35-5.15a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />
                </svg>
                搜索
              </button>
              <button type="button" className="rec-btn rec-btn--secondary" onClick={resetFilters}>
                清空
              </button>
            </div>
            <span className="invoice-filter-panel__result">
              {visibleInvoices.length} 条 · 客户库识别 {visiblePartnerCount} 条
            </span>
          </div>
        </form>
      </AdminFilterBar>

      <AdminActionBar>
        <div className="rec-toolbar">
          <div className="rec-toolbar__primary">
            {variant === 'manage' ? (
              <>
                <button
                  type="button"
                  className="rec-btn rec-btn--primary"
                  onClick={() => {
                    setInvoiceForm((prev) => ({ ...prev, invoiceDirection: direction }))
                    setActiveView(VIEWS.INVOICE_CREATE)
                  }}
                >
                  新增发票
                </button>
                <button type="button" className="rec-btn rec-btn--secondary" onClick={handleExportInvoiceCSV}>
                  导出 CSV
                </button>
                <button
                  type="button"
                  className="rec-btn rec-btn--secondary"
                  onClick={() => invoiceFileInputRef.current?.click()}
                >
                  导入税务 Excel / JSON / PDF
                </button>
                <input
                  ref={invoiceFileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.json,.pdf"
                  className="channel-rd__file"
                  style={{ display: 'none' }}
                  onChange={wrapImport}
                />
                <button
                  type="button"
                  className="rec-btn rec-btn--secondary"
                  disabled={autoMatchBusy || !invoiceApiEnabled || visibleInvoices.length === 0}
                  onClick={() => void runAutoMatch(true)}
                >
                  {autoMatchBusy ? '智能匹配中…' : '扫描智能匹配'}
                </button>
                {autoMatchPreview?.matched > 0 ? (
                  <button
                    type="button"
                    className="rec-btn rec-btn--primary"
                    disabled={autoMatchBusy}
                    onClick={() => void runAutoMatch(false)}
                    title={`高置信度 ${autoMatchPreview.matched} 张，模糊 ${autoMatchPreview.ambiguous} 张`}
                  >
                    确认关联 {autoMatchPreview.matched} 张
                  </button>
                ) : null}
              </>
            ) : (
              <span className="rec-toolbar__batch-label">发票台账查询</span>
            )}
          </div>
        </div>
      </AdminActionBar>

      <AdminStatsRow>
        <div className="rec-stats-cards rec-stats-cards--compact" aria-label="发票概览">
          {[
            { label: '发票数量', value: String(stats.count), note: `已完成关联 ${stats.linkedCount} 张` },
            { label: '价税合计', value: `¥${stats.totalAmountWithTax.toFixed(2)}`, note: `其中税额 ¥${stats.totalTax.toFixed(2)}` },
            {
              label: '已关联账单',
              value: allocationLoading ? '计算中…' : `¥${stats.allocatedAmount.toFixed(2)}`,
              note: '按实际分配金额统计',
              emphasize: true
            },
            {
              label: '待关联金额',
              value: allocationLoading ? '计算中…' : `¥${stats.remainingAmount.toFixed(2)}`,
              note: stats.remainingAmount > 0 ? '仍需匹配账单' : '已全部完成'
            }
          ].map((c) => (
            <div
              key={c.label}
              className={`rec-stat-card ${c.emphasize ? 'rec-stat-card--emphasis' : ''}`}
            >
              <div className="rec-stat-card__label">{c.label}</div>
              <div className="rec-stat-card__value">{c.value}</div>
              <div className="invoice-stat-card__note">{c.note}</div>
            </div>
          ))}
        </div>
      </AdminStatsRow>

      <AdminTableCard className="invoice-rd__table-card">
        <div className="invoice-table invoice-table--workspace invoice-table--ledger">
          <div className="invoice-table-head">
            <span>序号</span>
            <span>发票信息</span>
            <span>{direction === 'output' ? '购买方' : '销售方'}</span>
            <span>金额 / 税额</span>
            <span>价税合计</span>
            <span>开票信息</span>
            <span>票面状态</span>
            <span>账单关联</span>
            <span>备注</span>
            <span>操作</span>
          </div>
          {visibleInvoices.length === 0 ? (
            <div className="invoice-table-row invoice-table-row--empty">
              <span className="invoice-table-empty-text">暂无发票数据，当前筛选无匹配记录</span>
            </div>
          ) : (
            pagedInvoices.map((item, idx) => {
              const rid = getInvoiceRecordId(item) || item.id
              const counterpartyName = direction === 'output' ? item.buyerName || item.title : item.sellerName
              const counterpartyTaxNo = direction === 'output' ? item.buyerTaxNo || item.taxNo : item.sellerTaxNo
              const matchedPartner = rid != null ? invoicePartnerMap.get(String(rid)) : null
              const overview = allocationOverviews[String(rid)]
              const coverageStatus = overview?.coverage_status || 'none'
              const grossAmount = invoiceGross(item)
              return (
                <div className="invoice-table-row" key={rid}>
                  <span>{(page - 1) * pageSize + idx + 1}</span>
                  <span className="invoice-ledger-cell invoice-ledger-cell--invoice" title={invoiceNumber(item)}>
                    <strong>{invoiceNumber(item)}</strong>
                    <small>{item.invoiceType || '未填写票种'}</small>
                  </span>
                  <span className="invoice-ledger-cell" title={`${counterpartyName || ''} ${counterpartyTaxNo || ''}`}>
                    <strong>{matchedPartner?.shortName || counterpartyName || '未填写往来单位'}</strong>
                    <small>
                      {matchedPartner?.shortName ? counterpartyName : counterpartyTaxNo || '未填写税号'}
                    </small>
                    {matchedPartner ? <em className="invoice-partner-link">已关联客户库</em> : null}
                  </span>
                  <span className="invoice-ledger-cell invoice-ledger-cell--amount">
                    <strong>¥{parseFloat(item.amount || 0).toFixed(2)}</strong>
                    <small>税 ¥{parseFloat(item.taxAmount || 0).toFixed(2)}</small>
                  </span>
                  <span className="invoice-table__num invoice-table__gross">
                    ¥{grossAmount.toFixed(2)}
                  </span>
                  <span className="invoice-ledger-cell">
                    <strong>{item.issueDate || '未填日期'}</strong>
                    <small>{item.issuer || '未填开票人'}</small>
                  </span>
                  <span className={`tag tag-${item.status}`}>{item.status}</span>
                  <button
                    type="button"
                    className={`invoice-allocation-cell is-${coverageStatus}`}
                    onClick={() => setDrawerRecord(item)}
                  >
                    <strong>{allocationLoading && !overview ? '读取中…' : COVERAGE_TEXT[coverageStatus]}</strong>
                    <span>
                      {overview
                        ? `¥${Number(overview.allocated_amount || 0).toFixed(2)} / ¥${Number(overview.invoice_amount || grossAmount).toFixed(2)} · ${overview.allocation_count} 笔`
                        : `¥0.00 / ¥${grossAmount.toFixed(2)}`}
                    </span>
                    <i><b style={{ width: `${Math.min(100, Number(overview?.coverage_percent || 0))}%` }} /></i>
                  </button>
                  <span className="invoice-table__remark" title={item.remark}>
                    {item.remark || '-'}
                  </span>
                  <span className="invoice-table-row__actions">
                    <button type="button" className="edit-btn invoice-link-btn" onClick={() => setDrawerRecord(item)}>
                      关联账单
                    </button>
                    {variant === 'manage' ? (
                      <button type="button" className="edit-btn" onClick={() => openInvoiceEdit(rid)}>
                        编辑
                      </button>
                    ) : null}
                    {variant === 'manage' ? (
                      <button type="button" className="delete-btn" onClick={() => void handleDeleteInvoice(rid)}>
                        删除
                      </button>
                    ) : null}
                  </span>
                </div>
              )
            })
          )}
        </div>
        <div className="channel-table__pagination">
          <div className="channel-table__pagination-info">
            第 {page}/{totalPages} 页，共 {visibleInvoices.length} 条
          </div>
          <div className="channel-table__pagination-actions">
            <label className="channel-table__pagination-size">
              每页
              <select
                className="admin-input channel-rd__select"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) || 20)}
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </label>
            <button
              type="button"
              className="rec-btn rec-btn--ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </button>
            <button
              type="button"
              className="rec-btn rec-btn--ghost"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              下一页
            </button>
          </div>
        </div>
      </AdminTableCard>

      <InvoiceLightDrawer
        open={Boolean(drawerRecord)}
        record={drawerRecord}
        onClose={() => setDrawerRecord(null)}
        onUpdateRecord={(id, rec) => updateInvoiceRecord(id, rec)}
        onNavigateToFullEdit={(id) => openInvoiceEdit(id)}
        onOpenVerification={undefined}
        linkedPaymentRows={[]}
        onLinksChanged={undefined}
        onRequestManualLinkToPayment={undefined}
        onAllocationsChanged={() => setAllocationRevision((value) => value + 1)}
        onOpenBill={(bill) => {
          setDrawerRecord(null)
          const returnView = direction === 'input' ? VIEWS.INVOICE_INPUT : VIEWS.INVOICE_MANAGE
          if (bill.bill_type === 'rd') {
            openReconciliationEdit(String(bill.bill_id), returnView)
          } else {
            openChannelReconciliationEdit(String(bill.bill_id), returnView)
          }
        }}
        showToast={showToast}
      />
    </AdminWorkspace>
  )
}

export default InvoiceManageWorkspace
