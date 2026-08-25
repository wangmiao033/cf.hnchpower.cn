import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import BillQuickFilters from '@/components/reconciliation/BillQuickFilters.jsx'
import ChannelReceiptDrawer from '@/components/channel/ChannelReceiptDrawer.jsx'
import { VIEWS } from '@/app/routes.js'
import {
  buildChannelBillFromSingleGameForm,
  normalizeChannelSettlementCycle
} from '@/domain/channel/channelBillingForm.js'
import {
  getChannelReceivedAmount,
  getChannelTotals,
  isChannelReceiptSettled,
  sumChannelNumericLines
} from '@/domain/channel/channelAggregates.js'
import { parseChannelStatementWorkbook } from '@/domain/channel/channelStatementImport.js'
import { getChannelBillNumber } from '@/utils/channelBillNumber.js'
import { transitionBillLifecycle } from '@/lib/api/billLifecycle.ts'
import { archiveBill, getBillArchiveSnapshot, unarchiveBill } from '@/lib/api/billArchive.ts'
import '@/components/reconciliation/reconciliation-admin.css'
import './CoreReconciliationPages.css'
import './ChannelGroupedLedger.css'

const STATUS_LABELS = {
  pending: '待处理',
  confirmed: '已确认',
  completed: '已完成',
  cancelled: '已作废'
}

const STATUS_PRIORITY = {
  anomaly: 4,
  unpaid: 3,
  partial: 2,
  settled: 1,
  archived: 0,
  void: 0
}

