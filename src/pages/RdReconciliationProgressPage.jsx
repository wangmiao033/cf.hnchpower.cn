import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import ChannelBillProgressPanel from '@/components/channel/ChannelBillProgressPanel.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import RdReconciliationProgressPanel from '@/components/reconciliation/RdReconciliationProgressPanel.jsx'
import { summarizeChannelBillProgress } from '@/domain/channel/channelBillProgress.js'
import { summarizeRdReconciliationProgress } from '@/domain/reconciliation/rdReconciliationProgress.js'
import {
  buildRdMonthlyProgressRecords,
  buildRdSettlementPeriodOptions
} from '@/domain/reconciliation/rdSettlementPeriods.js'
import { totalReconciliationSettlementAmount } from '@/domain/settlement/calculateSettlementAmount.js'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { getBillInvoiceSummary } from '@/lib/api/billInvoiceAllocations.ts'
import { getInvoiceRequestStatuses, submitChannelInvoiceRequest } from '@/lib/api/financeTasks.ts'
import '@/components/reconciliation/reconciliation-admin.css'
import './CoreReconciliationPages.css'

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function monthKey(value) {
  const raw = clean(value)
  const match = raw.match(/^(\d{4})(?:-|年)\s*(\d{1,2})/)
  return match ? `${match[1]}-${String(Number(match[2])).padStart(2, '0')}` : raw
}

function monthLabel(value) {
  const match = monthKey(value).match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : value
}

