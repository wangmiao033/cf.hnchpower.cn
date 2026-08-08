import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import AdminWorkspace from '@/components/admin/AdminWorkspace.jsx'
import AdminFilterBar from '@/components/admin/AdminFilterBar.jsx'
import AdminActionBar from '@/components/admin/AdminActionBar.jsx'
import AdminStatsRow from '@/components/admin/AdminStatsRow.jsx'
import AdminTableCard from '@/components/admin/AdminTableCard.jsx'
import InvoiceLightDrawer from '@/components/invoice/InvoiceLightDrawer.jsx'
import '@/components/reconciliation/reconciliation-admin.css'
import '@/components/invoice/invoice-advanced-filters.css'
import { deleteInvoiceRecord, getInvoiceRecordId } from '@/lib/api/invoice.ts'
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

const TAX_STATUS_TEXT = {
  normal: '正常',
  red: '红冲 / 负数',
  void: '作废',
  pending: '待确认'
}

const EMPTY_ADVANCED_FILTERS = {
  company: '',
  number: '',
  dateStart: '',
  dateEnd: '',
  invoiceType: '',
  source: '',
  taxStatus: 'all',
  sign: 'all',
  taxNo: '',
  amountMin: '',
  amountMax: ''
}

const DEFAULT_VISIBLE_COLUMNS = {
  taxNo: false,
  source: false,
  issuer: false,
  allocation: true,
  remark: true
}

