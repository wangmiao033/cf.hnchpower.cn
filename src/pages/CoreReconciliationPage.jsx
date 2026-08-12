import React, { useEffect, useMemo, useRef, useState } from 'react'
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
import { getQuickSdkGameFlow } from '@/lib/api/quicksdk.ts'
import { transitionBillLifecycle } from '@/lib/api/billLifecycle.ts'
import { listFundingClosureStatus } from '@/domain/reconciliation/closureStatus.js'
import { archiveBill, getBillArchiveSnapshot, unarchiveBill } from '@/lib/api/billArchive.ts'
import './CoreReconciliationPages.css'
import '@/components/reconciliation/reconciliation-admin.css'

const STATUS_LABELS = {
  pending: '待处理',
  confirmed: '已确认',
  completed: '已完成',
  cancelled: '已取消',
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

function paymentAmounts(row) {
  const paid = Math.max(0, Number(row?.paidAmount || 0))
  const storedUnpaid = Number(row?.unpaidAmount)
  const fallbackUnpaid = recordSettlementAmount(row) - paid
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

function CoreReconciliationPage() {
  const {
    recon,
    settings,
    showToast,
    setActiveView,
    openReconciliationEdit,
    openBill360
  } = useAppState()
  const fileRef = useRef(null)
  const [month, setMonth] = useState('')
  const [partner, setPartner] = useState('')
  const [partnerDraft, setPartnerDraft] = useState('')
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

  const activeRows = useMemo(
    () => scopedRows.filter((row) => !archivedIds.has(String(row.id))),
    [scopedRows, archivedIds]
  )

  const rows = useMemo(() => {
    if (quickFilter === 'archived') return scopedRows.filter((row) => archivedIds.has(String(row.id)))
    if (quickFilter === 'all') return activeRows
    return activeRows.filter((row) => {
      if (String(row.status || '') === 'cancelled') return false
      const { paid, unpaid } = paymentAmounts(row)
      if (quickFilter === 'unpaid') return unpaid > 0.01 && paid <= 0.01
      if (quickFilter === 'partial') return paid > 0.01 && unpaid > 0.01
      if (quickFilter === 'settled') return eligibleIds.has(String(row.id))
      if (quickFilter === 'data-diff') return Boolean(dataDiffIds?.has(String(row.id)))
      return true
    })
  }, [activeRows, scopedRows, quickFilter, dataDiffIds, archivedIds, eligibleIds])

  const selectedRows = useMemo(
    () => rows.filter((row) => !archivedIds.has(String(row.id)) && selectedIds.includes(String(row.id))),
    [rows, selectedIds, archivedIds]
  )

  const quickItems = useMemo(() => [
    { key: 'all', label: '全部', count: activeRows.length },
    {
      key: 'unpaid',
      label: '未付款',
      count: activeRows.filter((row) => String(row.status || '') !== 'cancelled' && paymentAmounts(row).unpaid > 0.01 && paymentAmounts(row).paid <= 0.01).length
    },
    {
      key: 'partial',
      label: '部分付款',
      count: activeRows.filter((row) => {
        const amount = paymentAmounts(row)
        return String(row.status || '') !== 'cancelled' && amount.paid > 0.01 && amount.unpaid > 0.01
      }).length
    },
    { key: 'settled', label: '已结清', count: activeRows.filter((row) => eligibleIds.has(String(row.id))).length },
    { key: 'data-diff', label: '数据差异', count: dataDiffIds ? activeRows.filter((row) => dataDiffIds.has(String(row.id))).length : null },
    { key: 'archived', label: '归档账单', count: archiveLoading ? null : scopedRows.filter((row) => archivedIds.has(String(row.id))).length }
  ], [activeRows, scopedRows, dataDiffIds, archivedIds, eligibleIds, archiveLoading])

  const stats = useMemo(() => {
    const total = rows.reduce((sum, row) => sum + recordSettlementAmount(row), 0)
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
      { label: '研发应付', value: money(total) },
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
      const results = await Promise.all((recon.records || []).map(async (row) => {
        if (String(row.status || '') === 'cancelled') return [String(row.id), false]
        const keys = bill360QuickSdkKeys('rd', row)
        if (!keys.length) return [String(row.id), false]
        const quickRows = await Promise.all(keys.map(async (key) => {
          try {
            return await getQuickSdkGameFlow({ settlement_month: key.month, game_name: key.game })
          } catch {
            return null
          }
        }))
        if (!quickRows.some(Boolean)) return [String(row.id), false]
        const databaseFlow = quickRows.reduce((sum, item) => sum + Number(item?.total_flow || 0), 0)
        const billFlow = bill360Lines('rd', row).reduce((sum, line) => sum + Number(line.flow || 0), 0)
        return [String(row.id), Math.abs(databaseFlow - billFlow) > 0.01]
      }))
      setDataDiffIds(new Set(results.filter(([, different]) => different).map(([id]) => id)))
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

  const voidBill = async (row) => {
    if (String(row.status || '') === 'cancelled' || voidingId) return
    const reason = window.prompt(`请输入作废账单“${text(row.settlementNumber)}”的原因：`, '')
    if (reason === null) return
    if (!reason.trim()) {
      showToast('作废账单必须填写原因', 'error')
      return
    }
    setVoidingId(String(row.id))
    try {
      await transitionBillLifecycle('rd', String(row.id), 'cancelled', reason.trim())
      await recon.refetchReconciliationFromApi?.()
      setSelectedIds((prev) => prev.filter((id) => id !== String(row.id)))
      showToast('研发账单已作废，历史记录已保留', 'success')
    } catch (error) {
      console.error(error)
      showToast(error instanceof Error ? error.message : '账单作废失败', 'error')
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

  return (
    <PageContainer hideHeader className="core-recon-page">
      <section className="core-recon-workbar">
        <div className="core-recon-head">
          <div className="core-recon-title">
            <span className="core-recon-title-mark" aria-hidden="true">研</span>
            <div>
              <h1>研发账单</h1>
              <span>{rows.length} 笔账单</span>
            </div>
          </div>
          <div className="core-recon-actions">
            <button type="button" onClick={() => fileRef.current?.click()}>导入 Excel</button>
            <button type="button" onClick={exportSelected} disabled={isExporting}>
              {isExporting ? '正在读取…' : '导出'}
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                recon.setQuickFillData(null)
                setActiveView(VIEWS.RECON_CREATE)
              }}
            >
              新增账单
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleImportFile} hidden />
          </div>
        </div>
        <div className="core-recon-filters">
          <label className="core-recon-filter-control">
            <span>月份</span>
            <select
              value={month}
              aria-label="筛选账单月份"
              onChange={(event) => setMonth(event.target.value)}
            >
              <option value="">全部月份</option>
              {monthOptions.map((value) => (
                <option key={value} value={value}>{monthLabel(value)}</option>
              ))}
            </select>
          </label>
          <div className="core-recon-filter-control core-recon-partner-filter">
            <span>客户</span>
            <input
              type="search"
              list="core-recon-partner-options"
              value={partnerDraft}
              onChange={(event) => setPartnerDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  setPartner(partnerDraft.trim())
                  setSelectedIds([])
                }
              }}
              placeholder="输入名称或简称"
              aria-label="搜索合作方"
            />
            <datalist id="core-recon-partner-options">
              {partnerOptions.map((name) => <option key={name} value={name} />)}
            </datalist>
            <button
              type="button"
              className="core-recon-partner-submit"
              onClick={() => {
                setPartner(partnerDraft.trim())
                setSelectedIds([])
              }}
            >
              搜索
            </button>
          </div>
          <label className="core-recon-filter-control">
            <span>状态</span>
            <select
              value={status}
              aria-label="筛选账单状态"
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">全部状态</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="core-recon-filter-control core-recon-filter-search">
            <span>关键词</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="编号、客户或产品"
            />
          </label>
          <button type="button" className="core-recon-reset" onClick={() => {
            setMonth('')
            setPartner('')
            setPartnerDraft('')
            setStatus('')
            setQuery('')
            setQuickFilter('all')
            setSelectedIds([])
          }}>
            重置
          </button>
        </div>
      </section>

      <BillQuickFilters
        value={quickFilter}
        items={quickItems}
        onChange={handleQuickFilter}
        busyKey={dataDiffLoading ? 'data-diff' : ''}
      />

      <section className="core-recon-stats">
        {stats.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.note && <small>{item.note}</small>}
          </div>
        ))}
      </section>

      <section className="core-recon-panel">
        <div className="core-recon-panel-head">
          <h2>{quickFilter === 'archived' ? '归档账单' : '账单列表'}</h2>
          <span>{selectedRows.length > 0 ? `已选 ${selectedRows.length} 条` : `${rows.length} 条`}</span>
        </div>
        <div className="core-recon-table-wrap">
          <table className="core-recon-table core-rd-recon-table">
            <colgroup>
              <col className="core-rd-col-month" />
              <col className="core-rd-col-number" />
              <col className="core-rd-col-partner" />
              <col className="core-rd-col-game" />
              <col className="core-rd-col-flow" />
              <col className="core-rd-col-share" />
              <col className="core-rd-col-settlement" />
              <col className="core-rd-col-received" />
              <col className="core-rd-col-status" />
              <col className="core-rd-col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>账单月份</th>
                <th>编号</th>
                <th>客户简称</th>
                <th>产品</th>
                <th className="core-recon-align-right">流水</th>
                <th className="core-recon-align-right">分成比例</th>
                <th className="core-recon-align-right">结算金额</th>
                <th className="core-recon-align-right">已付 / 未付</th>
                <th>闭环状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="core-recon-empty">
                    {quickFilter === 'data-diff' && dataDiffLoading ? '正在核对 QuickSDK 数据差异…' : quickFilter === 'archived' ? '暂无归档账单' : '暂无研发账单'}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const periodLabel = rdRecordSettlementPeriodLabel(row)
                  const periodCount = getRdRecordSettlementPeriods(row).length
                  const { paid, unpaid } = paymentAmounts(row)
                  const isCancelled = String(row.status || '') === 'cancelled'
                  const archived = archivedIds.has(String(row.id))
                  const canArchive = eligibleIds.has(String(row.id))
                  const closure = listFundingClosureStatus({
                    amount: recordSettlementAmount(row),
                    paid,
                    lifecycleStatus: row.status,
                    archived
                  })
                  return (
                    <tr
                      key={row.id}
                      className={selectedIds.includes(String(row.id)) ? 'is-selected' : ''}
                    >
                      <td className="core-rd-month-cell" title={periodLabel}>
                        <input
                          type="checkbox"
                          aria-label={`选择账单 ${text(row.settlementNumber)}`}
                          checked={selectedIds.includes(String(row.id))}
                          disabled={archived}
                          onChange={() => toggleSelected(row.id)}
                        />
                        <span>{periodLabel}</span>
                        {periodCount > 1 ? <em className="core-rd-period-badge">多周期</em> : null}
                      </td>
                      <td>{text(row.settlementNumber)}</td>
                      <td>
                        <strong
                          className="core-recon-partner-short-name"
                          title={text(row.partner || row.partyBName)}
                        >
                          {text(row.partnerShortName || row.partner || row.partyBName)}
                        </strong>
                      </td>
                      <td>
                        <span className="core-recon-game-text" title={text(gameText(row))}>
                          {text(gameText(row))}
                        </span>
                      </td>
                      <td className="core-recon-money">
                        {money(row.gameFlow || sumItems(row, 'revenue'))}
                      </td>
                      <td className="core-recon-rate">
                        {text(row.revenueShareRatio != null ? `${row.revenueShareRatio}%` : '')}
                      </td>
                      <td className="core-recon-money core-recon-money--settlement">
                        {money(recordSettlementAmount(row))}
                      </td>
                      <td
                        className="core-recon-money core-recon-money--received"
                        title={row.paymentStatus || '未付款'}
                      >
                        <strong style={{ display: 'block', fontWeight: 700 }}>{money(paid)}</strong>
                        <small style={{ display: 'block', marginTop: 2, color: '#8a98aa', fontSize: 10 }}>未付 {money(unpaid)}</small>
                      </td>
                      <td>
                        <span className={`v4-list-closure is-${closure.tone}`}>
                          <strong>{closure.label}</strong>
                          <small>{closure.detail} · {STATUS_LABELS[row.status] || row.status || '待处理'}</small>
                        </span>
                      </td>
                      <td>
                        <div className="core-recon-row-actions">
                          <button type="button" onClick={() => openBill360('rd', String(row.id), row)}>
                            360°
                          </button>
                          {archived ? (
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
                                disabled={isCancelled || voidingId === String(row.id)}
                                title={isCancelled ? '账单已作废' : '作废会保留账单、关联关系和操作日志'}
                                onClick={() => void voidBill(row)}
                              >
                                {isCancelled ? '已作废' : voidingId === String(row.id) ? '作废中…' : '作废'}
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
      </section>
    </PageContainer>
  )
}

function sumItems(row, field) {
  if (!Array.isArray(row.items)) return 0
  return row.items.reduce((sum, item) => sum + Number(item[field] || 0), 0)
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
