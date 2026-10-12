import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import BillQuickFilters from '@/components/reconciliation/BillQuickFilters.jsx'
import { VIEWS } from '@/app/routes.js'
import {
  buildRdSettlementPeriodOptions,
  getRdRecordSettlementPeriods,
  rdRecordMatchesSettlementPeriod,
  rdRecordSettlementPeriodLabel
} from '@/domain/reconciliation/rdSettlementPeriods.js'
import { bill360Lines, bill360QuickSdkKeys } from '@/domain/reconciliation/bill360.js'
import { totalReconciliationSettlementAmount } from '@/domain/settlement/calculateSettlementAmount.js'
import {
  apiRowToFrontend,
  getReconciliationRecord
} from '@/lib/api/reconciliation.ts'
import { getBill360QuickSdkSummary } from '@/lib/api/bill360Performance.ts'
import { transitionBillLifecycle } from '@/lib/api/billLifecycle.ts'
import { listFundingClosureStatus } from '@/domain/reconciliation/closureStatus.js'
import { confirmRdBillDeletion } from '@/domain/reconciliation/confirmRdBillDeletion.js'
import { archiveBill, getBillArchiveSnapshot, unarchiveBill } from '@/lib/api/billArchive.ts'
import './CoreReconciliationPages.css'
import '@/components/reconciliation/reconciliation-admin.css'

const STATUS_LABELS = {
  pending: '待处理',
  confirmed: '已确认',
  completed: '已完成',
  cancelled: '已作废',
  settled: '已结算',
  invoiced: '已开票',
  reconciled: '已核销'
}