const COLUMN_LABELS = {
  taxNo: '对方税号',
  source: '发票来源',
  issuer: '开票人',
  allocation: '账单关联',
  remark: '备注'
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

function issueDateKey(value) {
  return String(value || '').trim().slice(0, 10)
}

function formatDateInput(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDatePresetRange(preset) {
  const now = new Date()
  if (preset === 'month') {
    return {
      dateStart: formatDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
      dateEnd: formatDateInput(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    }
  }
  if (preset === 'lastMonth') {
    return {
      dateStart: formatDateInput(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      dateEnd: formatDateInput(new Date(now.getFullYear(), now.getMonth(), 0))
    }
  }
  if (preset === '30d') {
    const start = new Date(now)
    start.setDate(start.getDate() - 29)
    return { dateStart: formatDateInput(start), dateEnd: formatDateInput(now) }
  }
  return { dateStart: '', dateEnd: '' }
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
  return partners.find((partner) => normalizePartnerValue(partner.name) === nameKey) || null
}

function uniqueValues(items, getter) {
  return [...new Set(items.map(getter).map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

function taxStatusText(item) {
  if (item.status === '作废' || item.taxStatus === 'void') return TAX_STATUS_TEXT.void
  return TAX_STATUS_TEXT[item.taxStatus] || item.status || '正常'
}

function taxStatusClass(item) {
  if (item.status === '作废' || item.taxStatus === 'void') return 'void'
  if (item.taxStatus === 'red') return 'red'
  if (item.taxStatus === 'pending') return 'pending'
  return 'normal'
}

async function deleteInvoicesInChunks(ids, chunkSize = 8) {
  const results = []
  for (let start = 0; start < ids.length; start += chunkSize) {
    const chunk = ids.slice(start, start + chunkSize)
    const settled = await Promise.allSettled(chunk.map((id) => deleteInvoiceRecord(id)))
    settled.forEach((entry, index) => {
      results.push({
        id: chunk[index],
        ok: entry.status === 'fulfilled',
        error: entry.status === 'rejected' ? entry.reason : null
      })
    })
  }
  return results
}

function readVisibleColumns() {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE_COLUMNS
  try {
    const stored = JSON.parse(window.localStorage.getItem('invoice-ledger-visible-columns') || '{}')
    return { ...DEFAULT_VISIBLE_COLUMNS, ...stored }
  } catch {
    return DEFAULT_VISIBLE_COLUMNS
  }
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
    setInvoiceRecords,
    refetchInvoiceFromApi,
    handleDeleteInvoice,
    handleExportInvoiceCSV,
    handleImportInvoiceFile,
    updateInvoiceRecord
  } = invoice

  const initialFilters = useMemo(
    () => ({
      ...EMPTY_ADVANCED_FILTERS,
      company: invoiceFilter.companyKeyword || '',
      number: invoiceFilter.numberKeyword || '',
      dateStart: invoiceFilter.dateStart || '',
      dateEnd: invoiceFilter.dateEnd || '',
      invoiceType: invoiceFilter.invoiceType || ''
    }),
    []
  )

  const [drawerRecord, setDrawerRecord] = useState(null)
  const [pageSize, setPageSize] = useState(20)
  const [page, setPage] = useState(1)
  const [allocationOverviews, setAllocationOverviews] = useState({})
  const [allocationLoading, setAllocationLoading] = useState(false)
  const [allocationRevision, setAllocationRevision] = useState(0)
  const [autoMatchBusy, setAutoMatchBusy] = useState(false)
  const [autoMatchPreview, setAutoMatchPreview] = useState(null)
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState(() => new Set())
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [activePreset, setActivePreset] = useState('')
  const [draftFilters, setDraftFilters] = useState(initialFilters)
  const [appliedFilters, setAppliedFilters] = useState(initialFilters)
  const [visibleColumns, setVisibleColumns] = useState(readVisibleColumns)

  useEffect(() => {
    consumeInvoiceFocus()
  }, [])

  useEffect(() => {
    setInvoiceFilter({
      direction,
      dateStart: '',
      dateEnd: '',
      status: '全部',
      invoiceType: '',
      companyKeyword: '',
      numberKeyword: ''
    })
  }, [direction, setInvoiceFilter])

  useEffect(() => {
    setSelectedInvoiceIds(new Set())
    setDraftFilters(EMPTY_ADVANCED_FILTERS)
    setAppliedFilters(EMPTY_ADVANCED_FILTERS)
    setActivePreset('')
  }, [direction])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('invoice-ledger-visible-columns', JSON.stringify(visibleColumns))
  }, [visibleColumns])

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

  const invoiceTypeOptions = useMemo(
    () => uniqueValues(filteredInvoices, (item) => item.invoiceType),
    [filteredInvoices]
  )
  const sourceOptions = useMemo(
    () => uniqueValues(filteredInvoices, (item) => item.invoiceSource),
    [filteredInvoices]
  )

  const visibleInvoices = useMemo(() => {
    const companyKey = normalizePartnerValue(appliedFilters.company)
    const numberKey = normalizePartnerValue(appliedFilters.number)
    const taxNoKey = normalizePartnerValue(appliedFilters.taxNo)
    const minAmount = appliedFilters.amountMin === '' ? null : Number(appliedFilters.amountMin)
    const maxAmount = appliedFilters.amountMax === '' ? null : Number(appliedFilters.amountMax)

    return filteredInvoices.filter((item) => {
      const recordId = getInvoiceRecordId(item) || item.id
      const partner = recordId != null ? invoicePartnerMap.get(String(recordId)) : null
      const counterpartyName =
        direction === 'input' ? item.sellerName : item.buyerName || item.title
      const counterpartyTaxNo =
        direction === 'input' ? item.sellerTaxNo : item.buyerTaxNo || item.taxNo
      const date = issueDateKey(item.issueDate)
      const gross = invoiceGross(item)

      if (companyKey) {
        const matchesCompany = [
          counterpartyName,
          partner?.shortName,
          partner?.name,
          partner?.taxRegistrationNo
        ].some((value) => normalizePartnerValue(value).includes(companyKey))
        if (!matchesCompany) return false
      }
      if (numberKey && !normalizePartnerValue(invoiceNumber(item)).includes(numberKey)) return false
      if (taxNoKey && !normalizePartnerValue(counterpartyTaxNo).includes(taxNoKey)) return false
      if (appliedFilters.dateStart && (!date || date < appliedFilters.dateStart)) return false
      if (appliedFilters.dateEnd && (!date || date > appliedFilters.dateEnd)) return false
      if (appliedFilters.invoiceType && item.invoiceType !== appliedFilters.invoiceType) return false
      if (appliedFilters.source && item.invoiceSource !== appliedFilters.source) return false
      if (appliedFilters.taxStatus !== 'all') {
        const status = item.status === '作废' ? 'void' : item.taxStatus || 'normal'
        if (status !== appliedFilters.taxStatus) return false
      }
      if (appliedFilters.sign === 'positive' && gross <= 0) return false
      if (appliedFilters.sign === 'negative' && gross >= 0) return false
      if (Number.isFinite(minAmount) && gross < minAmount) return false
      if (Number.isFinite(maxAmount) && gross > maxAmount) return false
      return true
    })
  }, [appliedFilters, direction, filteredInvoices, invoicePartnerMap])

  const visiblePartnerCount = useMemo(
    () =>
      visibleInvoices.reduce((count, item) => {
        const recordId = getInvoiceRecordId(item) || item.id
        return count + (recordId != null && invoicePartnerMap.has(String(recordId)) ? 1 : 0)
      }, 0),
    [invoicePartnerMap, visibleInvoices]
  )

  const activeFilterLabels = useMemo(() => {
    const out = []
    if (appliedFilters.company) out.push(`往来单位：${appliedFilters.company}`)
    if (appliedFilters.number) out.push(`发票号：${appliedFilters.number}`)
    if (appliedFilters.dateStart || appliedFilters.dateEnd) {
      out.push(`开票日期：${appliedFilters.dateStart || '不限'} ~ ${appliedFilters.dateEnd || '不限'}`)
    }
    if (appliedFilters.invoiceType) out.push(`票种：${appliedFilters.invoiceType}`)
    if (appliedFilters.source) out.push(`来源：${appliedFilters.source}`)
    if (appliedFilters.taxStatus !== 'all') {
      out.push(`状态：${TAX_STATUS_TEXT[appliedFilters.taxStatus] || appliedFilters.taxStatus}`)
    }
    if (appliedFilters.sign === 'positive') out.push('正数发票')
    if (appliedFilters.sign === 'negative') out.push('负数发票')
    if (appliedFilters.taxNo) out.push(`税号：${appliedFilters.taxNo}`)
    if (appliedFilters.amountMin !== '' || appliedFilters.amountMax !== '') {
      out.push(`价税合计：${appliedFilters.amountMin || '不限'} ~ ${appliedFilters.amountMax || '不限'}`)
    }
    return out
  }, [appliedFilters])

  const invoiceIdsKey = useMemo(
    () => visibleInvoices.map((item) => getInvoiceRecordId(item)).filter(Boolean).join(','),
    [visibleInvoices]
  )

  useEffect(() => {
    const allowedIds = new Set(
      visibleInvoices
        .map((item) => getInvoiceRecordId(item) || item.id)
        .filter(Boolean)
        .map(String)
    )
    setSelectedInvoiceIds((current) => {
      const next = new Set([...current].filter((id) => allowedIds.has(id)))
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current
      return next
    })
  }, [invoiceIdsKey, visibleInvoices])

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
      (acc, item) => {
        const amount = parseFloat(item.amount || 0) || 0
        const tax = parseFloat(item.taxAmount || 0) || 0
        const amountWithTax = invoiceGross(item)
        const overview = allocationOverviews[getInvoiceRecordId(item)]
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
    setPage((current) => Math.min(current, totalPages))
  }, [totalPages])
  useEffect(() => {
    setPage(1)
  }, [appliedFilters, pageSize, direction])

  const pagedInvoices = useMemo(() => {
    const start = (page - 1) * pageSize
    return visibleInvoices.slice(start, start + pageSize)
  }, [visibleInvoices, page, pageSize])

  const pagedInvoiceIds = useMemo(
    () =>
      pagedInvoices
        .map((item) => getInvoiceRecordId(item) || item.id)
        .filter(Boolean)
        .map(String),
    [pagedInvoices]
  )

  const ledgerGridColumns = useMemo(() => {
    const columns = [
      '36px',
      '44px',
      'minmax(170px, 1.25fr)',
      'minmax(170px, 1.25fr)'
    ]
    if (visibleColumns.taxNo) columns.push('minmax(150px, 1fr)')
    columns.push('minmax(110px, 0.82fr)', 'minmax(110px, 0.82fr)', '118px')
    if (visibleColumns.issuer) columns.push('90px')
    columns.push('96px')
    if (visibleColumns.source) columns.push('minmax(140px, 0.95fr)')
    if (visibleColumns.allocation) columns.push('minmax(190px, 1.35fr)')
    if (visibleColumns.remark) columns.push('minmax(140px, 1fr)')
    columns.push('minmax(150px, 1.05fr)')
    return columns.join(' ')
  }, [visibleColumns])

  const selectedCount = selectedInvoiceIds.size
  const selectedOnPage = pagedInvoiceIds.filter((id) => selectedInvoiceIds.has(id)).length
  const allPageSelected = pagedInvoiceIds.length > 0 && selectedOnPage === pagedInvoiceIds.length

  const setDraftField = (key, value) => {
    setDraftFilters((current) => ({ ...current, [key]: value }))
    if (key === 'dateStart' || key === 'dateEnd') setActivePreset('custom')
  }

  const submitFilters = (event) => {
    event.preventDefault()
    setAppliedFilters({ ...draftFilters })
  }

  const resetFilters = () => {
    setDraftFilters(EMPTY_ADVANCED_FILTERS)
    setAppliedFilters(EMPTY_ADVANCED_FILTERS)
    setActivePreset('')
  }

  const applyDatePreset = (preset) => {
    const range = getDatePresetRange(preset)
    const next = { ...draftFilters, ...range }
    setDraftFilters(next)
    setAppliedFilters(next)
    setActivePreset(preset)
  }

  const toggleColumn = (key) => {
    setVisibleColumns((current) => ({ ...current, [key]: !current[key] }))
  }

  const toggleInvoiceSelection = (rawId) => {
    const id = String(rawId || '')
    if (!id) return
    setSelectedInvoiceIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleCurrentPage = () => {
    if (!pagedInvoiceIds.length) return
    setSelectedInvoiceIds((current) => {
      const next = new Set(current)
      if (allPageSelected) pagedInvoiceIds.forEach((id) => next.delete(id))
      else pagedInvoiceIds.forEach((id) => next.add(id))
      return next
    })
  }

  const runBulkDelete = async () => {
    const ids = [...selectedInvoiceIds]
    if (variant !== 'manage' || ids.length === 0 || bulkDeleteBusy) return
    const confirmed = window.confirm(
      `确定删除选中的 ${ids.length} 张发票吗？\n\n已关联账单的发票会自动跳过；其他成功删除的记录无法撤销。`
    )
    if (!confirmed) return

    setBulkDeleteBusy(true)
    try {
      if (!invoiceApiEnabled) {
        const idSet = new Set(ids)
        setInvoiceRecords((current) =>
          current.filter((item) => !idSet.has(String(getInvoiceRecordId(item) || item.id || '')))
        )
        setSelectedInvoiceIds(new Set())
        showToast(`已批量删除 ${ids.length} 张发票`, 'success')
        return
      }

      const results = await deleteInvoicesInChunks(ids)
      const deleted = results.filter((item) => item.ok)
      const blocked = results.filter((item) => !item.ok && Number(item.error?.status) === 409)
      const failed = results.filter((item) => !item.ok && Number(item.error?.status) !== 409)

      await refetchInvoiceFromApi()
      setSelectedInvoiceIds(new Set())
      setAllocationRevision((value) => value + 1)

      if (deleted.length > 0 && blocked.length === 0 && failed.length === 0) {
        showToast(`已批量删除 ${deleted.length} 张发票`, 'success')
      } else if (deleted.length > 0) {
        showToast(
          `批量删除完成：成功 ${deleted.length} 张，已关联账单跳过 ${blocked.length} 张${
            failed.length ? `，其他失败 ${failed.length} 张` : ''
          }`,
          blocked.length || failed.length ? 'info' : 'success'
        )
      } else if (blocked.length > 0 && failed.length === 0) {
        showToast(`未删除：选中的 ${blocked.length} 张发票均已关联账单，请先解除关联`, 'info')
      } else {
        showToast(
          `批量删除失败：已关联账单 ${blocked.length} 张，其他失败 ${failed.length} 张`,
          'error'
        )
      }
    } catch (error) {
      console.error(error)
      showToast('批量删除发票失败，请刷新后重试', 'error')
    } finally {
      setBulkDeleteBusy(false)
    }
  }

  const wrapImport = (event) => {
    const file = event.target.files?.[0]
    void handleImportInvoiceFile(event)
    if (file?.name?.toLowerCase().endsWith('.pdf')) {
      setActiveViewRaw?.(VIEWS.INVOICE_CREATE)
    }
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
        <form className="invoice-filter-panel invoice-filter-panel--advanced" onSubmit={submitFilters}>
          <div className="invoice-filter-primary">
            <label className="invoice-filter-search-wrap">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m21 21-4.35-4.35m2.35-5.15a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />
              </svg>
              <input
                type="search"
                className="invoice-filter-input"
                aria-label="往来单位搜索"
                placeholder={direction === 'output' ? '购买方 / 客户简称' : '销售方 / 客户简称'}
                value={draftFilters.company}
                onChange={(event) => setDraftField('company', event.target.value)}
              />
            </label>
            <input
              type="search"
              className="invoice-filter-input"
              aria-label="发票号码搜索"
              placeholder="数电发票号 / 发票号码"
              value={draftFilters.number}
              onChange={(event) => setDraftField('number', event.target.value)}
            />
            <input
              type="date"
              className="invoice-filter-input"
              aria-label="开票日期起"
              value={draftFilters.dateStart}
              onChange={(event) => setDraftField('dateStart', event.target.value)}
            />
            <input
              type="date"
              className="invoice-filter-input"
              aria-label="开票日期止"
              value={draftFilters.dateEnd}
              onChange={(event) => setDraftField('dateEnd', event.target.value)}
            />
            <div className="invoice-filter-primary__actions">
              <button type="submit" className="rec-btn rec-btn--primary invoice-filter-search">搜索</button>
              <button type="button" className="rec-btn rec-btn--secondary" onClick={resetFilters}>清空</button>
              <button
                type="button"
                className="invoice-filter-more-button"
                onClick={() => setAdvancedOpen((current) => !current)}
              >
                {advancedOpen ? '收起筛选 ▲' : '更多筛选 ▼'}
              </button>
            </div>
          </div>

          <div className="invoice-filter-toolbar">
            <div className="invoice-filter-presets" aria-label="快捷日期">
              <button type="button" className={`invoice-filter-preset ${activePreset === 'month' ? 'is-active' : ''}`} onClick={() => applyDatePreset('month')}>本月</button>
              <button type="button" className={`invoice-filter-preset ${activePreset === 'lastMonth' ? 'is-active' : ''}`} onClick={() => applyDatePreset('lastMonth')}>上月</button>
              <button type="button" className={`invoice-filter-preset ${activePreset === '30d' ? 'is-active' : ''}`} onClick={() => applyDatePreset('30d')}>近30天</button>
              <button type="button" className={`invoice-filter-preset ${activePreset === 'all' ? 'is-active' : ''}`} onClick={() => applyDatePreset('all')}>全部日期</button>
            </div>
            <div className="invoice-filter-toolbar__right">
              <span className="invoice-filter-result">
                筛选结果 <strong>{visibleInvoices.length}</strong> / 全部 {filteredInvoices.length} 张 · 客户库识别 {visiblePartnerCount} 张
              </span>
              <details className="invoice-column-picker">
                <summary>自定义列</summary>
                <div className="invoice-column-picker__panel">
                  <strong>显示字段</strong>
                  {Object.entries(COLUMN_LABELS).map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={Boolean(visibleColumns[key])}
                        onChange={() => toggleColumn(key)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </details>
            </div>
          </div>

          {advancedOpen ? (
            <div className="invoice-filter-advanced">
              <label className="invoice-filter-field">
                <span>发票票种</span>
                <select className="invoice-filter-select" value={draftFilters.invoiceType} onChange={(event) => setDraftField('invoiceType', event.target.value)}>
                  <option value="">全部</option>
                  {invoiceTypeOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="invoice-filter-field">
                <span>票面 / 税务状态</span>
                <select className="invoice-filter-select" value={draftFilters.taxStatus} onChange={(event) => setDraftField('taxStatus', event.target.value)}>
                  <option value="all">全部</option>
                  <option value="normal">正常</option>
                  <option value="red">红冲 / 负数</option>
                  <option value="void">作废</option>
                  <option value="pending">待确认</option>
                </select>
              </label>
              <label className="invoice-filter-field">
                <span>发票来源</span>
                <select className="invoice-filter-select" value={draftFilters.source} onChange={(event) => setDraftField('source', event.target.value)}>
                  <option value="">全部</option>
                  {sourceOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="invoice-filter-field">
                <span>是否正数发票</span>
                <select className="invoice-filter-select" value={draftFilters.sign} onChange={(event) => setDraftField('sign', event.target.value)}>
                  <option value="all">全部</option>
                  <option value="positive">正数发票</option>
                  <option value="negative">负数发票</option>
                </select>
              </label>
              <label className="invoice-filter-field">
                <span>对方纳税人识别号</span>
                <input className="invoice-filter-input" value={draftFilters.taxNo} onChange={(event) => setDraftField('taxNo', event.target.value)} placeholder="输入税号" />
              </label>
              <label className="invoice-filter-field">
                <span>价税合计区间</span>
                <span className="invoice-filter-amount-range">
                  <input type="number" step="0.01" className="invoice-filter-input" value={draftFilters.amountMin} onChange={(event) => setDraftField('amountMin', event.target.value)} placeholder="起" />
                  <span>—</span>
                  <input type="number" step="0.01" className="invoice-filter-input" value={draftFilters.amountMax} onChange={(event) => setDraftField('amountMax', event.target.value)} placeholder="止" />
                </span>
              </label>
            </div>
          ) : null}

          {activeFilterLabels.length > 0 ? (
            <div className="invoice-active-filters" aria-label="当前筛选条件">
              {activeFilterLabels.map((label) => <span className="invoice-active-filter" key={label}>{label}</span>)}
            </div>
          ) : null}
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
                    setInvoiceForm((previous) => ({ ...previous, invoiceDirection: direction }))
                    setActiveView(VIEWS.INVOICE_CREATE)
                  }}
                >
                  新增发票
                </button>
                <button
                  type="button"
                  className="rec-btn rec-btn--secondary"
                  disabled={selectedCount === 0 || bulkDeleteBusy}
                  onClick={() => void runBulkDelete()}
                  style={{
                    borderColor: selectedCount ? '#fecaca' : undefined,
                    background: selectedCount ? '#fff1f2' : undefined,
                    color: selectedCount ? '#be123c' : undefined
                  }}
                >
                  {bulkDeleteBusy ? '正在删除…' : `批量删除${selectedCount ? ` ${selectedCount} 张` : ''}`}
                </button>
                {selectedCount > 0 ? (
                  <button type="button" className="rec-btn rec-btn--secondary" onClick={() => setSelectedInvoiceIds(new Set())} disabled={bulkDeleteBusy}>
                    清空选择
                  </button>
                ) : null}
                <button type="button" className="rec-btn rec-btn--secondary" onClick={handleExportInvoiceCSV}>导出 CSV</button>
                <button type="button" className="rec-btn rec-btn--secondary" onClick={() => invoiceFileInputRef.current?.click()}>
                  导入税务 Excel / JSON / PDF
                </button>
                <input ref={invoiceFileInputRef} type="file" accept=".xlsx,.xls,.json,.pdf" className="channel-rd__file" style={{ display: 'none' }} onChange={wrapImport} />
                <button
                  type="button"
                  className="rec-btn rec-btn--secondary"
                  disabled={autoMatchBusy || !invoiceApiEnabled || visibleInvoices.length === 0}
                  onClick={() => void runAutoMatch(true)}
                >
                  {autoMatchBusy ? '智能匹配中…' : '扫描智能匹配'}
                </button>
                {autoMatchPreview?.matched > 0 ? (
                  <button type="button" className="rec-btn rec-btn--primary" disabled={autoMatchBusy} onClick={() => void runAutoMatch(false)} title={`高置信度 ${autoMatchPreview.matched} 张，模糊 ${autoMatchPreview.ambiguous} 张`}>
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
              note: '按当前筛选实际分配金额统计',
              emphasize: true
            },
            {
              label: '待关联金额',
              value: allocationLoading ? '计算中…' : `¥${stats.remainingAmount.toFixed(2)}`,
              note: stats.remainingAmount > 0 ? '当前筛选仍需匹配账单' : '当前筛选已全部完成'
            }
          ].map((card) => (
            <div key={card.label} className={`rec-stat-card ${card.emphasize ? 'rec-stat-card--emphasis' : ''}`}>
              <div className="rec-stat-card__label">{card.label}</div>
              <div className="rec-stat-card__value">{card.value}</div>
              <div className="invoice-stat-card__note">{card.note}</div>
            </div>
          ))}
        </div>
      </AdminStatsRow>

      <AdminTableCard className="invoice-rd__table-card">
        <div className="invoice-table invoice-table--workspace invoice-table--ledger" style={{ minWidth: '1280px' }}>
          <div className="invoice-table-head" style={{ gridTemplateColumns: ledgerGridColumns }}>
            <span style={{ display: 'grid', placeItems: 'center' }}>
              {variant === 'manage' ? (
                <input type="checkbox" checked={allPageSelected} onChange={toggleCurrentPage} aria-label={`全选当前页 ${pagedInvoiceIds.length} 张发票`} title={`全选当前页 ${pagedInvoiceIds.length} 张`} />
              ) : null}
            </span>
            <span>序号</span>
            <span>发票信息</span>
            <span>{direction === 'output' ? '购买方' : '销售方'}</span>
            {visibleColumns.taxNo ? <span>对方税号</span> : null}
            <span>金额 / 税额</span>
            <span>价税合计</span>
            <span>开票日期</span>
            {visibleColumns.issuer ? <span>开票人</span> : null}
            <span>票面状态</span>
            {visibleColumns.source ? <span>发票来源</span> : null}
            {visibleColumns.allocation ? <span>账单关联</span> : null}
            {visibleColumns.remark ? <span>备注</span> : null}
            <span>操作</span>
          </div>

          {visibleInvoices.length === 0 ? (
            <div className="invoice-table-row invoice-table-row--empty" style={{ gridTemplateColumns: ledgerGridColumns }}>
              <span className="invoice-table-empty-text">暂无发票数据，当前筛选无匹配记录</span>
            </div>
          ) : (
            pagedInvoices.map((item, index) => {
              const recordId = getInvoiceRecordId(item) || item.id
              const selectedId = String(recordId || '')
              const counterpartyName = direction === 'output' ? item.buyerName || item.title : item.sellerName
              const counterpartyTaxNo = direction === 'output' ? item.buyerTaxNo || item.taxNo : item.sellerTaxNo
              const matchedPartner = recordId != null ? invoicePartnerMap.get(String(recordId)) : null
              const overview = allocationOverviews[String(recordId)]
              const coverageStatus = overview?.coverage_status || 'none'
              const grossAmount = invoiceGross(item)
              const statusClass = taxStatusClass(item)

              return (
                <div
                  className="invoice-table-row"
                  key={recordId}
                  style={{
                    gridTemplateColumns: ledgerGridColumns,
                    background: selectedInvoiceIds.has(selectedId) ? '#f5f9ff' : undefined
                  }}
                >
                  <span style={{ display: 'grid', placeItems: 'center' }}>
                    {variant === 'manage' ? (
                      <input type="checkbox" checked={selectedInvoiceIds.has(selectedId)} onChange={() => toggleInvoiceSelection(selectedId)} aria-label={`选择发票 ${invoiceNumber(item)}`} />
                    ) : null}
                  </span>
                  <span>{(page - 1) * pageSize + index + 1}</span>
                  <span className="invoice-ledger-cell invoice-ledger-cell--invoice" title={invoiceNumber(item)}>
                    <strong>{invoiceNumber(item)}</strong>
                    <small>{item.invoiceType || '未填写票种'}</small>
                  </span>
                  <span className="invoice-ledger-cell" title={counterpartyName || ''}>
                    <strong>{matchedPartner?.shortName || counterpartyName || '未填写往来单位'}</strong>
                    {matchedPartner?.shortName ? <small>{counterpartyName || '-'}</small> : null}
                    {matchedPartner ? <em className="invoice-partner-link">已关联客户库</em> : null}
                  </span>
                  {visibleColumns.taxNo ? <span className="invoice-ledger-muted" title={counterpartyTaxNo || ''}>{counterpartyTaxNo || '-'}</span> : null}
                  <span className="invoice-ledger-cell invoice-ledger-cell--amount">
                    <strong>¥{parseFloat(item.amount || 0).toFixed(2)}</strong>
                    <small>税 ¥{parseFloat(item.taxAmount || 0).toFixed(2)}</small>
                  </span>
                  <span className="invoice-table__num invoice-table__gross">¥{grossAmount.toFixed(2)}</span>
                  <span className="invoice-ledger-muted" title={item.issueDate || ''}>{item.issueDate || '未填日期'}</span>
                  {visibleColumns.issuer ? <span className="invoice-ledger-muted" title={item.issuer || ''}>{item.issuer || '-'}</span> : null}
                  <span className={`invoice-tax-status is-${statusClass}`} title={item.status || ''}>{taxStatusText(item)}</span>
                  {visibleColumns.source ? <span className="invoice-ledger-muted" title={item.invoiceSource || ''}>{item.invoiceSource || '-'}</span> : null}
                  {visibleColumns.allocation ? (
                    <button type="button" className={`invoice-allocation-cell is-${coverageStatus}`} onClick={() => setDrawerRecord(item)}>
                      <strong>{allocationLoading && !overview ? '读取中…' : COVERAGE_TEXT[coverageStatus]}</strong>
                      <span>
                        {overview
                          ? `¥${Number(overview.allocated_amount || 0).toFixed(2)} / ¥${Number(overview.invoice_amount || grossAmount).toFixed(2)} · ${overview.allocation_count} 笔`
                          : `¥0.00 / ¥${grossAmount.toFixed(2)}`}
                      </span>
                      <i><b style={{ width: `${Math.min(100, Number(overview?.coverage_percent || 0))}%` }} /></i>
                    </button>
                  ) : null}
                  {visibleColumns.remark ? <span className="invoice-table__remark" title={item.remark}>{item.remark || '-'}</span> : null}
                  <span className="invoice-table-row__actions">
                    <button type="button" className="edit-btn invoice-link-btn" onClick={() => setDrawerRecord(item)}>关联账单</button>
                    {variant === 'manage' ? <button type="button" className="edit-btn" onClick={() => openInvoiceEdit(recordId)}>编辑</button> : null}
                    {variant === 'manage' ? <button type="button" className="delete-btn" onClick={() => void handleDeleteInvoice(recordId)}>删除</button> : null}
                  </span>
                </div>
              )
            })
          )}
        </div>

        <div className="channel-table__pagination">
          <div className="channel-table__pagination-info">
            第 {page}/{totalPages} 页，共 {visibleInvoices.length} 条
            {filteredInvoices.length !== visibleInvoices.length ? ` / 全部 ${filteredInvoices.length} 条` : ''}
            {selectedCount > 0 ? ` · 已选 ${selectedCount} 张` : ''}
          </div>
          <div className="channel-table__pagination-actions">
            <label className="channel-table__pagination-size">
              每页
              <select className="admin-input channel-rd__select" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) || 20)}>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </label>
            <button type="button" className="rec-btn rec-btn--ghost" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button>
            <button type="button" className="rec-btn rec-btn--ghost" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>下一页</button>
          </div>
        </div>
      </AdminTableCard>

      <InvoiceLightDrawer
        open={Boolean(drawerRecord)}
        record={drawerRecord}
        onClose={() => setDrawerRecord(null)}
        onUpdateRecord={(id, record) => updateInvoiceRecord(id, record)}
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