function money(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function settlementAmount(record) {
  const stored = Number.parseFloat(record?.settlementAmount)
  return Number.isFinite(stored)
    ? stored
    : totalReconciliationSettlementAmount(record)
}

function invoiceSummaryKey(billType, billId) {
  return `${billType}:${billId}`
}

export default function RdReconciliationProgressPage() {
  const { can } = useAuth()
  const {
    recon,
    showToast,
    openReconciliationEdit,
    openChannelReconciliationEdit,
    openBill360
  } = useAppState()
  const [mode, setMode] = useState('game')
  const [selectedMonth, setSelectedMonth] = useState(null)
  const [query, setQuery] = useState('')
  const [invoiceSummaries, setInvoiceSummaries] = useState({})
  const [invoiceTaskStatuses, setInvoiceTaskStatuses] = useState({})
  const [invoiceTaskRevision, setInvoiceTaskRevision] = useState(0)
  const [invoiceTaskBusyId, setInvoiceTaskBusyId] = useState('')

  const gameRecords = recon.records || []
  const channelRecords = recon.channelRecords || []

  const monthOptions = useMemo(() => {
    if (mode === 'game') return buildRdSettlementPeriodOptions(gameRecords)
    return Array.from(
      new Set(
        channelRecords
          .map((record) => monthKey(record.settlementMonth || record.billMonth || record.month))
          .filter(Boolean)
      )
    ).sort((a, b) => b.localeCompare(a))
  }, [channelRecords, gameRecords, mode])

  const activeMonth = selectedMonth && monthOptions.includes(selectedMonth)
    ? selectedMonth
    : monthOptions[0] || ''

  const gameSnapshot = useMemo(() => {
    const keyword = clean(query).toLowerCase()
    const monthlyRecords = buildRdMonthlyProgressRecords(gameRecords, activeMonth)
    const records = monthlyRecords.filter((record) => {
      if (!keyword) return true
      return [
        record.billNumber,
        record.settlementNumber,
        record.code,
        record.partnerShortName,
        record.partnerName,
        record.partner,
        record.gameName,
        record.game,
        ...(record.items || []).map((item) => item.gameName)
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })

    return summarizeRdReconciliationProgress(records, {
      month: activeMonth,
      settlementResolver: settlementAmount
    })
  }, [activeMonth, gameRecords, query])

  const channelMonthSnapshot = useMemo(
    () => summarizeChannelBillProgress(channelRecords, { month: activeMonth }),
    [activeMonth, channelRecords]
  )

  const channelSnapshot = useMemo(() => {
    const keyword = clean(query).toLowerCase()
    if (!keyword) return channelMonthSnapshot
    const filterRows = (rows = []) => rows.filter((row) =>
      [row.billNumber, row.channel, row.partner, row.product]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    )
    return {
      ...channelMonthSnapshot,
      rows: filterRows(channelMonthSnapshot.rows),
      unresolved: filterRows(channelMonthSnapshot.unresolved)
    }
  }, [channelMonthSnapshot, query])

  const scopeCount = mode === 'game'
    ? gameSnapshot?.totals?.rows || 0
    : channelMonthSnapshot?.totals?.rows || 0

  const visibleInvoiceBills = useMemo(() => {
    const rows = mode === 'game' ? gameSnapshot.rows : channelSnapshot.rows
    const unique = new Map()
    for (const row of rows || []) {
      const billType = mode === 'game' ? 'rd' : 'channel'
      const billId = String(mode === 'game' ? row.billId || '' : row.id || '')
      if (!billId) continue
      unique.set(invoiceSummaryKey(billType, billId), { billType, billId })
    }
    return [...unique.values()]
  }, [channelSnapshot.rows, gameSnapshot.rows, mode])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        visibleInvoiceBills.map(async ({ billType, billId }) => {
          try {
            return [invoiceSummaryKey(billType, billId), await getBillInvoiceSummary(billType, billId)]
          } catch {
            return [invoiceSummaryKey(billType, billId), null]
          }
        })
      )
      if (!cancelled) setInvoiceSummaries(Object.fromEntries(entries.filter(([, value]) => value)))
    })()
    return () => { cancelled = true }
  }, [visibleInvoiceBills])

  const visibleChannelBillIds = useMemo(
    () => (channelSnapshot.rows || []).map((row) => String(row.id || '')).filter(Boolean),
    [channelSnapshot.rows]
  )

  useEffect(() => {
    let cancelled = false
    getInvoiceRequestStatuses(visibleChannelBillIds)
      .then((response) => {
        if (cancelled) return
        setInvoiceTaskStatuses(Object.fromEntries((response.items || []).map((item) => [String(item.bill_id), item])))
      })
      .catch(() => {
        if (!cancelled) setInvoiceTaskStatuses({})
      })
    return () => { cancelled = true }
  }, [invoiceTaskRevision, visibleChannelBillIds])

  async function handleSubmitInvoiceRequest(row, previousTask = null) {
    const invoiceSummary = invoiceSummaries[`channel:${row.id}`]
    const remaining = Number(invoiceSummary?.remaining_amount ?? row.settlementAmount ?? 0)
    const action = previousTask?.status === 'rejected' ? '重新提交' : '提交'
    const reason = previousTask?.status === 'rejected' && previousTask?.reject_reason
      ? `\n上次驳回：${previousTask.reject_reason}`
      : ''
    if (!window.confirm(`${action}给财务开票吗？\n\n账单：${row.billNumber}\n合作方：${row.partner}\n当前待开票：${money(remaining)}${reason}`)) return
    setInvoiceTaskBusyId(String(row.id))
    try {
      const task = await submitChannelInvoiceRequest(String(row.id))
      showToast(`已提交财务：${task.task_no}`, 'success')
      setInvoiceTaskRevision((value) => value + 1)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '提交开票失败', 'error')
    } finally {
      setInvoiceTaskBusyId('')
    }
  }

  function changeMode(nextMode) {
    setMode(nextMode)
    setSelectedMonth(null)
    setQuery('')
  }

  return (
    <PageContainer hideHeader className="core-recon-page rd-progress-page">
      <section className="core-recon-workbar rd-progress-workbar">
        <div className="core-recon-head">
          <div className="core-recon-title">
            <span className="core-recon-title-mark rd-progress-title-mark">进</span>
            <div><h1>对账进度</h1><p>统一查看游戏账单与渠道账单的核对、结算和待处理进度</p></div>
          </div>
          <div className="rd-progress-scope">
            <strong>{monthLabel(activeMonth) || '全部账期'}</strong>
            <span>{scopeCount} {mode === 'game' ? '笔账单' : '笔渠道账单'}</span>
          </div>
        </div>

        <div className="core-recon-filters rd-progress-filters">
          <div className="rd-progress-mode-switch" role="group" aria-label="对账类型">
            <button type="button" className={mode === 'game' ? 'is-active' : ''} onClick={() => changeMode('game')}>游戏对账</button>
            <button type="button" className={mode === 'channel' ? 'is-active' : ''} onClick={() => changeMode('channel')}>渠道对账</button>
          </div>
          <label className="core-recon-filter-control">
            <span>统计月份</span>
            <select value={activeMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
              {monthOptions.length === 0 && <option value="">暂无账期</option>}
              {monthOptions.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}
            </select>
          </label>
          <label className="core-recon-filter-search">
            <span>搜索</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === 'game' ? '编号、客户或产品' : '编号、渠道、合作方或产品'} />
          </label>
          <button type="button" className="core-recon-reset" onClick={() => { setSelectedMonth(null); setQuery('') }}>回到最新月</button>
        </div>
      </section>

      {mode === 'game' ? (
        <RdReconciliationProgressPanel
          snapshot={gameSnapshot}
          onEdit={(id) => openReconciliationEdit(String(id), VIEWS.RECON_PROGRESS)}
          onOpen360={(row) => openBill360('rd', String(row.billId || row.id), row)}
          invoiceSummaries={invoiceSummaries}
        />
      ) : (
        <ChannelBillProgressPanel
          snapshot={channelSnapshot}
          onEditBill={(id) => openChannelReconciliationEdit(String(id), VIEWS.RECON_PROGRESS)}
          onOpen360={(row) => openBill360('channel', String(row.id), row)}
          onSubmitInvoiceRequest={(row, task) => void handleSubmitInvoiceRequest(row, task)}
          invoiceSummaries={invoiceSummaries}
          invoiceTaskStatuses={invoiceTaskStatuses}
          canSubmitInvoiceRequest={can('invoice_requests.submit')}
          invoiceTaskBusyId={invoiceTaskBusyId}
        />
      )}
    </PageContainer>
  )
}