function money(value) {
  const n = Number(value || 0)
  return `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function recordSettlementAmount(row) {
  const stored = Number.parseFloat(row?.settlementAmount)
  return Number.isFinite(stored) ? stored : totalReconciliationSettlementAmount(row)
}

function recordPrepaymentDeduction(row) {
  const stored = Number(row?.prepaymentDeduction ?? row?.prepayment_deduction ?? 0)
  return Number.isFinite(stored) ? Math.max(0, stored) : 0
}

function recordActualPayable(row) {
  const stored = Number(row?.actualPayable ?? row?.actual_payable)
  if (Number.isFinite(stored)) return Math.max(0, stored)
  return Math.max(0, recordSettlementAmount(row) - recordPrepaymentDeduction(row))
}

function paymentAmounts(row) {
  const paid = Math.max(0, Number(row?.paidAmount || 0))
  const storedUnpaid = Number(row?.unpaidAmount)
  const fallbackUnpaid = recordActualPayable(row) - paid
  return {
    paid,
    unpaid: Math.max(0, Number.isFinite(storedUnpaid) ? storedUnpaid : fallbackUnpaid)
  }
}

function text(value, fallback = '-') {
  const raw = value == null ? '' : String(value).trim()
  return raw || fallback
}

function monthKey(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4})(?:-|年)\s*(\d{1,2})(?:月)?$/)
  if (!match) return raw
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
}

function monthLabel(value) {
  const normalized = monthKey(value)
  const match = normalized.match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : normalized
}

function gameText(row) {
  if (Array.isArray(row.items) && row.items.length > 0) {
    return [...new Set(row.items.map((item) => text(item.gameName, '')).filter(Boolean))].join('、')
  }
  return text(row.game, '')
}

function partnerKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/\s+/g, '')
}

function isCancelledRow(row) {
  const current = String(row?.status || '').trim().toLowerCase()
  return current === 'cancelled' || current === 'canceled'
}

function CoreReconciliationPage() {
  const {
    recon,
    settings,
    showToast,
    setActiveView,
    openReconciliationEdit,
    openBill360,
    prefetchBill360
  } = useAppState()
  const fileRef = useRef(null)
  const [month, setMonth] = useState('')
  const [partner, setPartner] = useState('')
  const [showMoreFilters, setShowMoreFilters] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [headerActionsTarget, setHeaderActionsTarget] = useState(null)
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [quickFilter, setQuickFilter] = useState('all')
  const [dataDiffIds, setDataDiffIds] = useState(null)
  const [dataDiffLoading, setDataDiffLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [isExporting, setIsExporting] = useState(false)
  const [voidingId, setVoidingId] = useState('')
  const [archiveState, setArchiveState] = useState({ archived_ids: [], eligible_ids: [], items: [], auto_archive_days: 7 })
  const [archiveLoading, setArchiveLoading] = useState(true)
  const [archiveWorkingId, setArchiveWorkingId] = useState('')

  const archivedIds = useMemo(() => new Set((archiveState.archived_ids || []).map(String)), [archiveState])
  const eligibleIds = useMemo(() => new Set((archiveState.eligible_ids || []).map(String)), [archiveState])

  useEffect(() => {
    setHeaderActionsTarget(document.getElementById('rd-ledger-header-actions'))
  }, [])

  useEffect(() => {
    setPage(1)
    setSelectedIds([])
  }, [month, partner, status, query, quickFilter, pageSize])

  const refreshArchiveState = async (announceAuto = false) => {
    setArchiveLoading(true)
    try {
      const snapshot = await getBillArchiveSnapshot('rd', true)
      setArchiveState(snapshot)
      if (announceAuto && Number(snapshot.auto_archived_count || 0) > 0) {
        showToast(`已自动归档 ${snapshot.auto_archived_count} 张结清满 ${snapshot.auto_archive_days || 7} 天的研发账单`, 'info')
      }
    } catch (error) {
      console.error(error)
      setArchiveState((current) => ({ ...current, archived_ids: current.archived_ids || [], eligible_ids: current.eligible_ids || [] }))
    } finally {
      setArchiveLoading(false)
    }
  }

  useEffect(() => {
    setDataDiffIds(null)
    void refreshArchiveState(true)
  }, [recon.records])

  const monthOptions = useMemo(
    () => buildRdSettlementPeriodOptions(recon.records || []),
    [recon.records]
  )

  const partnerOptions = useMemo(() => {
    const names = [
      ...(settings.partners || []).flatMap((item) => [
        String(item.shortName || '').trim(),
        String(item.name || '').trim()
      ]),
      ...(recon.records || []).flatMap((row) => [
        text(row.partnerShortName, ''),
        text(row.partner || row.partyBName, '')
      ])
    ].filter(Boolean)
    const unique = new Map()
    names.forEach((name) => {
      const key = partnerKey(name)
      if (key && !unique.has(key)) unique.set(key, name)
    })
    return [...unique.values()].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [recon.records, settings.partners])

  const scopedRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (recon.records || []).filter((row) => {
      const matchesMonth = !month || rdRecordMatchesSettlementPeriod(row, month)
      const rowPartner = text(row.partner || row.partyBName, '')
      const rowPartnerShortName = text(row.partnerShortName, '')
      const matchesPartner =
        !partner ||
        [rowPartner, rowPartnerShortName].some((value) =>
          partnerKey(value).includes(partnerKey(partner))
        )
      const matchesStatus = !status || String(row.status || 'pending') === status
      const haystack = [
        row.settlementNumber,
        rowPartner,
        rowPartnerShortName,
        row.game,
        gameText(row),
        rdRecordSettlementPeriodLabel(row),
        row.remark
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return matchesMonth && matchesPartner && matchesStatus && (!q || haystack.includes(q))
    })
  }, [recon.records, month, partner, query, status])

  const trashRows = useMemo(
    () => scopedRows.filter(isCancelledRow),
    [scopedRows]
  )

  const archivedRows = useMemo(
    () => scopedRows.filter((row) => archivedIds.has(String(row.id)) && !isCancelledRow(row)),
    [scopedRows, archivedIds]
  )

  const activeRows = useMemo(
    () => scopedRows.filter((row) => !archivedIds.has(String(row.id)) && !isCancelledRow(row)),
    [scopedRows, archivedIds]
  )

  const rows = useMemo(() => {
    if (quickFilter === 'trash') return trashRows
    if (quickFilter === 'archived') return archivedRows
    if (quickFilter === 'all') return activeRows
    return activeRows.filter((row) => {
      const { paid, unpaid } = paymentAmounts(row)
      if (quickFilter === 'unpaid') return unpaid > 0.01 && paid <= 0.01
      if (quickFilter === 'partial') return paid > 0.01 && unpaid > 0.01
      if (quickFilter === 'settled') return eligibleIds.has(String(row.id))
      if (quickFilter === 'data-diff') return Boolean(dataDiffIds?.has(String(row.id)))
      return true
    })
  }, [activeRows, archivedRows, trashRows, quickFilter, dataDiffIds, eligibleIds])

  const orderedRows = useMemo(() => [...rows].sort((left, right) => {
    const latestMonth = row => getRdRecordSettlementPeriods(row).map(monthKey).sort().at(-1) || ''
    return latestMonth(right).localeCompare(latestMonth(left)) ||
      String(right.settlementNumber || '').localeCompare(String(left.settlementNumber || ''))
  }), [rows])
  const totalPages = Math.max(1, Math.ceil(orderedRows.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const offset = (currentPage - 1) * pageSize
  const visibleRows = orderedRows.slice(offset, offset + pageSize)
  const selectableRows = visibleRows.filter(row => !isCancelledRow(row) && !archivedIds.has(String(row.id)))
  const selectedPageCount = selectableRows.filter(row => selectedIds.includes(String(row.id))).length
  const allPageSelected = selectableRows.length > 0 && selectedPageCount === selectableRows.length
  const selectPage = checked => {
    const pageIds = new Set(selectableRows.map(row => String(row.id)))
    setSelectedIds(previous => checked
      ? [...new Set([...previous, ...pageIds])]
      : previous.filter(id => !pageIds.has(id)))
  }

  const selectedRows = useMemo(
    () => rows.filter((row) => !archivedIds.has(String(row.id)) && !isCancelledRow(row) && selectedIds.includes(String(row.id))),
    [rows, selectedIds, archivedIds]
  )

  const quickItems = useMemo(() => [
    { key: 'all', label: '全部', count: activeRows.length },
    {
      key: 'unpaid',
      label: '未付款',
      count: activeRows.filter((row) => paymentAmounts(row).unpaid > 0.01 && paymentAmounts(row).paid <= 0.01).length
    },
    {
      key: 'partial',
      label: '部分付款',
      count: activeRows.filter((row) => {
        const amount = paymentAmounts(row)
        return amount.paid > 0.01 && amount.unpaid > 0.01
      }).length
    },
    { key: 'settled', label: '已结清', count: activeRows.filter((row) => eligibleIds.has(String(row.id))).length },
    { key: 'data-diff', label: '数据差异', count: dataDiffIds ? activeRows.filter((row) => dataDiffIds.has(String(row.id))).length : null },
    { key: 'trash', label: '垃圾桶', count: trashRows.length },
    { key: 'archived', label: '归档账单', count: archiveLoading ? null : archivedRows.length }
  ], [activeRows, archivedRows, trashRows, dataDiffIds, eligibleIds, archiveLoading])

  const stats = useMemo(() => {
    const total = rows.reduce((sum, row) => sum + recordSettlementAmount(row), 0)
    const prepayment = rows.reduce((sum, row) => sum + recordPrepaymentDeduction(row), 0)
    const actualPayable = rows.reduce((sum, row) => sum + recordActualPayable(row), 0)
    const paid = rows.reduce((sum, row) => sum + paymentAmounts(row).paid, 0)
    const unpaid = rows.reduce((sum, row) => sum + paymentAmounts(row).unpaid, 0)
    const partners = new Set(
      rows
        .map((row) => text(row.partnerId || row.partner || row.partyBName, ''))
        .filter(Boolean)
    )
    const games = new Set(rows.flatMap((row) => gameText(row).split('、').filter(Boolean)))
    return [
      { label: '账单数量', value: rows.length },
      { label: '合作方', value: partners.size, note: `${games.size} 个游戏项目` },
      { label: '研发应结', value: money(total), note: prepayment > 0.01 ? `预付款抵扣 ${money(prepayment)} · 实际应付 ${money(actualPayable)}` : undefined },
      { label: '未付', value: money(unpaid), note: `已付 ${money(paid)}` }
    ]
  }, [rows])

  const toggleSelected = (id) => {
    const sid = String(id)
    setSelectedIds((prev) => (prev.includes(sid) ? prev.filter((item) => item !== sid) : [...prev, sid]))
  }

  const loadDataDifferences = async () => {
    if (dataDiffIds || dataDiffLoading) return
    setDataDiffLoading(true)
    try {
      const sourceRows = (recon.records || []).filter(
        (row) => !isCancelledRow(row) && !archivedIds.has(String(row.id))
      )
      const uniqueKeys = new Map()
      const keysByBill = new Map()

      sourceRows.forEach((row) => {
        const keys = bill360QuickSdkKeys('rd', row)
        keysByBill.set(String(row.id), keys)
        keys.forEach((key) => {
          if (!uniqueKeys.has(key.key)) {
            uniqueKeys.set(key.key, {
              key: key.key,
              settlement_month: key.month,
              game_name: key.game
            })
          }
        })
      })

      const allKeys = [...uniqueKeys.values()]
      const chunks = []
      for (let index = 0; index < allKeys.length; index += 40) {
        chunks.push(allKeys.slice(index, index + 40))
      }
      const groups = chunks.length
        ? await Promise.all(chunks.map((chunk) => getBill360QuickSdkSummary(chunk)))
        : []
      const quickByKey = new Map(groups.flat().map((item) => [String(item.key), item]))
      const differentIds = new Set()

      sourceRows.forEach((row) => {
        const keys = keysByBill.get(String(row.id)) || []
        const matchedRows = keys.map((key) => quickByKey.get(key.key)).filter(Boolean)
        if (!matchedRows.length) return
        const databaseFlow = matchedRows.reduce((sum, item) => sum + Number(item?.total_flow || 0), 0)
        const billFlow = bill360Lines('rd', row).reduce((sum, line) => sum + Number(line.flow || 0), 0)
        if (Math.abs(databaseFlow - billFlow) > 0.01) differentIds.add(String(row.id))
      })

      setDataDiffIds(differentIds)
    } catch (error) {
      console.error(error)
      showToast('数据差异核对失败，请稍后重试', 'error')
      setDataDiffIds(new Set())
    } finally {
      setDataDiffLoading(false)
    }
  }

  const handleQuickFilter = (key) => {
    setQuickFilter(key)
    setSelectedIds([])
    if (key === 'data-diff') void loadDataDifferences()
  }

  const handleArchive = async (row) => {
    const id = String(row.id)
    if (archiveWorkingId) return
    setArchiveWorkingId(id)
    try {
      await archiveBill('rd', id)
      await refreshArchiveState(false)
      showToast('研发账单已归档，默认列表不再显示', 'success')
    } catch (error) {
      console.error(error)
      showToast(error instanceof Error ? error.message : '归档失败', 'error')
    } finally {
      setArchiveWorkingId('')
    }
  }

  const handleUnarchive = async (row) => {
    const id = String(row.id)
    if (archiveWorkingId) return
    setArchiveWorkingId(id)
    try {
      await unarchiveBill('rd', id)
      await refreshArchiveState(false)
      showToast('已取消归档，账单恢复到默认列表', 'success')
    } catch (error) {
      console.error(error)
      showToast(error instanceof Error ? error.message : '取消归档失败', 'error')
    } finally {
      setArchiveWorkingId('')
    }
  }

  const handleRestoreCancelled = async (row) => {
    if (!isCancelledRow(row) || voidingId) return
    const id = String(row.id)
    if (!window.confirm(`确认从垃圾桶恢复账单“${text(row.settlementNumber)}”吗？\n\n恢复后状态将回到“待处理”。`)) return
    setVoidingId(id)
    try {
      await transitionBillLifecycle('rd', id, 'pending', '从垃圾桶恢复账单')
      if (archivedIds.has(id)) await unarchiveBill('rd', id)
      await recon.refetchReconciliationFromApi?.()
      await refreshArchiveState(false)
      showToast('研发账单已从垃圾桶恢复为待处理', 'success')
    } catch (error) {
      console.error(error)
      showToast(error instanceof Error ? error.message : '恢复账单失败', 'error')
    } finally {
      setVoidingId('')
    }
  }

  const voidBill = async (row) => {
    if (isCancelledRow(row) || voidingId) return
    const reason = confirmRdBillDeletion(text(row.settlementNumber), {
      prompt: (message, value) => window.prompt(message, value),
      confirm: (message) => window.confirm(message),
      showError: (message) => showToast(message, 'error')
    })
    if (reason === null) return
    setVoidingId(String(row.id))
    try {
      await transitionBillLifecycle('rd', String(row.id), 'cancelled', reason.trim())
      await recon.refetchReconciliationFromApi?.()
      setSelectedIds((prev) => prev.filter((id) => id !== String(row.id)))
      showToast('研发账单已移入垃圾桶，主列表不再显示', 'success')
    } catch (error) {
      console.error(error)
      showToast(error instanceof Error ? error.message : '账单删除失败', 'error')
    } finally {
      setVoidingId('')
    }
  }

  const exportSelected = async () => {
    const target = selectedRows.length > 0 ? selectedRows : rows
    if (target.length === 0) {
      showToast('没有可导出的研发账单', 'error')
      return
    }
    setIsExporting(true)
    try {
      const {
        buildSettlementWorkbookFromSelected,
        resolveRdRecordsForSettlementExport,
        writeSettlementWorkbookToFile
      } = await import('@/domain/export/settlementConfirmationExport.js')
      const fullRecords = await resolveRdRecordsForSettlementExport(
        target,
        async (id) => apiRowToFrontend(await getReconciliationRecord(id))
      )
      const { wb, fileName } = buildSettlementWorkbookFromSelected(fullRecords, {
        partners: settings.partners
      })
      writeSettlementWorkbookToFile(wb, fileName)
      showToast(`已导出 ${target.length} 条研发账单`, 'success')
    } catch (error) {
      console.error(error)
      showToast('读取账单完整明细失败，未生成文件，请稍后重试', 'error')
    } finally {
      setIsExporting(false)
    }
  }

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const XLSX = await import('xlsx')
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const importedRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      const records = importedRows.map(mapRdImportRow).filter(Boolean)
      if (records.length === 0) {
        showToast('没有识别到可导入的研发对账数据', 'error')
        return
      }
      await recon.handleExcelImport(records)
      showToast(`已导入 ${records.length} 条研发账单`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导入失败，请检查 Excel 格式', 'error')
    }
  }

  const ledgerActions = (
    <div className="rd-ledger-actions" role="group" aria-label="研发账单操作">
      <button type="button" onClick={() => fileRef.current?.click()}>导入 Excel</button>
      <button type="button" onClick={exportSelected} disabled={isExporting}>
        {isExporting ? '正在读取…' : '导出'}
      </button>
      <button type="button" className="primary" onClick={() => {
        recon.setQuickFillData(null)
        setActiveView(VIEWS.RECON_CREATE)
      }}>新增账单</button>
    </div>
  )

  return (
    <PageContainer hideHeader className="core-recon-page core-rd-ledger-page">
      <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleImportFile} hidden />
      {headerActionsTarget ? createPortal(ledgerActions, headerActionsTarget) : ledgerActions}
      <section className="rd-ledger-filters" aria-label="研发账单筛选">
        <div className="rd-ledger-filters__main">
          <label><span>合作方</span>
            <select value={partner} aria-label="筛选研发合作方" onChange={event => setPartner(event.target.value)}>
              <option value="">全部合作方</option>
              {partnerOptions.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label><span>账期</span>
            <select value={month} aria-label="筛选账单月份" onChange={event => setMonth(event.target.value)}>
              <option value="">全部月份</option>
              {monthOptions.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}
            </select>
          </label>
          <label className="rd-ledger-filters__search"><span>搜索</span>
            <input type="search" value={query} onChange={event => setQuery(event.target.value)}
              aria-label="搜索研发账单" placeholder="合作方、游戏或账单编号" />
          </label>
          <button type="button" aria-expanded={showMoreFilters} aria-controls="rd-ledger-more-filters"
            onClick={() => setShowMoreFilters(value => !value)}>
            {showMoreFilters ? '收起筛选' : '更多筛选'}{status ? '（1）' : ''}
          </button>
          <button type="button" onClick={() => {
            setMonth(''); setPartner(''); setStatus(''); setQuery(''); setQuickFilter('all')
            setSelectedIds([]); setPage(1)
          }}>重置</button>
        </div>
        {showMoreFilters ? <div id="rd-ledger-more-filters" className="rd-ledger-filters__more">
          <label><span>账单状态</span>
            <select value={status} aria-label="筛选账单状态" onChange={event => {
              const next = event.target.value
              setStatus(next)
              if (next === 'cancelled') setQuickFilter('trash')
              else if (quickFilter === 'trash') setQuickFilter('all')
            }}>
              <option value="">全部状态</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div> : null}
      </section>

      <BillQuickFilters
        value={quickFilter}
        items={quickItems}
        onChange={handleQuickFilter}
        busyKey={dataDiffLoading ? 'data-diff' : ''}
      />

      <section className="rd-ledger-stats" aria-label="研发账单概览">
        {stats.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <div className="rd-ledger-stats__value"><strong>{item.value}</strong>
              {item.note && <small>{item.note}</small>}
            </div>
          </div>
        ))}
      </section>

      <section className="core-recon-panel rd-ledger-panel">
        <div className="rd-ledger-panel__head">
          <div>
            <h2>{quickFilter === 'trash' ? '垃圾桶' : quickFilter === 'archived' ? '归档账单' : '账单明细'}</h2>
            <span>筛选后 {rows.length} 张账单 · 每张原始账单只计一次</span>
          </div>
          <div className="rd-ledger-panel__controls">
            {selectedRows.length > 0 ? <span>已选 {selectedRows.length} 条</span> : null}
            <label>每页<select aria-label="每页研发账单数量" value={pageSize} onChange={event => setPageSize(Number(event.target.value))}>
              <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
            </select></label>
          </div>
        </div>
        <div className="rd-ledger-scroll">
          <table className="rd-finance-table" aria-label="研发账单">
            <colgroup>
              <col className="rd-finance-col-check" />
              <col className="rd-finance-col-period" />
              <col className="rd-finance-col-partner" />
              <col className="rd-finance-col-game" />
              <col className="rd-finance-col-settlement" />
              <col className="rd-finance-col-paid" />
              <col className="rd-finance-col-unpaid" />
              <col className="rd-finance-col-status" />
              <col className="rd-finance-col-actions" />
            </colgroup>
            <thead><tr>
              <th className="rd-ledger-check"><input type="checkbox" aria-label="选择当前页全部可操作账单"
                ref={element => { if (element) element.indeterminate = selectedPageCount > 0 && !allPageSelected }}
                checked={allPageSelected} disabled={!selectableRows.length}
                onChange={event => selectPage(event.target.checked)} /></th>
              <th scope="col">结算月份</th>
              <th scope="col">研发 / 合作方</th>
              <th scope="col">游戏 / 账单编号</th>
              <th scope="col" className="is-numeric">研发应结</th>
              <th scope="col" className="is-numeric">已付</th>
              <th scope="col" className="is-numeric">未付</th>
              <th scope="col">核对 / 付款</th>
              <th scope="col">操作</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="core-recon-empty">
                    {quickFilter === 'data-diff' && dataDiffLoading
                      ? '正在批量核对 QuickSDK 数据差异…'
                      : quickFilter === 'trash'
                        ? '垃圾桶为空'
                        : quickFilter === 'archived'
                          ? '暂无归档账单'
                          : '暂无研发账单'}
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const periodLabel = rdRecordSettlementPeriodLabel(row)
                  const periodCount = getRdRecordSettlementPeriods(row).length
                  const games = gameText(row).split('、').filter(Boolean)
                  const prepayment = recordPrepaymentDeduction(row)
                  const { paid, unpaid } = paymentAmounts(row)
                  const isCancelled = isCancelledRow(row)
                  const archived = archivedIds.has(String(row.id))
                  const canArchive = eligibleIds.has(String(row.id))
                  const closure = listFundingClosureStatus({
                    amount: recordActualPayable(row),
                    paid,
                    lifecycleStatus: row.status,
                    archived
                  })
                  return (
                    <tr
                      key={row.id}
                      className={selectedIds.includes(String(row.id)) ? 'is-selected' : ''}
                    >
                      <td className="rd-ledger-check">
                        <input type="checkbox" aria-label={`选择账单 ${text(row.settlementNumber)}`}
                          checked={selectedIds.includes(String(row.id))} disabled={archived || isCancelled}
                          onChange={() => toggleSelected(row.id)} />
                      </td>
                      <td className="rd-ledger-period" title={periodLabel}>
                        {periodLabel.replace(/(\d{4})年(\d{1,2})月/g, (_, year, value) => `${year}-${value.padStart(2, '0')}`)}
                        {periodCount > 1 ? <small>跨月账单</small> : null}
                      </td>
                      <td className="rd-ledger-partner">
                        <strong title={text(row.partnerShortName || row.partner || row.partyBName)}>
                          {text(row.partnerShortName || row.partner || row.partyBName)}
                        </strong>
                        <small title={text(row.partner || row.partyBName)}>{text(row.partner || row.partyBName)}</small>
                      </td>
                      <td className="rd-ledger-game">
                        <strong title={text(gameText(row))}>
                          {games.slice(0, 2).join('、') || '—'}{games.length > 2 ? ` +${games.length - 2}` : ''}
                        </strong>
                        <small title={text(row.settlementNumber)}>{text(row.settlementNumber)}</small>
                      </td>
                      <td className="is-numeric" title={prepayment > 0.01 ? `预付款抵扣 ${money(prepayment)} · 实际应付 ${money(recordActualPayable(row))}` : undefined}>
                        {money(recordSettlementAmount(row))}
                        {prepayment > 0.01 ? <small className="rd-ledger-deduction">抵扣 {money(prepayment)}</small> : null}
                      </td>
                      <td className="is-numeric">{money(paid)}</td>
                      <td className={`is-numeric ${unpaid > 0.01 ? 'has-unpaid' : ''}`}>{money(unpaid)}</td>
                      <td>
                        <span className={`rd-finance-status is-${closure.tone}`} title={`${closure.detail} · ${STATUS_LABELS[row.status] || row.status || '待处理'}`}>
                          <strong>{closure.label}</strong>
                        </span>
                      </td>
                      <td>
                        <div className="rd-finance-actions">
                          <button type="button" onMouseEnter={() => prefetchBill360?.('rd', String(row.id))}
                            onFocus={() => prefetchBill360?.('rd', String(row.id))}
                            onClick={() => openBill360?.('rd', String(row.id), row)}>详情</button>
                          {isCancelled ? (
                            <button type="button" disabled={voidingId === String(row.id)} onClick={() => void handleRestoreCancelled(row)}>
                              {voidingId === String(row.id) ? '处理中…' : '恢复账单'}
                            </button>
                          ) : archived ? (
                            <button type="button" disabled={archiveWorkingId === String(row.id)} onClick={() => void handleUnarchive(row)}>
                              {archiveWorkingId === String(row.id) ? '处理中…' : '取消归档'}
                            </button>
                          ) : (
                            <>
                              {canArchive ? (
                                <button type="button" disabled={Boolean(archiveWorkingId)} onClick={() => void handleArchive(row)}>
                                  {archiveWorkingId === String(row.id) ? '归档中…' : '归档'}
                                </button>
                              ) : null}
                              <button type="button" onClick={() => openReconciliationEdit(String(row.id))}>
                                编辑
                              </button>
                              <button
                                type="button"
                                className="danger"
                                disabled={Boolean(voidingId)}
                                title="删除需两次确认；删除后移入垃圾桶，历史、关联关系和操作日志保留，可恢复"
                                onClick={() => void voidBill(row)}
                              >
                                {voidingId === String(row.id) ? '删除中…' : '删除'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <footer className="rd-ledger-footer">
          <span>{rows.length ? `显示第 ${offset + 1}–${offset + visibleRows.length} 条，共 ${rows.length} 条` : '0 条账单'} · 金额按全部筛选结果统计</span>
          <div>
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
            <strong>{currentPage} / {totalPages}</strong>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>下一页</button>
          </div>
        </footer>
      </section>
    </PageContainer>
  )
}


function readAny(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') return row[name]
  }
  return ''
}

function mapRdImportRow(row) {
  const game = String(readAny(row, ['游戏', '游戏项目', '产品', '项目'])).trim()
  const gameFlow = Number(readAny(row, ['游戏流水', '流水', '充值金额', '后台流水']) || 0)
  if (!game && !gameFlow) return null
  const settlementCycle = String(readAny(row, ['结算月份', '月份', '账期'])).trim()
  return {
    settlementMonth: settlementCycle,
    partner: String(readAny(row, ['合作方', '客户', '研发商'])).trim(),
    game,
    gameFlow,
    testingFee: Number(readAny(row, ['测试费', '平台币', '测试费用']) || 0),
    voucher: Number(readAny(row, ['代金券', '券成本']) || 0),
    channelFeeRate: Number(readAny(row, ['通道费率', '渠道费率']) || 0),
    taxPoint: Number(readAny(row, ['税点', '税率']) || 0),
    revenueShareRatio: Number(readAny(row, ['分成比例', '合作方分成比例']) || 0),
    discount: Number(readAny(row, ['折扣', '折扣系数']) || 1),
    refund: Number(readAny(row, ['退款', '额外费用']) || 0),
    items: [
      {
        settlementCycle,
        gameName: game,
        revenue: gameFlow,
        discountRate: Number(readAny(row, ['折扣', '折扣系数']) || 1),
        couponAmount: Number(readAny(row, ['代金券', '券成本']) || 0),
        testFee: Number(readAny(row, ['测试费', '平台币', '测试费用']) || 0),
        extraFee: Number(readAny(row, ['退款', '额外费用']) || 0),
        shareRatio: Number(readAny(row, ['分成比例', '合作方分成比例']) || 0),
        taxRate: Number(readAny(row, ['税点', '税率']) || 0),
        sortOrder: 0
      }
    ],
    status: 'pending'
  }
}

export default CoreReconciliationPage