function money(value) {
  const n = Number(value || 0)
  return `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function text(value, fallback = '-') {
  const raw = value == null ? '' : String(value).trim()
  return raw || fallback
}

function monthKey(value) {
  return normalizeChannelSettlementCycle(value)
}

function monthLabel(value) {
  const normalized = monthKey(value)
  const match = normalized.match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : normalized
}

function channelMonths(record) {
  const fromItems = Array.isArray(record?.items)
    ? record.items.map((item) => monthKey(item?.settlementCycle)).filter(Boolean)
    : []
  const values = fromItems.length ? fromItems : [monthKey(record?.settlementMonth)].filter(Boolean)
  return [...new Set(values)].sort()
}

function channelPeriodLabel(record) {
  const months = channelMonths(record)
  if (!months.length) return '-'
  if (months.length === 1) return monthLabel(months[0])
  const short = (value) => value.replace('-', '.')
  return `${short(months[0])}–${short(months[months.length - 1])} · ${months.length}个月`
}

function groupPeriodLabel(values) {
  const months = [...new Set(values || [])].filter(Boolean).sort()
  if (!months.length) return '-'
  if (months.length === 1) return monthLabel(months[0])
  const short = (value) => String(value).replace('-', '.')
  return `${short(months[0])}–${short(months[months.length - 1])}`
}

function channelGames(record) {
  const rawNames = Array.isArray(record?.items) && record.items.length > 0
    ? record.items.map((item) => item?.gameName)
    : String(record?.gameName || '').split(/[、,，]/)
  const seen = new Set()
  const names = []
  rawNames.forEach((value) => {
    const name = String(value || '').trim()
    if (!name || seen.has(name)) return
    seen.add(name)
    names.push(name)
  })
  return names
}

function compactGameLabel(games, visibleCount = 2) {
  const names = Array.isArray(games) ? games.filter(Boolean) : []
  if (!names.length) return '-'
  const visible = names.slice(0, visibleCount).join('、')
  const hiddenCount = Math.max(0, names.length - visibleCount)
  return hiddenCount > 0 ? `${visible} +${hiddenCount}` : visible
}

function channelPaymentAmounts(row) {
  const totals = getChannelTotals(row)
  const received = Math.max(0, getChannelReceivedAmount(row))
  return {
    settlement: Number(totals.settlementAmount || 0),
    received,
    unpaid: Math.max(0, Number(totals.settlementAmount || 0) - received)
  }
}

function channelHasDataDifference(row) {
  const headerDiff = Number(row?.settlementDifference)
  if (String(row?.validationStatus || '') === 'fail') return true
  if (Number.isFinite(headerDiff) && Math.abs(headerDiff) > 0.01) return true
  return Array.isArray(row?.items) && row.items.some((item) => {
    if (String(item?.validationStatus || '') === 'fail') return true
    const difference = Number(item?.settlementDifference)
    return Number.isFinite(difference) && Math.abs(difference) > 0.01
  })
}

function isCancelledRow(row) {
  const current = String(row?.status || '').trim().toLowerCase()
  return current === 'cancelled' || current === 'canceled'
}

function channelPaymentStatus(row, { received, settled, cancelled, archived = false }) {
  if (cancelled) return { tone: 'void', label: '已作废' }
  if (archived) return { tone: 'settled', label: '已归档' }
  if (channelHasDataDifference(row)) return { tone: 'anomaly', label: '异常' }
  if (settled) return { tone: 'settled', label: '已结清' }
  if (Number(received || 0) > 0.01) return { tone: 'partial', label: '部分收款' }
  return { tone: 'unpaid', label: '未收款' }
}

function groupKeyForRow(row) {
  return text(row?.channelName, '未命名渠道').trim().toLocaleLowerCase('zh-CN')
}

function readAny(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') return row[name]
  }
  return ''
}

function mapChannelImportRow(row) {
  const channelName = String(readAny(row, ['渠道', '渠道名称', 'channel'])).trim()
  const gameName = String(readAny(row, ['游戏', '产品', '游戏项目', '产品名称'])).trim()
  const flow = Number(readAny(row, ['计费流水', '流水', '后台流水', '充值金额']) || 0)
  const settlementCycle = String(readAny(row, ['月份', '结算月份', '结算时间', '账期'])).trim()
  if (!channelName && !gameName && !flow) return null
  return buildChannelBillFromSingleGameForm({
    channelName,
    partnerName: String(readAny(row, ['合作方', '客户', '结算方'])).trim(),
    settlementMonth: settlementCycle,
    settlementCycle,
    startDate: String(readAny(row, ['开始日期', '开始时间'])).trim(),
    endDate: String(readAny(row, ['结束日期', '结束时间'])).trim(),
    remark: String(readAny(row, ['备注'])).trim(),
    gameName,
    flow,
    discountFactor: Number(readAny(row, ['折扣', '折扣系数']) || 1),
    voucherCost: Number(readAny(row, ['代金券', '券成本']) || 0),
    noWorryCost: Number(readAny(row, ['无忧成本', '无忧券']) || 0),
    refundCost: Number(readAny(row, ['退款', '退款成本']) || 0),
    testCost: Number(readAny(row, ['测试费', '测试成本']) || 0),
    welfareCost: Number(readAny(row, ['福利成本', '福利']) || 0),
    shareRate: Number(readAny(row, ['分成比例', '渠道分成比例']) || 30),
    taxRate: Number(readAny(row, ['税率', '税点']) || 5),
    gatewayCost: Number(readAny(row, ['通道费', '通道成本']) || 0),
    settlementAmount: readAny(row, ['渠道应收', '结算金额']) || ''
  })
}

function CoreChannelReconciliationGroupedPage() {
  const {
    recon,
    settings,
    showToast,
    setActiveView,
    openChannelReconciliationEdit,
    openBill360,
    prefetchBill360
  } = useAppState()

  const fileRef = useRef(null)
  const [month, setMonth] = useState('')
  const [channel, setChannel] = useState('')
  const [channelDraft, setChannelDraft] = useState('')
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [quickFilter, setQuickFilter] = useState('all')
  const [selectedIds, setSelectedIds] = useState([])
  const [expandedKeys, setExpandedKeys] = useState([])
  const [isWorking, setIsWorking] = useState(false)
  const [receiptRecord, setReceiptRecord] = useState(null)
  const [archiveState, setArchiveState] = useState({ archived_ids: [], eligible_ids: [], items: [], auto_archive_days: 7 })
  const [archiveLoading, setArchiveLoading] = useState(true)
  const [archiveWorkingId, setArchiveWorkingId] = useState('')

  const archivedIds = useMemo(() => new Set((archiveState.archived_ids || []).map(String)), [archiveState])
  const eligibleIds = useMemo(() => new Set((archiveState.eligible_ids || []).map(String)), [archiveState])
  const expandedChannels = useMemo(() => new Set(expandedKeys), [expandedKeys])

  const refreshArchiveState = async (announceAuto = false) => {
    setArchiveLoading(true)
    try {
      const snapshot = await getBillArchiveSnapshot('channel', true)
      setArchiveState(snapshot)
      if (announceAuto && Number(snapshot.auto_archived_count || 0) > 0) {
        showToast(`已自动归档 ${snapshot.auto_archived_count} 张结清满 ${snapshot.auto_archive_days || 7} 天的渠道账单`, 'info')
      }
    } catch (error) {
      console.error(error)
      setArchiveState((current) => ({ ...current, archived_ids: current.archived_ids || [], eligible_ids: current.eligible_ids || [] }))
    } finally {
      setArchiveLoading(false)
    }
  }

  useEffect(() => {
    void refreshArchiveState(true)
  }, [recon.channelRecords])

  const monthOptions = useMemo(
    () => [...new Set((recon.channelRecords || []).flatMap(channelMonths))].sort((a, b) => b.localeCompare(a)),
    [recon.channelRecords]
  )

  const channelOptions = useMemo(
    () => [...new Set((recon.channelRecords || []).map((row) => text(row.channelName, '')).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [recon.channelRecords]
  )

  const scopedRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const channelQuery = channel.trim().toLowerCase()
    return (recon.channelRecords || []).filter((row) => {
      const rowMonths = channelMonths(row)
      const matchesMonth = !month || rowMonths.includes(month)
      const matchesChannel = !channelQuery || text(row.channelName, '').toLowerCase().includes(channelQuery)
      const matchesStatus = !status || String(row.status || 'pending') === status
      const haystack = [
        getChannelBillNumber(row), row.channelName, row.partnerName,
        ...channelGames(row), ...rowMonths, row.remark
      ].filter(Boolean).join(' ').toLowerCase()
      return matchesMonth && matchesChannel && matchesStatus && (!q || haystack.includes(q))
    })
  }, [recon.channelRecords, month, channel, status, query])

  const trashRows = useMemo(() => scopedRows.filter(isCancelledRow), [scopedRows])
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
      const amounts = channelPaymentAmounts(row)
      if (quickFilter === 'unpaid') return amounts.unpaid > 0.01 && amounts.received <= 0.01
      if (quickFilter === 'partial') return amounts.received > 0.01 && amounts.unpaid > 0.01
      if (quickFilter === 'settled') return eligibleIds.has(String(row.id))
      if (quickFilter === 'data-diff') return channelHasDataDifference(row)
      return true
    })
  }, [activeRows, archivedRows, trashRows, quickFilter, eligibleIds])

  const selectableRows = useMemo(
    () => rows.filter((row) => !archivedIds.has(String(row.id)) && !isCancelledRow(row)),
    [rows, archivedIds]
  )
  const selectedRows = useMemo(
    () => selectableRows.filter((row) => selectedIds.includes(String(row.id))),
    [selectableRows, selectedIds]
  )
  const allVisibleSelected = selectableRows.length > 0 && selectedRows.length === selectableRows.length
  const partiallyVisibleSelected = selectedRows.length > 0 && !allVisibleSelected

  const groups = useMemo(() => {
    const grouped = new Map()

    rows.forEach((row) => {
      const key = groupKeyForRow(row)
      const channelName = text(row.channelName, '未命名渠道')
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          channelName,
          rows: [],
          partners: new Set(),
          months: new Set(),
          settlement: 0,
          received: 0,
          unpaid: 0,
          statusCounts: { anomaly: 0, unpaid: 0, partial: 0, settled: 0, archived: 0, void: 0 },
          priority: 0
        })
      }

      const group = grouped.get(key)
      const totals = getChannelTotals(row)
      const received = Math.max(0, getChannelReceivedAmount(row))
      const unpaid = Math.max(0, Number(totals.settlementAmount || 0) - received)
      const archived = archivedIds.has(String(row.id))
      const cancelled = isCancelledRow(row)
      const settled = isChannelReceiptSettled(row)
      const rowStatus = channelPaymentStatus(row, { received, settled, cancelled, archived })
      const partnerName = text(row.partnerName, '')

      group.rows.push(row)
      if (partnerName) group.partners.add(partnerName)
      channelMonths(row).forEach((value) => group.months.add(value))
      group.settlement += Number(totals.settlementAmount || 0)
      group.received += received
      group.unpaid += unpaid
      if (group.statusCounts[rowStatus.tone] != null) group.statusCounts[rowStatus.tone] += 1
      group.priority = Math.max(group.priority, STATUS_PRIORITY[rowStatus.tone] || 0)
    })

    return [...grouped.values()]
      .map((group) => {
        const partnerNames = [...group.partners]
        let summaryStatus
        if (quickFilter === 'archived') summaryStatus = { tone: 'settled', label: '已归档' }
        else if (group.statusCounts.anomaly > 0) summaryStatus = { tone: 'anomaly', label: `异常 ${group.statusCounts.anomaly}张` }
        else if (group.statusCounts.unpaid > 0) summaryStatus = { tone: 'unpaid', label: `未收 ${group.statusCounts.unpaid}张` }
        else if (group.statusCounts.partial > 0) summaryStatus = { tone: 'partial', label: `部分收 ${group.statusCounts.partial}张` }
        else if (group.statusCounts.void > 0) summaryStatus = { tone: 'void', label: '已作废' }
        else summaryStatus = { tone: 'settled', label: '已结清' }

        return {
          ...group,
          partnerLabel: partnerNames.length > 1 ? `${partnerNames[0]} +${partnerNames.length - 1}` : partnerNames[0] || '-',
          partnerTitle: partnerNames.join('、') || '-',
          periodLabel: groupPeriodLabel([...group.months]),
          summaryStatus
        }
      })
      .sort((left, right) => {
        if (right.priority !== left.priority) return right.priority - left.priority
        if (Math.abs(right.unpaid - left.unpaid) > 0.01) return right.unpaid - left.unpaid
        return left.channelName.localeCompare(right.channelName, 'zh-CN')
      })
  }, [rows, archivedIds, quickFilter])

  const quickItems = useMemo(() => [
    { key: 'all', label: '全部', count: activeRows.length },
    {
      key: 'unpaid', label: '未收款', count: activeRows.filter((row) => {
        const amounts = channelPaymentAmounts(row)
        return amounts.unpaid > 0.01 && amounts.received <= 0.01
      }).length
    },
    {
      key: 'partial', label: '部分收款', count: activeRows.filter((row) => {
        const amounts = channelPaymentAmounts(row)
        return amounts.received > 0.01 && amounts.unpaid > 0.01
      }).length
    },
    { key: 'settled', label: '已结清', count: activeRows.filter((row) => eligibleIds.has(String(row.id))).length },
    { key: 'data-diff', label: '数据差异', count: activeRows.filter(channelHasDataDifference).length },
    { key: 'trash', label: '垃圾桶', count: trashRows.length },
    { key: 'archived', label: '归档账单', count: archiveLoading ? null : archivedRows.length }
  ], [activeRows, archivedRows, trashRows, eligibleIds, archiveLoading])

  const stats = useMemo(() => {
    const settlement = rows.reduce((sum, row) => sum + getChannelTotals(row).settlementAmount, 0)
    const received = rows.reduce((sum, row) => sum + getChannelReceivedAmount(row), 0)
    const unpaid = Math.max(0, settlement - received)
    const channels = new Set(rows.map((row) => text(row.channelName, '')).filter(Boolean))
    const games = new Set(rows.flatMap(channelGames))
    return [
      { label: '账单数量', value: rows.length },
      { label: '渠道', value: channels.size, note: `${games.size} 个产品` },
      { label: '渠道应收', value: money(settlement) },
      { label: '未收', value: money(unpaid), note: `已收 ${money(received)}` }
    ]
  }, [rows])

  const toggleSelected = (id) => {
    const sid = String(id)
    setSelectedIds((prev) => (prev.includes(sid) ? prev.filter((item) => item !== sid) : [...prev, sid]))
  }

  const toggleSelectAll = () => {
    const visibleIds = selectableRows.map((row) => String(row.id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return [...next]
    })
  }

  const toggleGroupSelected = (groupRows) => {
    const ids = (groupRows || [])
      .filter((row) => !archivedIds.has(String(row.id)) && !isCancelledRow(row))
      .map((row) => String(row.id))
    if (!ids.length) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const remove = ids.every((id) => next.has(id))
      ids.forEach((id) => {
        if (remove) next.delete(id)
        else next.add(id)
      })
      return [...next]
    })
  }

  const allGroupsExpanded = groups.length > 0 && groups.every((group) => expandedChannels.has(group.key))
  const toggleGroup = (key) => setExpandedKeys((prev) => (
    prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
  ))
  const toggleAllGroups = () => setExpandedKeys(allGroupsExpanded ? [] : groups.map((group) => group.key))

  const handleQuickFilter = (key) => {
    setQuickFilter(key)
    if (key === 'trash') setStatus('cancelled')
    else if (status === 'cancelled') setStatus('')
    setSelectedIds([])
    setExpandedKeys([])
  }

  const handleArchive = async (row) => {
    const id = String(row.id)
    if (archiveWorkingId) return
    setArchiveWorkingId(id)
    try {
      await archiveBill('channel', id)
      await refreshArchiveState(false)
      showToast('渠道账单已归档，默认列表不再显示', 'success')
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
      await unarchiveBill('channel', id)
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
    if (!isCancelledRow(row) || isWorking) return
    const id = String(row.id)
    if (!window.confirm(`确认从垃圾桶恢复账单“${getChannelBillNumber(row)}”吗？\n\n恢复后状态将回到“待处理”。`)) return
    setIsWorking(true)
    try {
      await transitionBillLifecycle('channel', id, 'pending', '从垃圾桶恢复账单')
      if (archivedIds.has(id)) await unarchiveBill('channel', id)
      await recon.refetchChannelFromApi?.()
      await refreshArchiveState(false)
      showToast('渠道账单已从垃圾桶恢复为待处理', 'success')
    } catch (error) {
      console.error(error)
      showToast(error instanceof Error ? error.message : '恢复账单失败', 'error')
    } finally {
      setIsWorking(false)
    }
  }

  const handleBulkVoid = async () => {
    const targets = selectedRows.filter((row) => !isCancelledRow(row))
    if (!targets.length || isWorking) return
    const reason = window.prompt(`请输入作废所选 ${targets.length} 张渠道账单的原因：`, '')
    if (reason === null) return
    if (!reason.trim()) {
      showToast('批量作废必须填写原因', 'error')
      return
    }
    setIsWorking(true)
    try {
      const results = await Promise.allSettled(
        targets.map((row) => transitionBillLifecycle('channel', String(row.id), 'cancelled', reason.trim()))
      )
      await recon.refetchChannelFromApi?.()
      const successCount = results.filter((item) => item.status === 'fulfilled').length
      const failedCount = results.length - successCount
      setSelectedIds([])
      showToast(
        failedCount
          ? `已将 ${successCount} 张移入垃圾桶，${failedCount} 张未满足作废条件`
          : `已将 ${successCount} 张渠道账单移入垃圾桶，主列表不再显示`,
        failedCount ? 'info' : 'success'
      )
    } catch (error) {
      console.error(error)
      showToast(error instanceof Error ? error.message : '批量作废失败', 'error')
    } finally {
      setIsWorking(false)
    }
  }

  const handleSingleVoid = async (row) => {
    if (isCancelledRow(row) || isWorking) return
    const reason = window.prompt(`请输入作废账单“${getChannelBillNumber(row)}”的原因：`, '')
    if (reason === null) return
    if (!reason.trim()) {
      showToast('作废账单必须填写原因', 'error')
      return
    }
    setIsWorking(true)
    try {
      await transitionBillLifecycle('channel', String(row.id), 'cancelled', reason.trim())
      await recon.refetchChannelFromApi?.()
      setSelectedIds((prev) => prev.filter((id) => id !== String(row.id)))
      showToast('渠道账单已移入垃圾桶，主列表不再显示', 'success')
    } catch (error) {
      console.error(error)
      showToast(error instanceof Error ? error.message : '账单作废失败', 'error')
    } finally {
      setIsWorking(false)
    }
  }

  const exportRows = async () => {
    const target = selectedRows.length > 0 ? selectedRows : rows
    if (!target.length) {
      showToast('没有可导出的渠道账单', 'error')
      return
    }
    const data = target.map((row) => {
      const totals = getChannelTotals(row)
      const received = getChannelReceivedAmount(row)
      const games = channelGames(row)
      const months = channelMonths(row)
      return {
        结算周期: channelPeriodLabel(row),
        月份数: months.length,
        编号: getChannelBillNumber(row),
        渠道: row.channelName || '',
        合作方: row.partnerName || '',
        产品数量: games.length,
        产品: games.join('、'),
        计费流水: totals.flow,
        计费金额: sumChannelNumericLines(row, 'billingAmount'),
        分成金额: sumChannelNumericLines(row, 'shareAmount'),
        通道费: sumChannelNumericLines(row, 'gatewayCost'),
        渠道应收: totals.settlementAmount,
        已收款: received,
        未收款: Math.max(0, totals.settlementAmount - received),
        收款状态: isChannelReceiptSettled(row) ? '已结清' : received > 0 ? '部分收款' : '未收款',
        状态: STATUS_LABELS[row.status] || row.status || '待处理',
        备注: row.remark || ''
      }
    })
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), '渠道账单')
      XLSX.writeFile(wb, `渠道账单_${new Date().toISOString().slice(0, 10)}.xlsx`)
      showToast(`已导出 ${target.length} 条渠道账单`, 'success')
    } catch (err) {
      console.error(err)
      showToast('Excel 模块加载或导出失败，请重试', 'error')
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
      const structured = parseChannelStatementWorkbook(workbook, file.name)
      if (structured.detected) {
        await recon.onChannelAddRecordsBatch(structured.records)
        const detailCount = structured.records.reduce((sum, record) => sum + (record.items?.length || 0), 0)
        showToast(`已导入 ${structured.records.length} 张渠道账单，共 ${detailCount} 条游戏明细`, 'success')
        return
      }
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const importRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      const records = importRows.map(mapChannelImportRow).filter(Boolean)
      if (!records.length) {
        showToast('没有识别到可导入的渠道对账数据', 'error')
        return
      }
      await recon.onChannelAddRecordsBatch(records)
      showToast(`已导入 ${records.length} 条渠道账单`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导入失败，请检查 Excel 格式', 'error')
    }
  }

  return (
    <PageContainer hideHeader className="core-recon-page core-channel-recon-page">
      <section className="core-recon-workbar">
        <div className="core-recon-head">
          <div className="core-recon-title">
            <span className="core-recon-title-mark" aria-hidden="true">渠</span>
            <div><h1>渠道账单</h1><span>{rows.length} 笔账单</span></div>
          </div>
          <div className="core-recon-actions">
            <button type="button" onClick={() => fileRef.current?.click()}>导入 Excel</button>
            <button type="button" onClick={() => void exportRows()}>导出</button>
            <button type="button" className="primary" onClick={() => setActiveView(VIEWS.CHANNEL_RECON_CREATE)}>新增账单</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleImportFile} hidden />
          </div>
        </div>
        <div className="core-recon-filters">
          <label className="core-recon-filter-control">
            <span>月份</span>
            <select value={month} aria-label="筛选明细结算月份" onChange={(event) => { setMonth(event.target.value); setExpandedKeys([]) }}>
              <option value="">全部月份</option>
              {monthOptions.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
            </select>
          </label>
          <div className="core-recon-filter-control core-recon-partner-filter">
            <span>渠道</span>
            <input
              type="search"
              list="core-channel-options"
              value={channelDraft}
              onChange={(event) => setChannelDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  setChannel(channelDraft.trim())
                  setSelectedIds([])
                  setExpandedKeys([])
                }
              }}
              placeholder="输入渠道名称"
              aria-label="搜索渠道"
            />
            <datalist id="core-channel-options">{channelOptions.map((name) => <option key={name} value={name} />)}</datalist>
            <button type="button" className="core-recon-partner-submit" onClick={() => { setChannel(channelDraft.trim()); setSelectedIds([]); setExpandedKeys([]) }}>搜索</button>
          </div>
          <label className="core-recon-filter-control">
            <span>状态</span>
            <select
              value={status}
              aria-label="筛选渠道账单状态"
              onChange={(event) => {
                const next = event.target.value
                setStatus(next)
                if (next === 'cancelled') setQuickFilter('trash')
                else if (quickFilter === 'trash') setQuickFilter('all')
                setSelectedIds([])
                setExpandedKeys([])
              }}
            >
              <option value="">全部状态</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="core-recon-filter-control core-recon-filter-search">
            <span>关键词</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="渠道、合作方、产品或月份" />
          </label>
          <button type="button" className="core-recon-reset" onClick={() => {
            setMonth('')
            setChannel('')
            setChannelDraft('')
            setStatus('')
            setQuery('')
            setQuickFilter('all')
            setSelectedIds([])
            setExpandedKeys([])
          }}>重置</button>
        </div>
      </section>

      <BillQuickFilters value={quickFilter} items={quickItems} onChange={handleQuickFilter} />

      <section className="core-recon-stats">
        {stats.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong>{item.note && <small>{item.note}</small>}</div>)}
      </section>

      <section className="core-recon-panel channel-group-panel">
        <div className="core-recon-panel-head">
          <div className="channel-group-panel-title">
            <h2>{quickFilter === 'trash' ? '垃圾桶' : quickFilter === 'archived' ? '归档账单' : '按渠道汇总'}</h2>
            <span>{groups.length} 个渠道 · {rows.length} 张账单</span>
          </div>
          <div className="core-recon-panel-tools">
            {groups.length > 0 ? (
              <button type="button" className="channel-group-expand-all" onClick={toggleAllGroups}>
                {allGroupsExpanded ? '收起全部' : '展开全部'}
              </button>
            ) : null}
            <span>{selectedRows.length > 0 ? `已选 ${selectedRows.length} 条` : `${rows.length} 条`}</span>
            {selectedRows.length > 0 ? (
              <div className="core-recon-selection-actions">
                <button type="button" onClick={() => setSelectedIds([])} disabled={isWorking}>取消选择</button>
                <button type="button" className="danger" onClick={() => void handleBulkVoid()} disabled={isWorking}>
                  {isWorking ? '处理中…' : `作废所选（${selectedRows.length}）`}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="channel-group-ledger">
          <div className="channel-group-summary-head">
            <label className="channel-group-head-check">
              <input
                ref={(node) => { if (node) node.indeterminate = partiallyVisibleSelected }}
                type="checkbox"
                aria-label="全选当前筛选结果"
                checked={allVisibleSelected}
                disabled={!selectableRows.length || isWorking}
                onChange={toggleSelectAll}
              />
            </label>
            <span>渠道 / 合作方</span>
            <span>账单</span>
            <span>账期</span>
            <span className="is-right">渠道应收</span>
            <span className="is-right">已收</span>
            <span className="is-right">未收</span>
            <span>状态</span>
          </div>

          {!groups.length ? (
            <div className="core-recon-empty channel-group-empty">
              {quickFilter === 'trash' ? '垃圾桶为空' : quickFilter === 'archived' ? '暂无归档账单' : '暂无渠道账单'}
            </div>
          ) : groups.map((group) => {
            const expanded = expandedChannels.has(group.key)
            const groupSelectableRows = group.rows.filter((row) => !archivedIds.has(String(row.id)) && !isCancelledRow(row))
            const selectedInGroup = groupSelectableRows.filter((row) => selectedIds.includes(String(row.id))).length
            const allGroupSelected = groupSelectableRows.length > 0 && selectedInGroup === groupSelectableRows.length
            const partiallyGroupSelected = selectedInGroup > 0 && !allGroupSelected

            return (
              <section key={group.key} className={`channel-group-card ${expanded ? 'is-expanded' : ''}`}>
                <div className="channel-group-summary">
                  <label className="channel-group-select">
                    <input
                      ref={(node) => { if (node) node.indeterminate = partiallyGroupSelected }}
                      type="checkbox"
                      aria-label={`选择 ${group.channelName} 的全部账单`}
                      checked={allGroupSelected}
                      disabled={!groupSelectableRows.length || isWorking}
                      onChange={() => toggleGroupSelected(group.rows)}
                    />
                  </label>
                  <button type="button" className="channel-group-toggle" aria-expanded={expanded} onClick={() => toggleGroup(group.key)}>
                    <span className="channel-group-identity">
                      <i className="channel-group-chevron" aria-hidden="true">›</i>
                      <span>
                        <strong>{group.channelName}</strong>
                        <small title={group.partnerTitle}>{group.partnerLabel}</small>
                      </span>
                    </span>
                    <span className="channel-group-count"><strong>{group.rows.length}</strong><small>张</small></span>
                    <span className="channel-group-period">{group.periodLabel}</span>
                    <span className="channel-group-money">{money(group.settlement)}</span>
                    <span className="channel-group-money">{money(group.received)}</span>
                    <span className={`channel-group-money ${group.unpaid > 0.01 ? 'has-unpaid' : ''}`}>{money(group.unpaid)}</span>
                    <span className={`core-channel-status-badge is-${group.summaryStatus.tone}`}>{group.summaryStatus.label}</span>
                  </button>
                </div>

                {expanded ? (
                  <div className="channel-group-details">
                    <table className="core-recon-table channel-group-detail-table">
                      <colgroup>
                        <col className="channel-detail-col-period" />
                        <col className="channel-detail-col-number" />
                        <col className="channel-detail-col-game" />
                        <col className="channel-detail-col-flow" />
                        <col className="channel-detail-col-share" />
                        <col className="channel-detail-col-settlement" />
                        <col className="channel-detail-col-received" />
                        <col className="channel-detail-col-status" />
                        <col className="channel-detail-col-actions" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>账期</th>
                          <th>编号</th>
                          <th>产品</th>
                          <th className="core-recon-align-right">计费流水</th>
                          <th className="core-recon-align-right">分成金额</th>
                          <th className="core-recon-align-right">渠道应收</th>
                          <th className="core-recon-align-right">回款</th>
                          <th>状态</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row) => {
                          const totals = getChannelTotals(row)
                          const games = channelGames(row)
                          const received = Math.max(0, getChannelReceivedAmount(row))
                          const unpaid = Math.max(0, Number(totals.settlementAmount || 0) - received)
                          const settled = isChannelReceiptSettled(row)
                          const cancelled = isCancelledRow(row)
                          const archived = archivedIds.has(String(row.id))
                          const canArchive = eligibleIds.has(String(row.id))
                          const paymentStatus = channelPaymentStatus(row, { received, settled, cancelled, archived })
                          const gameText = games.join('、')
                          const periodText = channelPeriodLabel(row)

                          return (
                            <tr key={row.id} className={selectedIds.includes(String(row.id)) ? 'is-selected' : ''}>
                              <td className="core-rd-month-cell">
                                <input
                                  type="checkbox"
                                  aria-label={`选择渠道账单 ${group.channelName} ${periodText}`}
                                  checked={selectedIds.includes(String(row.id))}
                                  disabled={isWorking || archived || cancelled}
                                  onChange={() => toggleSelected(row.id)}
                                />
                                <span title={channelMonths(row).map(monthLabel).join('、')}>{periodText}</span>
                              </td>
                              <td className="core-recon-number">{getChannelBillNumber(row)}</td>
                              <td><span className="core-recon-game-text" title={gameText || '-'}>{compactGameLabel(games)}</span></td>
                              <td className="core-recon-money">{money(totals.flow)}</td>
                              <td className="core-recon-money">{money(sumChannelNumericLines(row, 'shareAmount'))}</td>
                              <td className="core-recon-money core-recon-money--settlement">{money(totals.settlementAmount)}</td>
                              <td className="core-recon-money core-recon-money--received">
                                <strong>{unpaid > 0.01 ? `未收 ${money(unpaid)}` : `已收 ${money(received)}`}</strong>
                                <small>{unpaid > 0.01 ? `已收 ${money(received)}` : '已结清'}</small>
                              </td>
                              <td><span className={`core-channel-status-badge is-${paymentStatus.tone}`}>{paymentStatus.label}</span></td>
                              <td>
                                <div className="core-recon-row-actions">
                                  <button type="button" onMouseEnter={() => prefetchBill360?.('channel', String(row.id))} onFocus={() => prefetchBill360?.('channel', String(row.id))} onClick={() => openBill360('channel', String(row.id), row)}>360°</button>
                                  {cancelled ? (
                                    <button type="button" disabled={isWorking} onClick={() => void handleRestoreCancelled(row)}>{isWorking ? '处理中…' : '恢复账单'}</button>
                                  ) : archived ? (
                                    <button type="button" disabled={archiveWorkingId === String(row.id)} onClick={() => void handleUnarchive(row)}>{archiveWorkingId === String(row.id) ? '处理中…' : '取消归档'}</button>
                                  ) : (
                                    <>
                                      {settled && canArchive ? (
                                        <button type="button" disabled={Boolean(archiveWorkingId)} onClick={() => void handleArchive(row)}>{archiveWorkingId === String(row.id) ? '归档中…' : '归档'}</button>
                                      ) : (
                                        <button type="button" disabled={settled || !recon.channelApiEnabled} title={!recon.channelApiEnabled ? '渠道 API 不可用，暂不能登记收款' : settled ? '该账单已结清，完成核对后即可归档' : '登记渠道收款'} onClick={() => setReceiptRecord(row)}>{settled ? '已结清' : '收款'}</button>
                                      )}
                                      <button type="button" onClick={() => openChannelReconciliationEdit(String(row.id))}>编辑</button>
                                      <button type="button" className="danger" disabled={isWorking} title="作废后账单会移入垃圾桶，历史、关联关系和操作日志仍保留" onClick={() => void handleSingleVoid(row)}>作废</button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            )
          })}
        </div>
      </section>

      <ChannelReceiptDrawer
        open={Boolean(receiptRecord)}
        record={receiptRecord}
        quickFull={false}
        partyA={settings.partyA}
        partyB={settings.partyB}
        channelApiEnabled={recon.channelApiEnabled}
        showToast={showToast}
        onClose={() => setReceiptRecord(null)}
        onRegisterReceipt={recon.onChannelRegisterReceipt}
      />
    </PageContainer>
  )
}

export default CoreChannelReconciliationGroupedPage
